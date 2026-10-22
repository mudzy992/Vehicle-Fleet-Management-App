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
  phone: string | null;
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
  id: string;
  userId: string;
  roleId: string;
  assignedById: string | null;
  revokedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  note: string | null;
  role: FakeRoleRow;
}

export interface FakeFormSchemaRow {
  id: string;
  key: string;
  name: string;
  subject: string;
  status: string;
  currentPublishedVersionId: string | null;
  description?: string | null;
  ownerModule?: string | null;
}

export interface FakeFormSchemaVersionRow {
  id: string;
  formSchemaId: string;
  version: number;
  status: string;
  definition: unknown;
  contentHash?: string | null;
  normalizedName?: unknown;
  mobileCompatible?: boolean;
  publishedAt?: Date | null;
  changeNote?: string | null;
}

export interface FakeFieldKeyRow {
  id: string;
  key: string;
  dataType: string;
  unit: string | null;
  normalizedColumn: string | null;
  usedByFormSchemaIds: string[];
}

export interface FakeVehicleRow {
  id: string;
  internalNo: string;
  make: string;
  model: string;
  year: number | null;
  fuelType: string;
  odometerKm: number;
  plateNumber: string | null;
  status: string;
  formSchemaId: string;
  formSchemaVersionId: string;
}

export interface FakePasswordResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  ipAddress: string | null;
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

/**
 * `@db.Date` prima `Date`, ne `YYYY-MM-DD` — fake baca istu grešku kao Prisma,
 * da seed regresija padne u testu (vidi `apps/api/src/common/dates.ts`).
 */
function assertDbDates(data: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && !(value instanceof Date)) {
      throw new Error(`FakePrisma(@db.Date): \`${key}\` mora biti Date, dobijen ${JSON.stringify(value)}.`);
    }
  }
}

/** Poređenje `@db.Date` vrijednosti: `Date` po vremenu, ostalo po vrijednosti. */
function sameValue(a: unknown, b: unknown): boolean {
  return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
}

export class FakePrismaClient {
  readonly users = new Map<string, FakeUserRow>();
  readonly sessions = new Map<string, FakeSessionRow>();
  readonly roles = new Map<string, FakeRoleRow>();
  readonly userRoles: FakeUserRoleRow[] = [];
  readonly rolePermissions: FakeRolePermissionRow[] = [];
  readonly permissions: FakePermissionRow[] = [];
  readonly passwordResetTokens: FakePasswordResetTokenRow[] = [];
  readonly formSchemas = new Map<string, FakeFormSchemaRow>();
  readonly fieldKeys = new Map<string, FakeFieldKeyRow>();
  readonly formSchemaVersions: FakeFormSchemaVersionRow[] = [];
  readonly taskTypes = new Map<string, Record<string, unknown>>();
  readonly vehicles = new Map<string, FakeVehicleRow>();
  readonly authAttempts: FakeAuthAttemptRow[] = [];
  readonly auditLogs: FakeAuditLogRow[] = [];

  /** Namjerni kvarovi: `{ authAttempt: new Error(...) }` testira otpornost toka. */
  failures: { authAttempt?: Error; auditLog?: Error } = {};

  /** Autoincrement identitet (`AuditLog.id` je `BigInt @default(autoincrement())`). */
  private auditSequence = 0;
  /** Serijalizacija transakcija u memorijskom fake-u (ograničeni DB lock model). */
  private transactionTail: Promise<void> = Promise.resolve();

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
    resetTokenCreate: 0,
    userCreate: 0,
  };

  readonly user = {
    findFirst: async (args?: {
      where?: UserWhere;
      select?: Record<string, unknown>;
    }): Promise<(FakeUserRow & { roles?: Array<{ roleId: string }> }) | null> => {
      this.calls.userFindFirst += 1;
      const where = args?.where ?? {};

      for (const row of this.users.values()) {
        if (where.id !== undefined && row.id !== where.id) continue;
        if (where.email !== undefined && row.email.toLowerCase() !== where.email.toLowerCase()) continue;
        if (where.deletedAt === null && row.deletedAt !== null) continue;

        const result = clone(row) as FakeUserRow & { roles?: Array<{ roleId: string }> };
        // Prisma ugniježđeni `select` — servis traži samo ID-jeve aktivnih rola.
        if (args?.select && 'roles' in args.select) {
          result.roles = this.userRoles
            .filter((entry) => entry.userId === row.id && entry.revokedAt === null)
            .map((entry) => ({ roleId: entry.roleId }));
        }
        return result;
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

    findMany: async (args?: {
      where?: Record<string, unknown>;
      orderBy?: Array<Record<string, 'asc' | 'desc'>> | Record<string, 'asc' | 'desc'>;
      skip?: number;
      take?: number;
    }): Promise<FakeUserRow[]> => {
      const rows = this.matchUsers(args?.where ?? {});
      const skip = args?.skip ?? 0;
      const take = args?.take ?? rows.length;

      return rows.slice(skip, skip + take).map((row) => clone(row));
    },

    count: async (args?: { where?: Record<string, unknown> }): Promise<number> => {
      return this.matchUsers(args?.where ?? {}).length;
    },

    create: async (args: { data: UpdateData }): Promise<FakeUserRow> => {
      this.calls.userCreate += 1;
      const data = args.data as unknown as Partial<FakeUserRow> & { id: string; email: string };

      if (this.users.has(data.id)) throw new Error('FakePrisma: korisnik već postoji.');
      const row: FakeUserRow = {
        passwordHash: data.passwordHash ?? 'hash',
        firstName: data.firstName ?? 'Test',
        lastName: data.lastName ?? 'Korisnik',
        displayName: data.displayName ?? null,
        phone: data.phone ?? null,
        status: data.status ?? 'ACTIVE',
        mustChangePassword: data.mustChangePassword ?? false,
        tokenVersion: data.tokenVersion ?? 0,
        lastLoginAt: data.lastLoginAt ?? null,
        failedLoginCount: data.failedLoginCount ?? 0,
        lockedUntil: null,
        timezone: data.timezone ?? 'Europe/Sarajevo',
        locale: data.locale ?? 'bs',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
        id: data.id,
        email: data.email,
      };
      this.users.set(row.id, row);
      return clone(row);
    },
  };

  readonly refreshSession = {
    create: async (args: { data: UpdateData }): Promise<FakeSessionRow> => {
      this.calls.sessionCreate += 1;
      const data = args.data as unknown as Omit<
        FakeSessionRow,
        'revokedAt' | 'replacedById' | 'lastUsedAt' | 'createdAt'
      >;

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

    count: async (args?: { where?: { userId?: string; revokedAt?: null; expiresAt?: { gt?: Date } } }) => {
      return this.matchSessions((args?.where ?? {}) as SessionWhere).length;
    },
  };

  readonly userRole = {
    findMany: async (args?: { where?: UserRoleWhere }): Promise<Array<{ role: FakeRoleRow }>> => {
      this.calls.userRoleFindMany += 1;
      const where = args?.where ?? {};

      const userIdFilter = where.userId as string | { in?: readonly string[] } | undefined;
      const rows = this.userRoles.filter((entry) => {
        if (typeof userIdFilter === 'string' && entry.userId !== userIdFilter) return false;
        if (
          userIdFilter &&
          typeof userIdFilter === 'object' &&
          userIdFilter.in &&
          !userIdFilter.in.includes(entry.userId)
        ) {
          return false;
        }
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
      return rows.map((entry) => ({ userId: entry.userId, roleId: entry.roleId, role: clone(entry.role) }));
    },

    findFirst: async (args?: {
      where?: { userId?: string; roleId?: string; revokedAt?: null };
      select?: Record<string, unknown>;
    }): Promise<FakeUserRoleRow | null> => {
      const where = args?.where ?? {};
      const row = this.userRoles.find(
        (entry) =>
          (where.userId === undefined || entry.userId === where.userId) &&
          (where.roleId === undefined || entry.roleId === where.roleId) &&
          (where.revokedAt !== null || entry.revokedAt === null),
      );
      return row ? clone(row) : null;
    },

    create: async (args: { data: Record<string, unknown> }): Promise<FakeUserRoleRow> => {
      const data = args.data as { id: string; userId: string; roleId: string };
      const role = this.roles.get(data.roleId) ?? this.addRole({ id: data.roleId, code: data.roleId });

      const row: FakeUserRoleRow = {
        id: data.id,
        userId: data.userId,
        roleId: data.roleId,
        assignedById: (args.data.assignedById as string | undefined) ?? null,
        revokedAt: null,
        validFrom: (args.data.validFrom as Date | undefined) ?? null,
        validUntil: (args.data.validUntil as Date | undefined) ?? null,
        note: (args.data.note as string | undefined) ?? null,
        role,
      };
      this.userRoles.push(row);
      return clone(row);
    },

    update: async (args: { where: { id: string }; data: UpdateData }): Promise<FakeUserRoleRow> => {
      const row = this.userRoles.find((entry) => entry.id === args.where.id);
      if (!row) throw new Error(`FakePrisma: dodjela role ${args.where.id} ne postoji.`);

      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return clone(row);
    },

    createMany: async (args: {
      data: ReadonlyArray<{ id: string; userId: string; roleId: string }>;
    }): Promise<{ count: number }> => {
      for (const data of args.data) {
        const role = this.roles.get(data.roleId) ?? this.addRole({ id: data.roleId, code: data.roleId });
        this.userRoles.push({
          id: data.id,
          userId: data.userId,
          roleId: data.roleId,
          assignedById: null,
          revokedAt: null,
          validFrom: null,
          validUntil: null,
          note: null,
          role,
        });
      }
      return { count: args.data.length };
    },

    updateMany: async (args: {
      where: { userId?: string };
      data: UpdateData;
    }): Promise<{ count: number }> => {
      const rows = this.userRoles.filter(
        (entry) => args.where.userId === undefined || entry.userId === args.where.userId,
      );
      for (const row of rows) applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return { count: rows.length };
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
      where?: Record<string, unknown>;
      orderBy?: { createdAt?: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<FakeAuditLogRow[]> => {
      this.calls.auditLogFindMany += 1;
      const rows = this.matchAuditLogs(args?.where ?? {});

      const direction = args?.orderBy?.createdAt ?? 'desc';
      rows.sort((left, right) =>
        direction === 'desc'
          ? right.createdAt.getTime() - left.createdAt.getTime()
          : left.createdAt.getTime() - right.createdAt.getTime(),
      );

      const skip = args?.skip ?? 0;
      const take = args?.take ?? rows.length;
      return rows.slice(skip, skip + take).map((row) => clone(row));
    },

    count: async (args?: { where?: Record<string, unknown> }): Promise<number> => {
      return this.matchAuditLogs(args?.where ?? {}).length;
    },

    findUnique: async (args: { where: { id: bigint | number } }): Promise<FakeAuditLogRow | null> => {
      const id = Number(args.where.id);
      const row = this.auditLogs.find((entry) => entry.id === id);
      return row ? clone(row) : null;
    },
  };

  readonly formSchema = {
    findUnique: async (args: { where: { key?: string; id?: string } }) => {
      for (const row of this.formSchemas.values()) {
        if (args.where.key !== undefined && row.key !== args.where.key) continue;
        if (args.where.id !== undefined && row.id !== args.where.id) continue;
        return clone(row);
      }
      return null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const data = args.data as unknown as FakeFormSchemaRow;
      const row: FakeFormSchemaRow = { ...data, currentPublishedVersionId: null };
      this.formSchemas.set(data.id, row);
      return clone(row);
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.formSchemas.get(args.where.id);
      if (!row) throw new Error(`FakePrisma: forma ${args.where.id} ne postoji.`);
      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return clone(row);
    },
  };

  readonly formSchemaVersion = {
    create: async (args: { data: Record<string, unknown> }) => {
      const data = args.data as unknown as FakeFormSchemaVersionRow;
      this.formSchemaVersions.push(data);
      return clone(data);
    },
  };

  readonly taskType = {
    findUnique: async (args: { where: { code?: string; id?: string } }) => {
      for (const row of this.taskTypes.values()) {
        if (args.where.code !== undefined && row.code !== args.where.code) continue;
        if (args.where.id !== undefined && row.id !== args.where.id) continue;
        return clone(row);
      }
      return null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const data = { ...args.data };
      if ([...this.taskTypes.values()].some((row) => row.code === data.code)) {
        throw new Error(`FakePrisma: vrsta zadatka ${String(data.code)} već postoji.`);
      }
      this.taskTypes.set(String(data.id), data);
      return clone(data);
    },
  };

  readonly fieldKeyRegistry = {
    findUnique: async (args: { where: { key: string } }) => {
      const row = this.fieldKeys.get(args.where.key);
      return row ? clone(row) : null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const data = args.data as unknown as FakeFieldKeyRow;
      this.fieldKeys.set(data.key, { ...data });
      return clone(data);
    },
    update: async (args: { where: { key: string }; data: Record<string, unknown> }) => {
      const row = this.fieldKeys.get(args.where.key);
      if (!row) throw new Error(`FakePrisma: ključ ${args.where.key} nije u registru.`);
      applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return clone(row);
    },
  };

  readonly vehicle = {
    findUnique: async (args: { where: { internalNo: string } }) => {
      for (const row of this.vehicles.values()) {
        if (row.internalNo === args.where.internalNo) return clone(row);
      }
      return null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const data = args.data as unknown as FakeVehicleRow;
      if ([...this.vehicles.values()].some((row) => row.internalNo === data.internalNo)) {
        throw new Error(`FakePrisma: vozilo ${data.internalNo} već postoji.`);
      }
      this.vehicles.set(data.id, data);
      return clone(data);
    },
    count: async () => this.vehicles.size,
    findMany: async (args: { where?: Record<string, unknown> }) =>
      [...this.vehicles.values()]
        .filter(
          (row) =>
            args.where?.deletedAt !== null ||
            (row as unknown as { deletedAt?: Date | null }).deletedAt == null,
        )
        .map((row) => clone(row)),
    updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.vehicles.get(args.where.id);
      if (!row) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  };

  readonly drivers = new Map<string, Record<string, unknown>>();
  readonly driverCategories: Array<Record<string, unknown>> = [];
  readonly registrations: Array<Record<string, unknown>> = [];
  readonly reminderPolicies = new Map<string, Record<string, unknown>>();

  readonly driver = {
    findFirst: async (args: { where: { employeeNumber?: string } }) => {
      for (const row of this.drivers.values()) {
        if (args.where.employeeNumber === undefined || row.employeeNumber === args.where.employeeNumber) {
          return clone(row);
        }
      }
      return null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const data = { ...args.data } as Record<string, unknown>;
      assertDbDates(data, ['dateOfBirth', 'licenseIssuedAt', 'licenseExpiresAt']);
      if (this.drivers.has(String(data.id))) {
        throw new Error('FakePrisma: vozač već postoji.');
      }
      this.drivers.set(String(data.id), data);
      return clone(data);
    },
  };

  readonly driverLicenseCategory = {
    create: async (args: { data: Record<string, unknown> }) => {
      assertDbDates(args.data, ['issuedAt', 'expiresAt']);
      this.driverCategories.push({ ...args.data });
      return clone(args.data);
    },
  };

  readonly registrationRecord = {
    findFirst: async (args: { where: { vehicleId?: string; validFrom?: Date | string } }) => {
      for (const row of this.registrations) {
        if (
          (args.where.vehicleId === undefined || row.vehicleId === args.where.vehicleId) &&
          (args.where.validFrom === undefined || sameValue(row.validFrom, args.where.validFrom))
        ) {
          return clone(row);
        }
      }
      return null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      assertDbDates(args.data, ['validFrom', 'validUntil']);
      this.registrations.push({ ...args.data });
      return clone(args.data);
    },
  };

  readonly reminderPolicy = {
    findUnique: async (args: { where: { kind: string } }) =>
      this.reminderPolicies.get(args.where.kind) ?? null,
    create: async (args: { data: Record<string, unknown> }) => {
      const data = { ...args.data } as Record<string, unknown>;
      this.reminderPolicies.set(String(data.kind), data);
      return clone(data);
    },
  };

  readonly passwordResetToken = {
    create: async (args: { data: UpdateData }): Promise<FakePasswordResetTokenRow> => {
      this.calls.resetTokenCreate += 1;
      const data = args.data as unknown as Omit<
        FakePasswordResetTokenRow,
        'usedAt' | 'createdAt' | 'ipAddress'
      >;

      const row: FakePasswordResetTokenRow = {
        id: data.id,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        usedAt: null,
        createdById: data.createdById ?? null,
        createdAt: new Date(),
        ipAddress: null,
      };
      this.passwordResetTokens.push(row);
      return clone(row);
    },

    findUnique: async (args: { where: { tokenHash: string } }): Promise<FakePasswordResetTokenRow | null> => {
      const row = this.passwordResetTokens.find((entry) => entry.tokenHash === args.where.tokenHash);
      return row ? clone(row) : null;
    },

    updateMany: async (args: {
      where: { id?: string; userId?: string; usedAt?: null; expiresAt?: { gt?: Date } };
      data: { usedAt?: Date };
    }): Promise<{ count: number }> => {
      const rows = this.passwordResetTokens.filter(
        (entry) =>
          (args.where.id === undefined || entry.id === args.where.id) &&
          (args.where.userId === undefined || entry.userId === args.where.userId) &&
          (args.where.usedAt !== null || entry.usedAt === null) &&
          (args.where.expiresAt?.gt === undefined || entry.expiresAt > args.where.expiresAt.gt),
      );
      for (const row of rows) {
        if (args.data.usedAt) row.usedAt = args.data.usedAt;
      }
      return { count: rows.length };
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
   * `$transaction` koristi isti fake kao `tx` i serijalizira callback-e kako bi
   * CAS/regresijski testovi modelirali osnovni red-lock redoslijed. Rollback i
   * PostgreSQL izolacija i dalje se ne simuliraju; to traži live DB test.
   */
  readonly $transaction = async <T>(fn: (tx: FakePrismaClient) => Promise<T>): Promise<T> => {
    this.calls.transaction += 1;
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn(this);
    } finally {
      release();
    }
  };

  readonly role = {
    findMany: async (args?: {
      where?: {
        deletedAt?: null;
        id?: { in?: readonly string[] } | string;
        code?: { in?: readonly string[] } | string;
      };
    }) => {
      const where = args?.where ?? {};
      const ids = typeof where.id === 'object' ? where.id?.in : where.id ? [where.id] : undefined;
      const codes = typeof where.code === 'object' ? where.code?.in : where.code ? [where.code] : undefined;

      return [...this.roles.values()]
        .filter((row) => (where.deletedAt === null ? row.deletedAt === null : true))
        .filter((row) => (ids ? ids.includes(row.id) : true))
        .filter((row) => (codes ? codes.includes(row.code) : true))
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

    findUnique: async (args: { where: { id?: string; code?: string } }): Promise<FakeRoleRow | null> => {
      for (const row of this.roles.values()) {
        if (args.where.id !== undefined && row.id !== args.where.id) continue;
        if (args.where.code !== undefined && row.code !== args.where.code) continue;
        if (args.where.id === undefined && args.where.code === undefined) continue;
        return clone(row);
      }
      return null;
    },

    upsert: async (args: {
      where: { code: string };
      create: Partial<FakeRoleRow> & { id: string; code: string };
      update: Record<string, unknown>;
    }): Promise<FakeRoleRow> => {
      const existing = [...this.roles.values()].find((row) => row.code === args.where.code);
      if (!existing) return clone(this.addRole(args.create));

      applyUpdate(existing as unknown as Record<string, unknown>, args.update);
      existing.updatedAt = new Date();
      return clone(existing);
    },

    updateMany: async (args: {
      where: { code?: { in?: readonly string[] } };
      data: Record<string, unknown>;
    }): Promise<{ count: number }> => {
      const codes = args.where.code?.in ?? [...this.roles.values()].map((row) => row.code);
      const rows = [...this.roles.values()].filter((row) => codes.includes(row.code));

      for (const row of rows) applyUpdate(row as unknown as Record<string, unknown>, args.data);
      return { count: rows.length };
    },

    create: async (args: {
      data: Partial<FakeRoleRow> & { id: string; code: string };
    }): Promise<FakeRoleRow> => {
      this.calls.roleCreate += 1;
      if (this.roles.has(args.data.id)) throw new Error('role.create: duplikat id');
      const row = this.addRole(args.data);
      return clone(row);
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }): Promise<FakeRoleRow> => {
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
      const ids = typeof where.roleId === 'string' ? [where.roleId] : (where.roleId?.in ?? undefined);
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

    createMany: async (args: {
      data: readonly FakeRolePermissionRow[];
      skipDuplicates?: boolean;
    }): Promise<{ count: number }> => {
      let inserted = 0;
      for (const row of args.data) {
        const duplicate = this.rolePermissions.some(
          (entry) => entry.roleId === row.roleId && entry.permissionId === row.permissionId,
        );
        if (duplicate && args.skipDuplicates) continue;

        this.rolePermissions.push(clone(row));
        inserted += 1;
      }
      return { count: inserted };
    },
  };

  readonly permission = {
    upsert: async (args: {
      where: { code: string };
      create: FakePermissionRow;
      update: Partial<FakePermissionRow>;
    }): Promise<FakePermissionRow> => {
      const existing = this.permissions.find((row) => row.code === args.where.code);
      if (!existing) {
        this.permissions.push(clone(args.create));
        return clone(args.create);
      }

      Object.assign(existing, args.update);
      return clone(existing);
    },

    findMany: async (args?: {
      where?: { code?: { in?: readonly string[] } };
    }): Promise<FakePermissionRow[]> => {
      const ids = args?.where?.code?.in;

      return this.permissions.filter((row) => (ids ? ids.includes(row.code) : true)).map((row) => clone(row));
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
      phone: null,
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
      id: randomUUID(),
      assignedById: null,
      revokedAt: null,
      validFrom: null,
      validUntil: null,
      note: null,
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
      id: randomUUID(),
      userId,
      roleId: role.id,
      assignedById: null,
      revokedAt: null,
      validFrom: null,
      validUntil: null,
      note: null,
      role,
      ...overrides,
    };
    this.userRoles.push(entry);
    return entry;
  }

  /** Dodaje audit zapis (fixture) — `AuditLog.id` je autoincrement u fake-u. */
  addAuditLog(row: Partial<Omit<FakeAuditLogRow, 'id'>>): FakeAuditLogRow {
    this.auditSequence += 1;
    const full: FakeAuditLogRow = {
      id: this.auditSequence,
      actorId: null,
      actorEmail: null,
      actorRoles: [],
      action: 'UPDATE',
      severity: 'INFO',
      entityType: null,
      entityId: null,
      before: null,
      after: null,
      changedFields: [],
      reason: null,
      requestId: null,
      ipAddress: null,
      userAgent: null,
      clientType: null,
      metadata: null,
      createdAt: new Date(),
      ...row,
    };
    this.auditLogs.push(full);
    return full;
  }

  /** Dodaje aktivnu sesiju (fixture) — koristi se u testovima revokacije. */
  addSession(session: {
    userId: string;
    tokenHash: string;
    expiresAt?: Date;
    clientType?: string;
  }): FakeSessionRow {
    const row: FakeSessionRow = {
      id: randomUUID(),
      userId: session.userId,
      tokenHash: session.tokenHash,
      familyId: randomUUID(),
      clientType: session.clientType ?? 'WEB',
      deviceInfo: null,
      ipAddress: null,
      userAgent: null,
      expiresAt: session.expiresAt ?? new Date(Date.now() + 86_400_000),
      revokedAt: null,
      replacedById: null,
      lastUsedAt: null,
      createdAt: new Date(),
    };
    this.sessions.set(row.id, row);
    return row;
  }

  /** Aktivne sesije korisnika (ne-revokovane i ne-istekle). */
  activeSessions(userId: string): FakeSessionRow[] {
    const now = Date.now();
    return [...this.sessions.values()].filter(
      (row) => row.userId === userId && row.revokedAt === null && row.expiresAt.getTime() > now,
    );
  }

  /**
   * Filtriranje audit zapisa (podskup `AuditLogWhereInput` koji servis koristi):
   * tačna polja + `severity: {not}` + `createdAt: {gte,lte}`.
   */
  private matchAuditLogs(where: Record<string, unknown>): FakeAuditLogRow[] {
    return this.auditLogs.filter((row) => {
      for (const key of ['action', 'actorId', 'entityType', 'entityId'] as const) {
        const expected = where[key];
        if (typeof expected === 'string' && (row[key] as string) !== expected) return false;
      }

      const severity = where.severity;
      if (typeof severity === 'string' && row.severity !== severity) return false;
      if (severity && typeof severity === 'object') {
        const not = (severity as { not?: string }).not;
        if (not && row.severity === not) return false;
      }

      const createdAt = where.createdAt as { gte?: Date; lte?: Date } | undefined;
      if (createdAt?.gte && row.createdAt.getTime() < createdAt.gte.getTime()) return false;
      if (createdAt?.lte && row.createdAt.getTime() > createdAt.lte.getTime()) return false;

      return true;
    });
  }

  /**
   * Filtriranje korisnika za `findMany`/`count`.
   *
   * Podržava samo oblike koje `UsersService` koristi: `deletedAt`, `status`,
   * `roles.some.roleId` i `OR` s `contains` (case-insensitive). Namjerno nije
   * generički SQL engine — dovoljno da testovi dokazuju filtere i paginaciju.
   */
  private matchUsers(where: Record<string, unknown>): FakeUserRow[] {
    const rows = [...this.users.values()];

    return rows
      .filter((row) => (where.deletedAt === null ? row.deletedAt === null : true))
      .filter((row) => {
        if (where.status === undefined) return true;
        if (typeof where.status === 'string') return row.status === where.status;

        const inList = (where.status as { in?: readonly string[] }).in;
        return inList ? inList.includes(row.status) : true;
      })
      .filter((row) => {
        const roleFilter = where.roles as
          | {
              some?: {
                roleId?: string;
                revokedAt?: null;
                role?: { code?: string; deletedAt?: null };
              };
            }
          | undefined;
        const some = roleFilter?.some;
        if (!some || (!some.roleId && !some.role?.code)) return true;

        return this.userRoles.some((entry) => {
          if (entry.userId !== row.id || entry.revokedAt !== null) return false;
          if (some.roleId && entry.roleId !== some.roleId) return false;
          if (some.role?.code && entry.role.code !== some.role.code) return false;
          if (some.role?.deletedAt === null && entry.role.deletedAt !== null) return false;
          return true;
        });
      })
      .filter((row) => {
        const branches = where.OR as Array<Record<string, { contains?: string }>> | undefined;
        if (!branches) return true;

        return branches.some((branch) =>
          Object.entries(branch).some(([field, condition]) => {
            const needle = condition?.contains?.toLowerCase();
            if (!needle) return false;
            const value = String((row as unknown as Record<string, unknown>)[field] ?? '').toLowerCase();
            return value.includes(needle);
          }),
        );
      })
      .sort(
        (left, right) =>
          left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName),
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
      if (where.expiresAt?.gt && !(row.expiresAt.getTime() > (where.expiresAt.gt.getTime() || now)))
        return false;
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
