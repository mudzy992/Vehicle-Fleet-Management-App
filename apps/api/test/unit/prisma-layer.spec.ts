import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseEnv, type BaseEnv } from '@vfm/shared/env';
import { __resetEnvCache } from '../../src/config/env.js';
import {
  PING_TIMEOUT_MS,
  PrismaService,
  buildPrismaAdapter,
  prismaConnectionOptions,
} from '../../src/prisma/prisma.service.js';
import { PrismaPermissionsLoader } from '../../src/modules/auth/permissions/prisma-permissions.loader.js';

/**
 * Prisma sloj (Faza 1): konfiguracija pool-a, `ping()` (stvarni `SELECT 1`) i
 * RBAC loader nad bazom.
 *
 * Testovi NE otvaraju mrežne konekcije: pg.Pool je lenj, a `$queryRaw` se
 * zamjenjuje po testu. Time je pokriveno ono što je u produkciji već dva puta
 * palo (nedostupan engine, P3005) bez ovisnosti o stvarnom PostgreSQL-u.
 */

const DATABASE_URL = 'postgresql://vfm:secret@vfm-postgres-global:5432/vehicle';
const USER_ID = '018f0000-0000-7000-8000-0000000000a1';

const services: PrismaService[] = [];

function makeService(): PrismaService {
  const service = new PrismaService();
  services.push(service);
  return service;
}

/** Zamjenjuje `$queryRaw` na instanci (prototip/property — radi u oba slučaja). */
function stubQueryRaw(service: PrismaService, implementation: () => Promise<unknown>): void {
  Object.defineProperty(service, '$queryRaw', {
    value: implementation,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.DATABASE_CONNECTION_LIMIT = '7';
  process.env.DATABASE_POOL_TIMEOUT = '5';
  process.env.DATABASE_SSL = 'false';
  __resetEnvCache();
});

afterEach(async () => {
  for (const service of services.splice(0)) await service.$disconnect().catch(() => undefined);
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_CONNECTION_LIMIT;
  delete process.env.DATABASE_POOL_TIMEOUT;
  delete process.env.DATABASE_SSL;
  __resetEnvCache();
});

describe('prismaConnectionOptions', () => {
  it('mapira ENV na pg.Pool opcije (limit, timeout u ms, ssl)', () => {
    const env = parseEnv({
      DATABASE_URL,
      DATABASE_CONNECTION_LIMIT: '7',
      DATABASE_POOL_TIMEOUT: '5',
      DATABASE_SSL: 'true',
    });

    expect(prismaConnectionOptions(env)).toEqual({
      connectionString: DATABASE_URL,
      max: 7,
      connectionTimeoutMillis: 5_000,
      ssl: true,
    });
  });

  it('koristi defaulte iz ENV šeme (10 konekcija, 20 s timeout, ssl off)', () => {
    const env = parseEnv({ DATABASE_URL });
    const options = prismaConnectionOptions(env);

    expect(options.max).toBe(10);
    expect(options.connectionTimeoutMillis).toBe(20_000);
    expect(options.ssl).toBe(false);
  });

  it('baca jasnu grešku kad DATABASE_URL nedostaje (fail fast pri bootu)', () => {
    const env = parseEnv({}) as BaseEnv;
    expect(() => prismaConnectionOptions(env)).toThrow(/DATABASE_URL/u);
  });

  it('odbija DATABASE_URL koji je samo prazan prostor', () => {
    const env = { ...parseEnv({}), DATABASE_URL: '   ' } as BaseEnv;
    expect(() => prismaConnectionOptions(env)).toThrow(/DATABASE_URL/u);
  });
});

describe('buildPrismaAdapter', () => {
  it('vraća PrismaPg adapter bez otvaranja konekcije', () => {
    const adapter = buildPrismaAdapter(prismaConnectionOptions(parseEnv({ DATABASE_URL })));
    expect(adapter).toBeInstanceOf(PrismaPg);
  });

  it('sa ssl=true gradi TLS opcije (interno: bez provjere CA)', () => {
    const adapter = buildPrismaAdapter({
      connectionString: DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 1_000,
      ssl: true,
    });
    expect(adapter).toBeInstanceOf(PrismaPg);
  });
});

describe('PrismaService.ping', () => {
  it('SELECT 1 prolazi → ok s latencijom', async () => {
    const service = makeService();
    stubQueryRaw(service, async () => [{ '?column?': 1 }]);

    const ping = await service.ping();
    expect(ping.ok).toBe(true);
    if (ping.ok) expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('greška baze se vraća kao ok=false s porukom (ne baca)', async () => {
    const service = makeService();
    stubQueryRaw(service, async () => {
      throw new Error('P1010: User was denied access on the database');
    });

    const ping = await service.ping();
    expect(ping.ok).toBe(false);
    if (!ping.ok) expect(ping.error).toContain('P1010');
  });

  it('timeout se poštuje i ne drži event loop otvorenim', async () => {
    const service = makeService();
    stubQueryRaw(service, () => new Promise(() => undefined)); // nikad ne rezolvuje

    const started = Date.now();
    const ping = await service.ping(30);

    expect(ping.ok).toBe(false);
    if (!ping.ok) expect(ping.error).toMatch(/timeout nakon 30 ms/u);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('defaultni timeout je PING_TIMEOUT_MS', async () => {
    expect(PING_TIMEOUT_MS).toBe(3_000);
  });
});

/** Red kakav vraća Prisma `user.findFirst` s select-om iz loadera. */
function fakeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    status: 'ACTIVE',
    tokenVersion: 3,
    mustChangePassword: true,
    roles: [
      {
        role: {
          id: '018f0000-0000-7000-8000-0000000000r1',
          code: 'ADMINISTRATOR',
          permissionsVersion: 2,
          allowedClientTypes: ['WEB'],
          permissions: [
            {
              scope: 'VEHICLE_IDS',
              scopeVehicleIds: ['018f0000-0000-7000-8000-000000000v01'],
              scopeDriverIds: [],
              conditions: null,
              permission: { code: 'vehicle:view' },
            },
            {
              scope: 'ALL',
              scopeVehicleIds: [],
              scopeDriverIds: [],
              conditions: { minAge: 18 },
              permission: { code: 'task:create' },
            },
          ],
        },
      },
      {
        role: {
          id: '018f0000-0000-7000-8000-0000000000r2',
          code: 'NEPOZNATA_ULOGA',
          permissionsVersion: 9,
          allowedClientTypes: ['MOBILE_ANDROID'],
          permissions: [
            {
              scope: 'DRIVER_IDS',
              scopeVehicleIds: [],
              scopeDriverIds: ['018f0000-0000-7000-8000-000000000d01'],
              conditions: ['nije', 'objekat'],
              permission: { code: 'driver:view' },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function fakePrisma(row: unknown) {
  // Parametar je namjerno tipiziran: test čita `mock.calls[0][0]` (Prisma args).
  const findFirst = vi.fn(async (_args: unknown): Promise<unknown> => row);
  return { prisma: { user: { findFirst } } as unknown as PrismaService, findFirst };
}

describe('PrismaPermissionsLoader', () => {
  it('mapira snapshot: uloge, klijenti, grantovi, verzije', async () => {
    const { prisma, findFirst } = fakePrisma(fakeUserRow());
    const loader = new PrismaPermissionsLoader(prisma);

    const snapshot = await loader.loadSnapshot(USER_ID);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(snapshot).toBeDefined();
    expect(snapshot?.userId).toBe(USER_ID);
    expect(snapshot?.status).toBe('ACTIVE');
    expect(snapshot?.tokenVersion).toBe(3);
    expect(snapshot?.mustChangePassword).toBe(true);
    // Nepoznat kod uloge se odbacuje iz `roles` (JWT claim), ali roleIds ostaju.
    expect(snapshot?.roles).toEqual(['ADMINISTRATOR']);
    expect(snapshot?.roleIds).toHaveLength(2);
    expect(snapshot?.allowedClientTypes).toEqual(['WEB', 'MOBILE_ANDROID']);
    // Najveći `Role.permissionsVersion` pobjeđuje (P3: revokacija ≤ 5 s).
    expect(snapshot?.permissionsVersion).toBe(9);
  });

  it('grantovi nose opseg i ID liste (VEHICLE_IDS / DRIVER_IDS / ALL)', async () => {
    const { prisma } = fakePrisma(fakeUserRow());
    const snapshot = await new PrismaPermissionsLoader(prisma).loadSnapshot(USER_ID);

    expect(snapshot?.grants).toEqual([
      {
        permission: 'vehicle:view',
        scope: 'VEHICLE_IDS',
        scopeVehicleIds: ['018f0000-0000-7000-8000-000000000v01'],
        conditions: null,
      },
      {
        permission: 'task:create',
        scope: 'ALL',
        conditions: { minAge: 18 },
      },
      {
        permission: 'driver:view',
        scope: 'DRIVER_IDS',
        scopeDriverIds: ['018f0000-0000-7000-8000-000000000d01'],
        // JSONB koji nije objekat ne smije ući u `conditions` (whitelist evaluator).
        conditions: null,
      },
    ]);
  });

  it('upit filtrira obrisane korisnike i revokovane/istorijske uloge', async () => {
    const { prisma, findFirst } = fakePrisma(fakeUserRow());
    await new PrismaPermissionsLoader(prisma).loadSnapshot(USER_ID);

    const args = findFirst.mock.calls[0]?.[0] as unknown as {
      where: { id: string; deletedAt: null };
      select: {
        roles: {
          where: {
            revokedAt: null;
            role: { deletedAt: null };
            AND: readonly Record<string, unknown>[];
          };
        };
      };
    };

    // Korisnik: bez soft-deleted zapisa.
    expect(args.where.id).toBe(USER_ID);
    expect(args.where.deletedAt).toBeNull();

    // Uloge: filteri stoje u `select.roles.where` (Prisma relacijski filter).
    const roleWhere = args.select.roles.where;
    expect(roleWhere.revokedAt).toBeNull();
    expect(roleWhere.role).toEqual({ deletedAt: null });
    // validFrom/validUntil se provjeravaju prema trenutnom vremenu (2 AND grane).
    expect(roleWhere.AND).toHaveLength(2);
    expect(JSON.stringify(roleWhere.AND)).toContain('validFrom');
    expect(JSON.stringify(roleWhere.AND)).toContain('validUntil');
  });

  it('nepostojeći korisnik → undefined (guard vraća 401, nikad 404)', async () => {
    const { prisma } = fakePrisma(undefined);
    await expect(new PrismaPermissionsLoader(prisma).loadSnapshot(USER_ID)).resolves.toBeUndefined();
  });

  it('korisnik bez uloga → prazni grantovi i permissionsVersion 0', async () => {
    const { prisma } = fakePrisma(fakeUserRow({ roles: [] }));
    const snapshot = await new PrismaPermissionsLoader(prisma).loadSnapshot(USER_ID);

    expect(snapshot?.roles).toEqual([]);
    expect(snapshot?.grants).toEqual([]);
    expect(snapshot?.allowedClientTypes).toEqual([]);
    expect(snapshot?.permissionsVersion).toBe(0);
  });
});
