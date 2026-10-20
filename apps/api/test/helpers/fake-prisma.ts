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
 * - nema transakcija (`$transaction` se ne koristi u auth tokovima).
 */
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
  priority: number;
  deletedAt: Date | null;
}

export interface FakeUserRoleRow {
  userId: string;
  roleId: string;
  revokedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  role: FakeRoleRow;
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
  readonly userRoles: FakeUserRoleRow[] = [];
  readonly authAttempts: FakeAuthAttemptRow[] = [];

  /** Namjerni kvarovi: `{ authAttempt: new Error(...) }` testira otpornost toka. */
  failures: { authAttempt?: Error } = {};

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
    return { name: role.code, priority: 100, deletedAt: null, ...role };
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
