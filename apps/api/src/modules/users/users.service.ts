/**
 * `UsersService` — upravljanje korisnicima (docs/07 §2.2, docs/05 §7–§8).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Nikad fiksne lozinke.** Kreiranje korisnika generiše jaku privremenu
 *    lozinku (`mustChangePassword=true`), a reset izdaje jednokratni token
 *    (30 min, SHA-256 u bazi). Admin lozinku vidi **samo** u odgovoru na akciju.
 * 2. **PII se ne vraća bez prava.** `email`/`phone` su maskirani (`A***@…`)
 *    osim ako akter ima `user:view_pii` ili je Super Admin (R-07); odgovor nosi
 *    `piiRedacted` da UI zna prikazati „nemate pravo na PII".
 * 3. **Zadnji Super Admin je zaštićen** (docs/03 §3.2): deaktivacija,
 *    arhiviranje, brisanje i skidanje `SUPER_ADMIN` role padaju s
 *    `409 LAST_SUPER_ADMIN_PROTECTED` — u bazi isto čuva trigger.
 * 4. **Revokacija je trenutna**: svaka promjena koja utiče na prava ili status
 *    diže `tokenVersion` (DB) + preslikava ga u Redis + briše `vfm:perm:{userId}`,
 *    pa stari access token pada na sljedećem zahtjevu (P3/P14).
 * 5. **`DELETE` je anonimizacija, ne fizički DELETE.** `AuditLog` je immutabilan
 *    i nosi `actorId`; fizičko brisanje bi pokidalo trag. Zato `DELETE /users/:id`
 *    briše PII (e-mail → `deleted-<id>@invalid`, imena → „Obrisan korisnik"),
 *    revokuje sesije i postavlja `deletedAt`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type {
  ArchiveUserInput,
  AssignUserRoleInput,
  CreateUserInput,
  CreateUserResult,
  IssuePasswordResetInput,
  PasswordResetIssued,
  UpdateUserInput,
  UserDetail,
  UserListQuery,
  UserListResponse,
  UserSummary,
} from '@vfm/shared/schemas';
import { SUPER_ADMIN_ROLE, USER_STATUSES } from '@vfm/shared';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionsService } from '../auth/permissions/permissions.service.js';
import { PasswordService } from '../auth/services/password.service.js';
import { TokenService } from '../auth/services/token.service.js';

/** Rezultat mutacije + snapshot za audit diff (kontroler puni `AuditContext`). */
export interface UserMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Polja koja se čitaju za prikaz korisnika (bez `passwordHash`). */
const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  phone: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  tokenVersion: true,
  timezone: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Maskiranje PII-a u listama (docs/05 §8.2: `A***@example.ba`, `•••••`). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, '');
  return `•••••${digits.slice(-3)}`;
}

/** Ima li akter pravo (Super Admin ima sve — R-07). */
function allows(actor: AuthenticatedUser | undefined, permission: string): boolean {
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  return actor.permissions?.list.includes(permission) ?? false;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
  ) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: UserListQuery, actor: AuthenticatedUser | undefined): Promise<UserListResponse> {
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? { roles: { some: { roleId: query.roleId, revokedAt: null } } } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const rolesByUser = await this.rolesFor(rows.map((row) => row.id));
    const piiAllowed = allows(actor, 'user:view_pii');

    return {
      items: rows.map((row) => this.toSummary(row, rolesByUser.get(row.id) ?? [], piiAllowed)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string, actor: AuthenticatedUser | undefined): Promise<UserDetail> {
    const user = await this.loadUserOrThrow(id);
    const [rolesByUser, activeSessions] = await Promise.all([
      this.rolesFor([id]),
      this.prisma.refreshSession.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    return this.toDetail(user, rolesByUser.get(id) ?? [], allows(actor, 'user:view_pii'), activeSessions);
  }

  // ---------------------------------------------------------------------------
  //  Mutacije
  // ---------------------------------------------------------------------------

  async create(input: CreateUserInput, actor: AuthenticatedUser | undefined): Promise<CreateUserResult> {
    const existing = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw VfmErrors.validationError([
        { path: ['email'], message: 'Korisnik s tim e-mailom već postoji.' },
      ]);
    }

    const roles = await this.resolveRoles(input.roleIds);
    const temporaryPassword = this.passwords.generateTemporaryPassword({ email: input.email });
    const passwordHash = await this.passwords.hashUnchecked(temporaryPassword);
    const mustChangePassword = input.mustChangePassword ?? true;
    const id = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName: input.displayName ?? null,
          phone: input.phone ?? null,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.locale ? { locale: input.locale } : {}),
          mustChangePassword,
          ...(actor ? { createdById: actor.id } : {}),
        },
      });

      await tx.userRole.createMany({
        data: roles.map((role) => ({
          id: randomUUID(),
          userId: id,
          roleId: role.id,
          ...(actor ? { assignedById: actor.id } : {}),
        })),
      });
    });

    this.logger.log(
      `Kreiran korisnik ${input.email} (${id}), role=${roles.map((role) => role.code).join(',')} — actor=${actor?.id ?? '-'}`,
    );

    const detail = await this.get(id, actor);
    return {
      user: detail,
      temporaryPassword,
      mustChangePassword,
    };
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<UserDetail>> {
    const user = await this.loadUserOrThrow(id);
    const before = this.snapshotOf(user);

    const deactivating = input.status !== undefined && input.status !== 'ACTIVE' && user.status === 'ACTIVE';
    if (deactivating) {
      // Prvo jasnija greška (vlastiti nalog), pa zaštita zadnjeg Super Admina —
      // oba slučaja su odbijena, ali poruka mora biti akciona.
      if (actor?.id === user.id) {
        throw VfmErrors.validationError([
          { path: ['status'], message: 'Ne možete deaktivirati vlastiti nalog.' },
        ]);
      }
      if (await this.hasSuperAdminRole(user.id, (user.roles ?? []).map((entry) => entry.roleId))) {
        await this.assertNotLastSuperAdmin(user.id);
      }
    }

    const data = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    await this.prisma.user.update({ where: { id: user.id }, data });

    // Promjena statusa mijenja i prava (neaktivan nalog nema pristup) →
    // revokacija svih sesija, bez čekanja isteka tokena.
    if (deactivating) await this.revokeEverything(user.id);

    const detail = await this.get(id, actor);
    return {
      data: detail,
      before,
      after: this.snapshotOf(detail),
      meta: { statusChanged: input.status !== undefined && input.status !== user.status },
    };
  }

  async archive(
    id: string,
    input: ArchiveUserInput,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<{ id: string; archivedAt: string }>> {
    const user = await this.loadUserOrThrow(id);
    const before = this.snapshotOf(user);

    if (actor?.id === user.id) {
      throw VfmErrors.validationError([
        { path: ['id'], message: 'Ne možete arhivirati vlastiti nalog.' },
      ]);
    }
    if (await this.hasSuperAdminRole(user.id, (user.roles ?? []).map((entry) => entry.roleId))) {
      await this.assertNotLastSuperAdmin(user.id);
    }

    const archivedAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: archivedAt, status: 'DEACTIVATED' },
    });
    const revokedSessions = await this.revokeEverything(user.id);

    this.logger.log(
      `Arhiviran korisnik ${user.email} (${user.id}), sesije=${revokedSessions} — actor=${actor?.id ?? '-'}`,
    );

    return {
      data: { id: user.id, archivedAt: archivedAt.toISOString() },
      before,
      after: { ...this.snapshotOf(user), status: 'DEACTIVATED', archivedAt: archivedAt.toISOString() },
      meta: { revokedSessions, ...(input.reason ? { reason: input.reason } : {}) },
    };
  }

  /**
   * `DELETE /users/:id` — **anonimizacija** PII-a (vidi zaglavlje klase).
   *
   * Zašto ne fizički `DELETE`: `AuditLog.actorId` je FK na `User` i audit je
   * immutabilan; brisanje reda bi ostavilo audit bez aktera ili bi ga (uz
   * `Cascade`) obrisalo. Anonimizacija čuva trag i ispunjava zahtjev za
   * uklanjanjem ličnih podataka.
   */
  async remove(
    id: string,
    input: ArchiveUserInput,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<{ id: string; anonymizedAt: string }>> {
    const user = await this.loadUserOrThrow(id);
    const before = this.snapshotOf(user);

    if (actor?.id === user.id) {
      throw VfmErrors.validationError([
        { path: ['id'], message: 'Ne možete obrisati vlastiti nalog.' },
      ]);
    }
    if (await this.hasSuperAdminRole(user.id, (user.roles ?? []).map((entry) => entry.roleId))) {
      await this.assertNotLastSuperAdmin(user.id);
    }

    const anonymizedAt = new Date();
    const anonymousEmail = `deleted-${user.id}@invalid`;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: anonymousEmail,
          firstName: 'Obrisan',
          lastName: 'korisnik',
          displayName: null,
          phone: null,
          status: 'DEACTIVATED',
          deletedAt: anonymizedAt,
          // Lozinka postaje nemoguća za prijavu (hash slučajne vrijednosti).
          passwordHash: await this.passwords.hashUnchecked(randomBytes(32).toString('hex')),
          mustChangePassword: false,
        },
      });

      await tx.userRole.updateMany({
        where: { userId: user.id },
        data: { revokedAt: anonymizedAt },
      });
    });

    const revokedSessions = await this.revokeEverything(user.id);

    this.logger.warn(
      `Anonimiziran korisnik (${user.id}), sesije=${revokedSessions} — actor=${actor?.id ?? '-'}`,
    );

    return {
      data: { id: user.id, anonymizedAt: anonymizedAt.toISOString() },
      before,
      after: { email: anonymousEmail, status: 'DEACTIVATED', anonymizedAt: anonymizedAt.toISOString() },
      meta: { revokedSessions, ...(input.reason ? { reason: input.reason } : {}) },
    };
  }

  // --- Role ---------------------------------------------------------------

  async assignRole(
    id: string,
    input: AssignUserRoleInput,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<UserDetail>> {
    const user = await this.loadUserOrThrow(id);
    const role = await this.prisma.role.findFirst({
      where: { id: input.roleId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!role) throw VfmErrors.notFound('rola');

    const before = this.snapshotOf(user);
    const existing = await this.prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw VfmErrors.validationError([
        { path: ['roleId'], message: `Korisnik već ima rolu '${role.code}'.` },
      ]);
    }

    await this.prisma.userRole.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        roleId: role.id,
        ...(actor ? { assignedById: actor.id } : {}),
        ...(input.validFrom ? { validFrom: new Date(input.validFrom) } : {}),
        ...(input.validUntil ? { validUntil: new Date(input.validUntil) } : {}),
        ...(input.note ? { note: input.note } : {}),
      },
    });

    // Nova rola mijenja prava → keš se briše i token se revokuje (bez čekanja TTL-a).
    await this.revokeEverything(user.id);

    this.logger.log(`Korisnik ${user.email} dobio rolu ${role.code} — actor=${actor?.id ?? '-'}`);
    const detail = await this.get(id, actor);
    return {
      data: detail,
      before,
      after: this.snapshotOf(detail),
      meta: { roleId: role.id, roleCode: role.code, action: 'ASSIGNED' },
    };
  }

  async removeRole(
    id: string,
    roleId: string,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<UserDetail>> {
    const user = await this.loadUserOrThrow(id);
    const before = this.snapshotOf(user);

    const assignment = await this.prisma.userRole.findFirst({
      where: { userId: user.id, roleId, revokedAt: null },
      select: { id: true, role: { select: { code: true } } },
    });
    if (!assignment) throw VfmErrors.notFound('dodjela role');

    if (assignment.role.code === SUPER_ADMIN_ROLE) {
      await this.assertNotLastSuperAdmin(user.id);
      if (actor?.id === user.id) {
        throw VfmErrors.validationError([
          { path: ['roleId'], message: 'Ne možete sebi ukloniti ulogu Super Admina.' },
        ]);
      }
    }

    await this.prisma.userRole.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date() },
    });
    await this.revokeEverything(user.id);

    this.logger.log(`Korisniku ${user.email} uklonjena rola ${assignment.role.code} — actor=${actor?.id ?? '-'}`);
    const detail = await this.get(id, actor);
    return {
      data: detail,
      before,
      after: this.snapshotOf(detail),
      meta: { roleId, roleCode: assignment.role.code, action: 'REVOKED' },
    };
  }

  // --- Lozinka i sesije ---------------------------------------------------

  /**
   * Izdaje jednokratni token za reset lozinke (30 min, SHA-256 u bazi).
   *
   * U Fazi 1 token se vraća **adminu** (`deliveredBy: 'ADMIN'`) jer nema
   * e-mail infrastrukture; u Fazi 5 ide kroz outbox i polje `token` se uklanja
   * iz odgovora. Prethodni tokeni istog korisnika se invalidiraju.
   */
  async issuePasswordReset(
    id: string,
    input: IssuePasswordResetInput,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<PasswordResetIssued>> {
    const user = await this.loadUserOrThrow(id);
    if (user.status !== 'ACTIVE') {
      throw VfmErrors.validationError([
        { path: ['id'], message: 'Reset lozinke je moguć samo za aktivan nalog.' },
      ]);
    }

    const generated = this.tokens.generatePasswordResetToken();
    const expiresAt =
      input.expiresInMinutes === 30
        ? generated.expiresAt
        : new Date(Date.now() + input.expiresInMinutes * 60_000);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Stari tokeni prestaju važiti istog trenutka (jednokratnost po korisniku).
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          tokenHash: generated.tokenHash,
          expiresAt,
          ...(actor ? { createdById: actor.id } : {}),
        },
      });
    });

    this.logger.warn(
      `Izdan reset token za ${user.email} (${user.id}), ističe ${expiresAt.toISOString()} — actor=${actor?.id ?? '-'}`,
    );

    return {
      data: {
        userId: user.id,
        email: user.email,
        token: generated.token,
        expiresAt: expiresAt.toISOString(),
        deliveredBy: 'ADMIN',
      },
      before: { id: user.id, status: user.status },
      after: { id: user.id, resetRequestedAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
      meta: { ttlMinutes: input.expiresInMinutes },
    };
  }

  /** Revokuje sve sesije i diže `tokenVersion` (bez mijenjanja lozinke). */
  async forceLogout(
    id: string,
    actor: AuthenticatedUser | undefined,
  ): Promise<UserMutation<{ revokedSessions: number; tokenVersion: number }>> {
    const user = await this.loadUserOrThrow(id);
    const revokedSessions = await this.revokeEverything(user.id);

    this.logger.log(
      `Force logout korisnika ${user.email} (${user.id}), sesije=${revokedSessions} — actor=${actor?.id ?? '-'}`,
    );

    const detail = await this.loadUserOrThrow(user.id);
    return {
      data: { revokedSessions, tokenVersion: detail.tokenVersion },
      before: { id: user.id, tokenVersion: user.tokenVersion },
      after: { id: user.id, tokenVersion: detail.tokenVersion },
      meta: { revokedSessions },
    };
  }

  // ---------------------------------------------------------------------------
  //  Interno
  // ---------------------------------------------------------------------------

  private async loadUserOrThrow(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...USER_SELECT, roles: { where: { revokedAt: null }, select: { roleId: true } } },
    });
    if (!user) throw VfmErrors.notFound('korisnik');
    return user;
  }

  /** Role za više korisnika jednim upitom (bez N+1). */
  private async rolesFor(
    userIds: readonly string[],
  ): Promise<Map<string, Array<{ id: string; code: string; name: string }>>> {
    const result = new Map<string, Array<{ id: string; code: string; name: string }>>();
    if (userIds.length === 0) return result;

    const rows = await this.prisma.userRole.findMany({
      where: { userId: { in: [...userIds] }, revokedAt: null, role: { deletedAt: null } },
      select: { userId: true, role: { select: { id: true, code: true, name: true } } },
    });

    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push(row.role);
      result.set(row.userId, list);
    }
    for (const list of result.values()) list.sort((left, right) => left.code.localeCompare(right.code));
    return result;
  }

  /** Validira da sve role postoje i nisu arhivirane (inače `400` s detaljima). */
  private async resolveRoles(roleIds: readonly string[]) {
    const unique = [...new Set(roleIds)];
    const roles = await this.prisma.role.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, code: true, name: true },
    });

    const found = new Set(roles.map((role) => role.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw VfmErrors.validationError(
        missing.map((id) => ({ path: ['roleIds'], message: `Rola ${id} ne postoji ili je arhivirana.` })),
      );
    }
    return roles;
  }

  private async hasSuperAdminRole(userId: string, roleIds: readonly string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const roles = await this.prisma.role.findMany({
      where: { id: { in: [...roleIds] }, deletedAt: null },
      select: { code: true },
    });
    return roles.some((role) => role.code === SUPER_ADMIN_ROLE);
  }

  /** `409` ako bi radnja ostavila sistem bez ijednog aktivnog Super Admina. */
  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const activeSuperAdmins = await this.prisma.user.count({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: {
          some: { revokedAt: null, role: { code: SUPER_ADMIN_ROLE, deletedAt: null } },
        },
      },
    });

    if (activeSuperAdmins <= 1) throw VfmErrors.lastSuperAdminProtected();
    this.logger.debug(`Provjera zadnjeg Super Admina: aktivnih=${activeSuperAdmins}, cilj=${userId}`);
  }

  /** Briše RBAC keš + revokuje sesije + diže `tokenVersion` (DB pa Redis). */
  private async revokeEverything(userId: string): Promise<number> {
    const now = new Date();
    const [updated, revoked] = await Promise.all([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.permissions.bumpTokenVersion(userId, updated.tokenVersion);
    await this.permissions.invalidateUser(userId);
    return revoked.count;
  }

  private toSummary(
    row: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      displayName: string | null;
      phone: string | null;
      status: string;
      mustChangePassword: boolean;
      lastLoginAt: Date | null;
      lockedUntil: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    roles: ReadonlyArray<{ id: string; code: string; name: string }>,
    piiAllowed: boolean,
  ): UserSummary {
    return {
      id: row.id,
      email: piiAllowed ? row.email : maskEmail(row.email),
      firstName: row.firstName,
      lastName: row.lastName,
      displayName: row.displayName,
      phone: piiAllowed ? row.phone : maskPhone(row.phone),
      status: (USER_STATUSES as readonly string[]).includes(row.status)
        ? (row.status as UserSummary['status'])
        : 'DEACTIVATED',
      mustChangePassword: row.mustChangePassword,
      roles: roles.map((role) => ({ ...role })),
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : null,
      piiRedacted: !piiAllowed,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(
    row: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      displayName: string | null;
      phone: string | null;
      status: string;
      mustChangePassword: boolean;
      lastLoginAt: Date | null;
      lockedUntil: Date | null;
      tokenVersion: number;
      timezone: string;
      locale: string;
      createdAt: Date;
      updatedAt: Date;
    },
    roles: ReadonlyArray<{ id: string; code: string; name: string }>,
    piiAllowed: boolean,
    activeSessions: number,
  ): UserDetail {
    return {
      ...this.toSummary(row, roles, piiAllowed),
      timezone: row.timezone,
      locale: row.locale,
      tokenVersion: row.tokenVersion,
      activeSessions,
    };
  }

  /** Stabilan snapshot za audit diff (bez datuma koji se mijenjaju sami). */
  private snapshotOf(user: {
    email: string;
    firstName: string;
    lastName: string;
    displayName: string | null;
    phone: string | null;
    status: string;
    timezone?: string;
    locale?: string;
  }): Readonly<Record<string, unknown>> {
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      phone: user.phone,
      status: user.status,
      ...(user.timezone !== undefined ? { timezone: user.timezone } : {}),
      ...(user.locale !== undefined ? { locale: user.locale } : {}),
    };
  }
}
