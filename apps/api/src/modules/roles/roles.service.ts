/**
 * `RolesService` — uloge i matrica prava (docs/05 §3–§4, docs/07 §2.3).
 *
 * Šta radi i zašto tako:
 *
 * 1. **Katalog permisija je u kodu** (`PERMISSION_CATALOG`), a u bazi su samo
 *    redovi `Permission` (zbog FK-ova i opisa). `POST /permissions/sync` je
 *    deploy korak koji ih usklađuje; matrica odbija kod koji ne postoji u bazi
 *    uz jasnu poruku (bez toga bi grant bio tiho neupotrebljiv).
 * 2. **`PUT /roles/matrix` je jedna transakcija** (P2): zamjena grantova po roli
 *    + `Role.permissionsVersion++`. Redis invalidacija se radi **nakon** commit-a
 *    (`invalidateRole(roleId, dbVersion)`), jer bi brisanje keša prije commit-a
 *    omogućilo da se keš odmah napuni starim stanjem.
 * 3. **P3 (≤ 5 s)**: preslikavanje `vfm:permver:role:{id}` na DB verziju +
 *    `DEL vfm:perm:*` → postojeći access tokeni dobijaju `401 PERMISSIONS_STALE`
 *    ili `403 PERMISSION_DENIED` bez ponovne prijave.
 * 4. **Zaštite**: `SUPER_ADMIN` se ne može arhivirati (`LAST_SUPER_ADMIN_PROTECTED`,
 *    u bazi to čuva i trigger `trg_guard_last_super_admin_role`), sistemske uloge
 *    ne mogu dobiti drugi `code`, a `SUPER_ADMIN.allowedClientTypes` ostaje
 *    `['WEB']` (N-05/P1). Prava Super Admina se **ne** uređuju matricom — on ima
 *    sve implicitno (R-07), pa bi upis grantova davao lažan osjećaj revokacije.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ApiErrorDetail, ClientType, PermissionScope } from '@vfm/shared';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  ROLE_ALLOWED_CLIENT_TYPES,
  ROLE_CODES,
  SUPER_ADMIN_ROLE,
  catalogModuleOf,
  isSensitivePermission,
  permissionAction,
  permissionModule,
} from '@vfm/shared';
import type {
  ArchiveRoleInput,
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionMatrixResponse,
  PermissionSyncResult,
  RoleDetail,
  RoleMatrixGrant,
  RoleMatrixUpdateInput,
  RoleMatrixUpdateResult,
  RoleSummary,
  UpdateRoleInput,
} from '@vfm/shared/schemas';
import type { Prisma } from '../../generated/prisma/client.js';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionsService } from '../auth/permissions/permissions.service.js';

/** Rezultat mutacije + podaci koje kontroler upisuje u `AuditContext`. */
export interface RoleMutation<T> {
  readonly data: T;
  /**
   * Stanje prije/poslije izmjene u **istom obliku** — kontroler ih upisuje u
   * `AuditContext`, a `buildAuditDiff` tada daje tačne promjene po polju.
   */
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Flat prikaz matrice za audit diff: `ADMINISTRATOR.vehicle:create → ALL`. */
export type FlatMatrix = Readonly<Record<string, string | null>>;

/** `Permission.conditions` je JSONB — u upis ide samo objekat. */
function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(): Promise<RoleSummary[]> {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    });

    const counts = await this.loadCounts(roles.map((role) => role.id));
    return roles.map((role) => this.toSummary(role, counts));
  }

  async get(roleId: string): Promise<RoleDetail> {
    const role = await this.loadRoleOrThrow(roleId);
    const [grants, counts] = await Promise.all([this.loadGrants([roleId]), this.loadCounts([roleId])]);

    return { ...this.toSummary(role, counts), grants };
  }

  /** `GET /roles/matrix` — katalog + uloge + grantovi u jednom odgovoru. */
  async matrix(): Promise<PermissionMatrixResponse> {
    const [modules, roles, grants] = await Promise.all([this.catalog(), this.list(), this.loadGrants()]);

    return { modules, roles, grants, generatedAt: new Date().toISOString() };
  }

  /**
   * `GET /permissions` — katalog iz koda (izvor istine) + status u bazi.
   *
   * `description` se čita iz baze (kod nema opise), a `inDatabase` govori da li
   * je `POST /permissions/sync` pokrenut — deploy provjera.
   */
  async catalog(): Promise<PermissionCatalogGroup[]> {
    const rows = await this.prisma.permission.findMany({ select: { code: true, description: true } });
    const descriptions = new Map<string, string | null>();
    for (const row of rows) descriptions.set(row.code, row.description);

    return PERMISSION_MODULES.map((module) => ({
      module,
      permissions: PERMISSION_CATALOG[module].map((code) => ({
        code,
        action: permissionAction(code),
        description: descriptions.get(code) ?? null,
        isSensitive: isSensitivePermission(code),
        inDatabase: descriptions.has(code),
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  //  Mutacije nad ulogama
  // ---------------------------------------------------------------------------

  async create(input: CreateRoleInput, actorId?: string): Promise<RoleMutation<RoleDetail>> {
    if ((ROLE_CODES as readonly string[]).includes(input.code)) {
      throw VfmErrors.validationError([
        detail('code', `Kod '${input.code}' je rezervisan za sistemsku ulogu.`),
      ]);
    }

    const existing = await this.prisma.role.findFirst({
      where: { code: input.code },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      throw VfmErrors.validationError([detail('code', `Rola s kodom '${input.code}' već postoji.`)]);
    }

    const allowedClientTypes = input.allowedClientTypes ?? [...ROLE_ALLOWED_CLIENT_TYPES.CUSTOM];
    const role = await this.prisma.role.create({
      data: {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        allowedClientTypes,
        priority: input.priority ?? 100,
        permissionsVersion: 0,
      },
    });

    this.logger.log(`Kreirana rola ${role.code} (${role.id}) — actor=${actorId ?? '-'}`);
    const created = await this.get(role.id);
    return { data: created, after: this.roleAsRecord(role), meta: { code: role.code } };
  }

  async update(roleId: string, input: UpdateRoleInput, actorId?: string): Promise<RoleMutation<RoleDetail>> {
    const role = await this.loadRoleOrThrow(roleId);
    const before = this.roleAsRecord(role);

    // N-05/P1: Super Admin je web-only i to se ne može popustiti kroz PATCH.
    if (role.code === SUPER_ADMIN_ROLE && input.allowedClientTypes) {
      const requested = [...input.allowedClientTypes].sort();
      const allowed = [...ROLE_ALLOWED_CLIENT_TYPES.SUPER_ADMIN].sort();
      if (requested.join(',') !== allowed.join(',')) {
        throw VfmErrors.validationError([
          detail(
            'allowedClientTypes',
            `Super Admin mora ostati web-only (${allowed.join(', ')}). Mobilni pristup je trajno zabranjen (N-05).`,
          ),
        ]);
      }
    }

    // `code` i `isSystem` se ne mijenjaju: audit trag i DB triggeri ovise o njima.
    const data: Prisma.RoleUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.allowedClientTypes ? { allowedClientTypes: input.allowedClientTypes } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };

    // Promjena `allowedClientTypes` mijenja odluku `ClientTypeGuard`-a, koji čita
    // keširani snapshot → verzija raste i keš se briše (inače bi stara pravila
    // važila do 60 s).
    const touchesClientTypes = input.allowedClientTypes !== undefined;
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: touchesClientTypes ? { ...data, permissionsVersion: { increment: 1 } } : data,
    });

    if (touchesClientTypes) {
      await this.permissions.invalidateRole(updated.id, updated.permissionsVersion);
    }

    this.logger.log(`Ažurirana rola ${updated.code} (${updated.id}) — actor=${actorId ?? '-'}`);
    return { data: await this.get(updated.id), before, after: this.roleAsRecord(updated) };
  }

  async archive(
    roleId: string,
    input: ArchiveRoleInput,
    actorId?: string,
  ): Promise<RoleMutation<{ id: string; code: string; archivedAt: string }>> {
    const role = await this.loadRoleOrThrow(roleId);
    const before = this.roleAsRecord(role);

    if (role.code === SUPER_ADMIN_ROLE) {
      // Zadnji (i jedini) Super Admin mora postojati — DB trigger radi isto.
      throw VfmErrors.lastSuperAdminProtected();
    }
    if (role.isSystem) {
      throw VfmErrors.validationError([
        detail('id', `Sistemska rola '${role.code}' se ne može arhivirati (seed je obnavlja pri svakom deployu).`),
      ]);
    }

    const counts = await this.loadCounts([roleId]);
    const members = counts.users.get(roleId) ?? 0;
    if (members > 0) {
      throw VfmErrors.validationError([
        detail(
          'id',
          `Rola '${role.code}' ima ${members} aktivnih korisnika — prvo im dodijeli drugu ulogu ili ih deaktiviraj.`,
        ),
      ]);
    }

    const archivedAt = new Date();
    await this.prisma.role.update({ where: { id: roleId }, data: { deletedAt: archivedAt } });

    this.logger.log(
      `Arhivirana rola ${role.code} (${roleId}) — actor=${actorId ?? '-'}, razlog=${input.reason ?? '-'}`,
    );

    return {
      data: { id: roleId, code: role.code, archivedAt: archivedAt.toISOString() },
      before,
      after: { ...this.roleAsRecord(role), archivedAt: archivedAt.toISOString() },
      meta: { ...(input.reason ? { reason: input.reason } : {}) },
    };
  }

  // ---------------------------------------------------------------------------
  //  Matrica prava (P2)
  // ---------------------------------------------------------------------------

  /**
   * Bulk zamjena grantova za više uloga u **jednoj** transakciji + bump verzije,
   * a nakon commit-a invalidacija Redis keša (P3: ≤ 5 s bez ponovne prijave).
   */
  async updateMatrix(
    input: RoleMatrixUpdateInput,
    actorId?: string,
  ): Promise<RoleMutation<RoleMatrixUpdateResult>> {
    const requestedIds = input.roles.map((entry) => entry.roleId);
    const roles = await this.prisma.role.findMany({
      where: { id: { in: requestedIds } },
      select: { id: true, code: true, deletedAt: true },
    });

    const byId = new Map(roles.map((role) => [role.id, role]));
    for (const entry of input.roles) {
      const role = byId.get(entry.roleId);
      if (!role || role.deletedAt) throw VfmErrors.notFound('rola');
      if (role.code === SUPER_ADMIN_ROLE) {
        throw VfmErrors.validationError([
          detail(
            'roles',
            'Prava Super Admina se ne uređuju matricom — on ima sve permisije implicitno (R-07).',
          ),
        ]);
      }
    }

    const changed = await this.prisma.$transaction(async (tx) => {
      // Kodovi permisija moraju postojati u bazi (FK na `Permission`).
      const codes = [...new Set(input.roles.flatMap((entry) => entry.grants.map((grant) => grant.permission)))];
      const permissions = await tx.permission.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true },
      });
      const permissionIds = new Map(permissions.map((row) => [row.code, row.id]));

      const missing = codes.filter((code) => !permissionIds.has(code));
      if (missing.length > 0) {
        throw VfmErrors.validationError([
          detail(
            'roles',
            `Permisije ne postoje u bazi: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. ` +
              'Pokreni POST /api/v1/permissions/sync (deploy korak).',
          ),
        ]);
      }

      const now = new Date();
      const perRole: Array<{
        roleId: string;
        roleCode: string;
        permissionsVersion: number;
        before: Map<string, PermissionScope>;
        after: Map<string, PermissionScope>;
      }> = [];

      for (const entry of input.roles) {
        const role = byId.get(entry.roleId);
        const roleCode = role?.code ?? entry.roleId;

        const existing = await tx.rolePermission.findMany({
          where: { roleId: entry.roleId },
          select: { scope: true, permission: { select: { code: true } } },
        });
        const beforeMap = new Map(existing.map((row) => [row.permission.code, row.scope]));

        await tx.rolePermission.deleteMany({ where: { roleId: entry.roleId } });

        if (entry.grants.length > 0) {
          await tx.rolePermission.createMany({
            data: entry.grants.map((grant) => {
              const permissionId = permissionIds.get(grant.permission);
              // `missing` provjera iznad garantuje postojanje — ovo je odbrana.
              if (!permissionId) throw VfmErrors.internal();
              const conditions = asJson(grant.conditions);

              return {
                id: randomUUID(),
                roleId: entry.roleId,
                permissionId,
                scope: grant.scope,
                scopeVehicleIds: grant.scope === 'VEHICLE_IDS' ? (grant.scopeVehicleIds ?? []) : [],
                scopeDriverIds: grant.scope === 'DRIVER_IDS' ? (grant.scopeDriverIds ?? []) : [],
                ...(conditions === undefined ? {} : { conditions }),
                ...(actorId ? { grantedById: actorId } : {}),
                grantedAt: now,
              };
            }),
          });
        }

        const updated = await tx.role.update({
          where: { id: entry.roleId },
          data: { permissionsVersion: { increment: 1 } },
          select: { permissionsVersion: true },
        });

        const afterMap = new Map(entry.grants.map((grant) => [grant.permission, grant.scope]));
        perRole.push({
          roleId: entry.roleId,
          roleCode,
          permissionsVersion: updated.permissionsVersion,
          before: beforeMap,
          after: afterMap,
        });
      }

      return perRole;
    });

    // Tek nakon commit-a: keš se briše i brojač verzije se preslikava na DB.
    for (const role of changed) {
      await this.permissions.invalidateRole(role.roleId, role.permissionsVersion);
    }

    const changedEntries: RoleMatrixUpdateResult['changed'] = [];
    let added = 0;
    let removed = 0;
    let scopeChanged = 0;

    for (const role of changed) {
      for (const [permission, scope] of role.after) {
        const previous = role.before.get(permission);
        if (previous === undefined) {
          added += 1;
          changedEntries.push({
            roleId: role.roleId,
            roleCode: role.roleCode,
            permission,
            before: null,
            after: scope,
          });
          continue;
        }
        if (previous !== scope) {
          scopeChanged += 1;
          changedEntries.push({
            roleId: role.roleId,
            roleCode: role.roleCode,
            permission,
            before: previous,
            after: scope,
          });
        }
      }

      for (const [permission, scope] of role.before) {
        if (role.after.has(permission)) continue;
        removed += 1;
        changedEntries.push({
          roleId: role.roleId,
          roleCode: role.roleCode,
          permission,
          before: scope,
          after: null,
        });
      }
    }

    const result: RoleMatrixUpdateResult = {
      affectedRoles: changed.length,
      added,
      removed,
      scopeChanged,
      changed: changedEntries,
      permissionsVersion: Object.fromEntries(changed.map((role) => [role.roleId, role.permissionsVersion])),
    };

    const flat = flatMatrixPair(changed.map((role) => ({ code: role.roleCode, before: role.before, after: role.after })));

    this.logger.log(
      `Matrica prava ažurirana: role=${changed.length}, dodato=${added}, uklonjeno=${removed}, ` +
        `opseg=${scopeChanged} — actor=${actorId ?? '-'}`,
    );

    return {
      data: result,
      before: flat.before,
      after: flat.after,
      meta: { affectedRoles: changed.length, added, removed, scopeChanged },
    };
  }

  // ---------------------------------------------------------------------------
  //  Katalog (deploy korak)
  // ---------------------------------------------------------------------------

  /**
   * `POST /permissions/sync` — usklađuje `Permission` redove s katalogom iz koda.
   *
   * `description` se **ne** dira (opisi se održavaju u bazi), a postojeći
   * grantovi ostaju netaknuti: sync mijenja samo strukturu kataloga.
   */
  async syncCatalog(): Promise<PermissionSyncResult> {
    const existing = await this.prisma.permission.findMany({
      select: { code: true, module: true, action: true, isSensitive: true },
    });
    const byCode = new Map(existing.map((row) => [row.code, row]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const code of ALL_PERMISSIONS) {
        const module = catalogModuleOf(code) ?? permissionModule(code);
        const action = permissionAction(code);
        const isSensitive = isSensitivePermission(code);
        const current = byCode.get(code);

        if (!current) {
          await tx.permission.create({ data: { id: randomUUID(), code, module, action, isSensitive } });
          created += 1;
          continue;
        }

        if (current.module !== module || current.action !== action || current.isSensitive !== isSensitive) {
          await tx.permission.update({ where: { code }, data: { module, action, isSensitive } });
          updated += 1;
          continue;
        }

        unchanged += 1;
      }
    });

    this.logger.log(`Katalog permisija sinhronizovan: ukupno=${ALL_PERMISSIONS.length}, novo=${created}, izmijenjeno=${updated}.`);
    return { total: ALL_PERMISSIONS.length, created, updated, unchanged };
  }

  // ---------------------------------------------------------------------------
  //  Interno
  // ---------------------------------------------------------------------------

  private async loadRoleOrThrow(roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, deletedAt: null } });
    if (!role) throw VfmErrors.notFound('rola');
    return role;
  }

  /** Broj aktivnih korisnika i grantova po ulozi (dva `groupBy` upita). */
  private async loadCounts(roleIds: readonly string[]): Promise<{
    users: Map<string, number>;
    grants: Map<string, number>;
  }> {
    if (roleIds.length === 0) return { users: new Map(), grants: new Map() };

    const now = new Date();
    const [userCounts, grantCounts] = await Promise.all([
      this.prisma.userRole.groupBy({
        by: ['roleId'],
        where: {
          roleId: { in: [...roleIds] },
          revokedAt: null,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          ],
          user: { deletedAt: null, status: 'ACTIVE' },
        },
        _count: { _all: true },
      }),
      this.prisma.rolePermission.groupBy({
        by: ['roleId'],
        where: { roleId: { in: [...roleIds] } },
        _count: { _all: true },
      }),
    ]);

    return {
      users: new Map(userCounts.map((row) => [row.roleId, row._count._all])),
      grants: new Map(grantCounts.map((row) => [row.roleId, row._count._all])),
    };
  }

  /** Grantovi jedne, više ili svih (aktivnih) uloga. */
  private async loadGrants(roleIds?: readonly string[]): Promise<RoleMatrixGrant[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: roleIds
        ? { roleId: { in: [...roleIds] } }
        : { role: { deletedAt: null } },
      orderBy: [{ roleId: 'asc' }, { permission: { code: 'asc' } }],
      select: {
        roleId: true,
        scope: true,
        scopeVehicleIds: true,
        scopeDriverIds: true,
        conditions: true,
        grantedAt: true,
        permission: { select: { code: true } },
      },
    });

    return rows.map((row) => ({
      roleId: row.roleId,
      permission: row.permission.code,
      scope: row.scope,
      scopeVehicleIds: [...row.scopeVehicleIds],
      scopeDriverIds: [...row.scopeDriverIds],
      conditions: asConditions(row.conditions),
      grantedAt: row.grantedAt.toISOString(),
    }));
  }

  private toSummary(
    role: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      allowedClientTypes: ClientType[];
      permissionsVersion: number;
      priority: number;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    counts: { users: Map<string, number>; grants: Map<string, number> },
  ): RoleSummary {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      allowedClientTypes: [...role.allowedClientTypes],
      permissionsVersion: role.permissionsVersion,
      priority: role.priority,
      activeUserCount: counts.users.get(role.id) ?? 0,
      grantedCount: counts.grants.get(role.id) ?? 0,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  /** `before` snapshot za audit diff (ključevi su čitljivi u Audit logu). */
  private roleAsRecord(role: {
    code: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    allowedClientTypes: ClientType[];
    priority: number;
    permissionsVersion: number;
  }): Readonly<Record<string, unknown>> {
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      allowedClientTypes: [...role.allowedClientTypes].join(','),
      priority: role.priority,
      permissionsVersion: role.permissionsVersion,
    };
  }

}

/**
 * Flat par mapa `"<ROLE_CODE>.<permission>" → scope | null` za audit diff.
 *
 * Uključuje **samo dirane permisije** (uniju prije/poslije), pa `AuditLog.before`
 * i `.after` ostanu mali, a `buildAuditDiff` i dalje tačno pokaže šta je dodato,
 * uklonjeno ili promijenjeno po ulozi.
 */
function flatMatrixPair(
  roles: ReadonlyArray<{
    code: string;
    before: ReadonlyMap<string, PermissionScope>;
    after: ReadonlyMap<string, PermissionScope>;
  }>,
): { before: FlatMatrix; after: FlatMatrix } {
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};

  for (const role of roles) {
    const keys = new Set([...role.before.keys(), ...role.after.keys()]);
    for (const key of keys) {
      before[`${role.code}.${key}`] = role.before.get(key) ?? null;
      after[`${role.code}.${key}`] = role.after.get(key) ?? null;
    }
  }

  return { before, after };
}

function asConditions(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
