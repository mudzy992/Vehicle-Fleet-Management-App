/**
 * `FakePrismaClient` — in-memory zamjena za `PrismaService` u unit testovima.
 *
 * Zašto postoji: `AuthService`, `UsersService` i `RolesService` rade stvarne
 * upite (rotacija sesija, brojači neuspjeha, `tokenVersion`), a sandbox nema
 * PostgreSQL. Fake **čuva redove i primjenjuje `where`/`data`** onoliko vjerno
 * koliko je potrebno za ponašanje (rotacija, reuse detection, lockout), pa
 * testovi ne prolaze samo zato što mock vraća isti objekat.
 *
 * Ograničenja (namjerna):
 * - `select` se ignoriše — vraća se cijeli red (nadskup je za servis bezopasan),
 * - `where` podržava samo oblike koje domenski kod stvarno koristi,
 * - `$transaction` prosljeđuje isti fake (bez rollback-a) — dovoljno za
 *   provjeru redoslijeda u `PUT /roles/matrix`.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'PENDING_PASSWORD_CHANGE';
  mustChangePassword: boolean;
  tokenVersion: number;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  timezone: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeSessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  clientType: string;
  deviceInfo: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface FakeRoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  allowedClientTypes: string[];
  permissionsVersion: number;
  priority: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePermissionRow {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
  isSensitive: boolean;
}

export interface FakeRolePermissionRow {
  id: string;
  roleId: string;
  permissionId: string;
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS' | 'DRIVER_IDS';
  scopeVehicleIds: string[];
  scopeDriverIds: string[];
  conditions: Record<string, unknown> | null;
  grantedById: string | null;
  grantedAt: Date | null;
}

export interface FakeUserRoleRow {
  userId: string;
  roleId: string;
  revokedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  role: FakeRoleRow;
}

export interface FakeAuditLogRow {
  id: number;
  actorId: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  action: string;
  severity: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  changedFields: string[];
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  clientType: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface FakeAuthAttemptRow {
  id: string;
  email: string;
  userId: string | null;
  success: boolean;
  clientType: string;
  ipAddress: string | null;
  userAgent: string | null;
  failureReason: string | null;
  createdAt: Date;
}

/** Podskup `where` oblika koje koristi auth sloj. */
interface UserWhere {
  readonly id?: string;
  readonly email?: string;
  readonly deletedAt?: null;
}

interface SessionWhere {
  readonly id?: string | { readonly in: readonly string[] };
  readonly userId?: string;
  readonly tokenHash?: string;
  readonly revokedAt?: null;
  readonly expiresAt?: { readonly gt?: Date };
}

interface UserRoleWhere {
  readonly userId?: string;
  readonly revokedAt?: null;
  readonly role?: { readonly deletedAt?: null };
  readonly AND?: readonly unknown[];
}

type UpdateData = Record<string, unknown>;

/** `data: { tokenVersion: { increment: 1 } }` → broj + 1. */
function applyUpdate(row: Record<string, unknown>, data: UpdateData): void {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && 'increment' in value) {
      const increment = (value as { increment: number }).increment;
      const current = row[key];
      row[key] = typeof current === 'number' ? current + increment : increment;
      continue;
    }
    row[key] = value;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakePrismaClient {
  readonly users = new Map<string, FakeUserRow>();
  readonly sessions = new Map<string, FakeSessionRow>();
  readonly roles = new Map<string, FakeRoleRow>();
  readonly userRoles: FakeUserRoleRow[] = [];
  readonly rolePermissions: FakeRolePermissionRow[] = [];
  readonly permissions: FakePermissionRow[] = [];
  readonly authAttempts: FakeAuthAttemptRow[] = [];
  readonly auditLogs: FakeAuditLogRow[] = [];

  /** Namjerni kvarovi: `{ authAttempt: new Error(...) }` testira otpornost toka. */
  failures: { authAttempt?: Error; auditLog?: Error } = {};

  /** Autoincrement identitet (`AuditLog.id` je `BigInt @default(autoincrement())`). */
  private auditSequence = 0;

  /** Brojač za deterministički `createdAt` (redoslijed sesija je bitan). */
  private sequence = 0;

  /** Broj poziva po metodi (za asertacije „upit je stvarno izvršen"). */
  readonly calls = {
    userFindFirst: 0,
    userUpdate: 0,
    sessionCreate: 0,
    sessionFindUnique: 0,
    sessionFindMany: 0,
    sessionUpdate: 0,
    sessionUpdateMany: 0,
    userRoleFindMany: 0,
    authAttemptCreate: 0,
    auditLogCreate: 0,
    auditLogFindMany: 0,
    roleCreate: 0,
    roleUpdate: 0,
    rolePermissionDeleteMany: 0,
    permissionCreate: 0,
    transaction: 0,
  };

  readonly user = {
    findFirst: async (args?: { where?: UserWhere }): Promise<FakeUserRow | null> => {
      this.calls.userFindFirst += 1;
      const where = args?.where ?? {};

      for (const row of this.users.values()) {
        if (where.id !== undefined && row.id !== where.id) continue;
        if (where.email !== undefined && row.email.toLowerCase() !== where.email.toLowerCase()) continue;
        if (where.deletedAt === null && row.deletedAt !== null) continue;
        return clone(row);
      }
      return null;
    },

    update: async (args: { where: { id: string }; data: UpdateData }): Promise<FakeUserRow> => {
      this.calls.userUpdate += 1;
      const row = this.users.get(args.where.id);
      if (!row) throw new Error(`FakePrisma: korisnik ${args.where.id} ne postoji.`);

      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      row.updatedAt = new Date();
      return clone(row);
    },
  };

  readonly refreshSession = {
    create: async (args: { data: UpdateData }): Promise<FakeSessionRow> => {
      this.calls.sessionCreate += 1;
      const data = args.data as unknown as Omit<FakeSessionRow, 'revokedAt' | 'replacedById' | 'lastUsedAt' | 'createdAt'>;

      this.sequence += 1;
      const row: FakeSessionRow = {
        id: data.id,
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        clientType: data.clientType,
        deviceInfo: (data.deviceInfo ?? null) as Record<string, unknown> | null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        expiresAt: data.expiresAt,
        revokedAt: null,
        replacedById: null,
        lastUsedAt: null,
        // `createdAt` raste s brojačem: testovi max-sesija ovise o redoslijedu.
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.sequence)),
      };
      this.sessions.set(row.id, row);
      return clone(row);
    },

    findUnique: async (args: { where: { tokenHash: string } }): Promise<FakeSessionRow | null> => {
      this.calls.sessionFindUnique += 1;
      for (const row of this.sessions.values()) {
        if (row.tokenHash === args.where.tokenHash) return clone(row);
      }
      return null;
    },

    findMany: async (args?: {
      where?: SessionWhere;
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }): Promise<FakeSessionRow[]> => {
      this.calls.sessionFindMany += 1;
      const rows = this.matchSessions(args?.where ?? {});
      const direction = args?.orderBy?.createdAt ?? 'asc';

      rows.sort((left, right) =>
        direction === 'asc'
          ? left.createdAt.getTime() - right.createdAt.getTime()
          : right.createdAt.getTime() - left.createdAt.getTime(),
      );
      return rows.map((row) => clone(row));
    },

    update: async (args: { where: { id: string }; data: UpdateData }): Promise<FakeSessionRow> => {
      this.calls.sessionUpdate += 1;
      const row = this.sessions.get(args.where.id);
      if (!row) throw new Error(`FakePrisma: sesija ${args.where.id} ne postoji.`);

      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return clone(row);
    },

    updateMany: async (args: { where: SessionWhere; data: UpdateData }): Promise<{ count: number }> => {
      this.calls.sessionUpdateMany += 1;
      const rows = this.matchSessions(args.where);
      for (const row of rows) applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return { count: rows.length };
    },
  };

  readonly userRole = {
    findMany: async (args?: { where?: UserRoleWhere }): Promise<Array<{ role: FakeRoleRow }>> => {
      this.calls.userRoleFindMany += 1;
      const where = args?.where ?? {};

      const rows = this.userRoles.filter((entry) => {
        if (where.userId !== undefined && entry.userId !== where.userId) return false;
        if (where.revokedAt === null && entry.revokedAt !== null) return false;
        if (where.role?.deletedAt === null && entry.role.deletedAt !== null) return false;

        // `validFrom <= sad` / `validUntil > sad` — fake poštuje samo NULL i
        // eksplicitne granice (dovoljno za testove važećih/isteklih uloga).
        const now = Date.now();
        if (entry.validFrom && entry.validFrom.getTime() > now) return false;
        if (entry.validUntil && entry.validUntil.getTime() <= now) return false;
        return true;
      });

      rows.sort((left, right) => left.role.priority - right.role.priority);
      return rows.map((entry) => ({ role: clone(entry.role) }));
    },

    /**
     * Broj aktivnih korisnika po roli (`RolesService.loadCounts`).
     *
     * Broji samo korisnike koji stvarno postoje u `users` i nisu obrisani — pa
     * test može dokazati da arhivirana/deaktivirana korisnica ne blokira arhiv.
     */
    groupBy: async (args: { where?: { roleId?: { in?: readonly string[] } } }) => {
      const ids = args.where?.roleId?.in ?? [...this.roles.keys()];
      const now = Date.now();

      return ids.map((roleId) => {
        const active = this.userRoles.filter((entry) => {
          if (entry.roleId !== roleId || entry.revokedAt !== null) return false;
          if (entry.validFrom && entry.validFrom.getTime() > now) return false;
          if (entry.validUntil && entry.validUntil.getTime() <= now) return false;

          const user = this.users.get(entry.userId);
          return Boolean(user && user.deletedAt === null && user.status === 'ACTIVE');
        });

        return { roleId, _count: { _all: active.length } };
      });
    },
  };

  readonly auditLog = {
    create: async (args: { data: UpdateData }): Promise<FakeAuditLogRow> => {
      this.calls.auditLogCreate += 1;
      if (this.failures.auditLog) throw this.failures.auditLog;

      const data = args.data as Record<string, unknown>;
      this.auditSequence += 1;
      const row: FakeAuditLogRow = {
        id: this.auditSequence,
        actorId: (data.actorId as string | undefined) ?? null,
        actorEmail: (data.actorEmail as string | undefined) ?? null,
        actorRoles: (data.actorRoles as string[] | undefined) ?? [],
        action: String(data.action),
        severity: String(data.severity),
        entityType: (data.entityType as string | undefined) ?? null,
        entityId: (data.entityId as string | undefined) ?? null,
        before: data.before ?? null,
        after: data.after ?? null,
        changedFields: (data.changedFields as string[] | undefined) ?? [],
        reason: (data.reason as string | undefined) ?? null,
        requestId: (data.requestId as string | undefined) ?? null,
        ipAddress: (data.ipAddress as string | undefined) ?? null,
        userAgent: (data.userAgent as string | undefined) ?? null,
        clientType: (data.clientType as string | undefined) ?? null,
        metadata: data.metadata ?? null,
        createdAt: (data.createdAt as Date | undefined) ?? new Date(),
      };
      this.auditLogs.push(row);
      return clone(row);
    },

    findMany: async (args?: {
      where?: { action?: string; severity?: string; actorId?: string };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
    }): Promise<FakeAuditLogRow[]> => {
      this.calls.auditLogFindMany += 1;
      const where = args?.where ?? {};

      const rows = this.auditLogs.filter((row) => {
        if (where.action !== undefined && row.action !== where.action) return false;
        if (where.severity !== undefined && row.severity !== where.severity) return false;
        if (where.actorId !== undefined && row.actorId !== where.actorId) return false;
        return true;
      });

      const direction = args?.orderBy?.createdAt ?? 'desc';
      rows.sort((left, right) =>
        direction === 'desc'
          ? right.createdAt.getTime() - left.createdAt.getTime()
          : left.createdAt.getTime() - right.createdAt.getTime(),
      );
      return (args?.take ? rows.slice(0, args.take) : rows).map((row) => clone(row));
    },
  };

  readonly authAttempt = {
    create: async (args: { data: UpdateData }): Promise<FakeAuthAttemptRow> => {
      this.calls.authAttemptCreate += 1;
      if (this.failures.authAttempt) throw this.failures.authAttempt;

      const data = args.data as unknown as Omit<FakeAuthAttemptRow, 'createdAt'>;
      const row: FakeAuthAttemptRow = { ...data, createdAt: new Date() };
      this.authAttempts.push(row);
      return clone(row);
    },
  };

  // ---------------------------------------------------------------------------
  //  Role i matrica prava (chunk I)
  // ---------------------------------------------------------------------------

  /**
   * `$transaction` samo prosljeđuje isti fake kao `tx` — dovoljno da se provjeri
   * redoslijed (delete → create → bump verzije) i da greška u callback-u prekine
   * upis. Izolacija/rollback se ne simulira (pravi rollback pokriva integracioni
   * test na PostgreSQL-u).
   */
  readonly $transaction = async <T>(fn: (tx: FakePrismaClient) => Promise<T>): Promise<T> => {
    this.calls.transaction += 1;
    return fn(this);
  };

  readonly role = {
    findMany: async (args?: { where?: { deletedAt?: null; id?: { in?: readonly string[] } } }) => {
      const where = args?.where ?? {};
      const ids = where.id?.in;

      return [...this.roles.values()]
        .filter((row) => (where.deletedAt === null ? row.deletedAt === null : true))
        .filter((row) => (ids ? ids.includes(row.id) : true))
        .sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code))
        .map((row) => clone(row));
    },

    findFirst: async (args?: {
      where?: { id?: string; code?: string; deletedAt?: null };
    }): Promise<FakeRoleRow | null> => {
      const where = args?.where ?? {};
      for (const row of this.roles.values()) {
        if (where.id !== undefined && row.id !== where.id) continue;
        if (where.code !== undefined && row.code !== where.code) continue;
        if (where.deletedAt === null && row.deletedAt !== null) continue;
        return clone(row);
      }
      return null;
    },

    create: async (args: { data: Partial<FakeRoleRow> & { id: string; code: string } }): Promise<FakeRoleRow> => {
      this.calls.roleCreate += 1;
      if (this.roles.has(args.data.id)) throw new Error('role.create: duplikat id');
      const row = this.addRole(args.data);
      return clone(row);
    },

    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<FakeRoleRow> => {
      this.calls.roleUpdate += 1;
      const row = this.roles.get(args.where.id);
      if (!row) throw new Error(`role.update: rola ${args.where.id} ne postoji.`);

      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      row.updatedAt = new Date();
      return clone(row);
    },
  };

  readonly rolePermission = {
    findMany: async (args?: {
      where?: { roleId?: { in?: readonly string[] } | string; role?: { deletedAt?: null } };
    }): Promise<Array<FakeRolePermissionRow & { permission: { code: string } }>> => {
      const where = args?.where ?? {};
      const ids =
        typeof where.roleId === 'string' ? [where.roleId] : (where.roleId?.in ?? undefined);
      const activeRolesOnly = where.role?.deletedAt === null;

      return this.rolePermissions
        .filter((row) => (ids ? ids.includes(row.roleId) : true))
        .filter((row) => {
          if (!activeRolesOnly) return true;
          return (this.roles.get(row.roleId)?.deletedAt ?? null) === null;
        })
        .sort((left, right) => left.roleId.localeCompare(right.roleId))
        .map((row) => ({
          ...clone(row),
          permission: { code: this.permissionCode(row.permissionId) },
        }));
    },

    groupBy: async (args: { where?: { roleId?: { in?: readonly string[] } } }) => {
      const ids = args.where?.roleId?.in ?? [...this.roles.keys()];

      return ids.map((roleId) => ({
        roleId,
        _count: { _all: this.rolePermissions.filter((row) => row.roleId === roleId).length },
      }));
    },

    deleteMany: async (args: { where: { roleId: string } }): Promise<{ count: number }> => {
      this.calls.rolePermissionDeleteMany += 1;
      const before = this.rolePermissions.length;

      for (let index = this.rolePermissions.length - 1; index >= 0; index -= 1) {
        if (this.rolePermissions[index]?.roleId === args.where.roleId) this.rolePermissions.splice(index, 1);
      }
      return { count: before - this.rolePermissions.length };
    },

    createMany: async (args: { data: readonly FakeRolePermissionRow[] }): Promise<{ count: number }> => {
      for (const row of args.data) this.rolePermissions.push(clone(row));
      return { count: args.data.length };
    },
  };

  readonly permission = {
    findMany: async (args?: {
      where?: { code?: { in?: readonly string[] } };
    }): Promise<FakePermissionRow[]> => {
      const ids = args?.where?.code?.in;

      return this.permissions
        .filter((row) => (ids ? ids.includes(row.code) : true))
        .map((row) => clone(row));
    },

    create: async (args: { data: FakePermissionRow }): Promise<FakePermissionRow> => {
      this.calls.permissionCreate += 1;
      this.permissions.push(clone(args.data));
      return clone(args.data);
    },

    update: async (args: {
      where: { code: string };
      data: Partial<Omit<FakePermissionRow, 'id' | 'code'>>;
    }): Promise<FakePermissionRow> => {
      const row = this.permissions.find((candidate) => candidate.code === args.where.code);
      if (!row) throw new Error(`permission.update: permisija ${args.where.code} ne postoji.`);

      Object.assign(row, args.data);
      return clone(row);
    },
  };

  // ---------------------------------------------------------------------------
  //  Pomoćne metode za testove
  // ---------------------------------------------------------------------------

  addUser(row: Partial<FakeUserRow> & { id: string; email: string; passwordHash: string }): FakeUserRow {
    const full: FakeUserRow = {
      firstName: 'Test',
      lastName: 'Korisnik',
      displayName: null,
      status: 'ACTIVE',
      mustChangePassword: false,
      tokenVersion: 1,
      lastLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      timezone: 'Europe/Sarajevo',
      locale: 'bs',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      ...row,
    };
    this.users.set(full.id, full);
    return full;
  }

  addRole(role: Partial<FakeRoleRow> & { id: string; code: string }): FakeRoleRow {
    const full: FakeRoleRow = {
      name: role.code,
      description: null,
      isSystem: false,
      allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
      permissionsVersion: 0,
      priority: 100,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...role,
    };
    this.roles.set(full.id, full);
    return full;
  }

  /** Dodaje permisiju u katalog (fixture). */
  addPermission(permission: Partial<FakePermissionRow> & { code: string }): FakePermissionRow {
    const [module, action] = permission.code.split(':');
    const full: FakePermissionRow = {
      id: randomUUID(),
      module: module ?? '',
      action: action ?? '',
      description: null,
      isSensitive: false,
      ...permission,
    };
    this.permissions.push(full);
    return full;
  }

  /** Dodaje grant (`RolePermission`) — `permission` može biti kod ili ID. */
  addGrant(
    grant: Partial<FakeRolePermissionRow> & { roleId: string; permissionId?: string; permission?: string },
  ): FakeRolePermissionRow {
    const { permission, permissionId: explicitId, ...rest } = grant;
    const permissionId =
      explicitId ?? this.permissions.find((row) => row.code === permission)?.id ?? randomUUID();

    const full: FakeRolePermissionRow = {
      id: randomUUID(),
      scope: 'ALL',
      scopeVehicleIds: [],
      scopeDriverIds: [],
      conditions: null,
      grantedById: null,
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...rest,
      permissionId,
    };
    this.rolePermissions.push(full);
    return full;
  }

  /** Dodaje `UserRole` (bez ugniježđene role — koristi `assignRole` za loader). */
  addUserRole(row: Partial<Omit<FakeUserRoleRow, 'role'>> & { userId: string; roleId: string }): void {
    const role = this.roles.get(row.roleId) ?? this.addRole({ id: row.roleId, code: row.roleId });
    this.userRoles.push({
      revokedAt: null,
      validFrom: null,
      validUntil: null,
      ...row,
      role,
    });
  }

  /** Kod permisije za ID (grantovi u fake-u čuvaju `permissionId`). */
  permissionCode(permissionId: string): string {
    return this.permissions.find((row) => row.id === permissionId)?.code ?? permissionId;
  }

  assignRole(userId: string, role: FakeRoleRow, overrides: Partial<FakeUserRoleRow> = {}): FakeUserRoleRow {
    const entry: FakeUserRoleRow = {
      userId,
      roleId: role.id,
      revokedAt: null,
      validFrom: null,
      validUntil: null,
      role,
      ...overrides,
    };
    this.userRoles.push(entry);
    return entry;
  }

  /** Aktivne sesije korisnika (ne-revokovane i ne-istekle). */
  activeSessions(userId: string): FakeSessionRow[] {
    const now = Date.now();
    return [...this.sessions.values()].filter(
      (row) => row.userId === userId && row.revokedAt === null && row.expiresAt.getTime() > now,
    );
  }

  private matchSessions(where: SessionWhere): FakeSessionRow[] {
    const now = Date.now();

    return [...this.sessions.values()].filter((row) => {
      if (typeof where.id === 'string' && row.id !== where.id) return false;
      if (typeof where.id === 'object' && where.id !== null) {
        const ids = where.id.in as readonly string[];
        if (!ids.includes(row.id)) return false;
      }
      if (where.userId !== undefined && row.userId !== where.userId) return false;
      if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
      if (where.revokedAt === null && row.revokedAt !== null) return false;
      if (where.expiresAt?.gt && !(row.expiresAt.getTime() > (where.expiresAt.gt.getTime() || now))) return false;
      return true;
    });
  }
}

/**
 * Ubacuje fake u DI/konstruktor umjesto `PrismaService`.
 *
 * Cast je namjeran: servis koristi samo podskup API-ja, a generisani Prisma
 * tipovi bi zahtijevali punu implementaciju klijenta.
 */
export function asPrismaService(fake: FakePrismaClient): PrismaService {
  return fake as unknown as PrismaService;
}
