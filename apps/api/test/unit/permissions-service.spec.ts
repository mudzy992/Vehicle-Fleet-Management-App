import { beforeEach, describe, expect, it } from 'vitest';
import { REDIS_NS, type ClientType } from '@vfm/shared';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PERMISSIONS_LOADER } from '../../src/modules/auth/permissions/permissions.types.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import {
  ADMIN_GRANTS,
  ADMIN_SNAPSHOT,
  DRIVER_SNAPSHOT,
  FakeLoader,
  FakeRedis,
  ROLE_ADMIN_ID,
  SUPER_ADMIN_SNAPSHOT,
  USER_ADMIN,
  USER_DRIVER,
  USER_SUPER,
  VEHICLE_1,
  VEHICLE_2,
  DRIVER_1,
  fakeRedisService,
} from '../helpers/rbac-fakes.js';

/**
 * `PermissionsService` — RBAC keš, revokacija (P3) i evaluacija opsega.
 *
 * Fake-ovi (`FakeRedis`, `FakeLoader`) su u `test/helpers/rbac-fakes.ts` i dijele
 * ih i guard testovi. `FakeRedis` namjerno ne implementira `KEYS` (ACL ga
 * zabranjuje) → brisanje keša mora ići preko `SCAN MATCH`.
 */

let redis: FakeRedis;
let loader: FakeLoader;
let service: PermissionsService;

function build(options: { available?: boolean; withLoader?: boolean } = {}): PermissionsService {
  return new PermissionsService(
    fakeRedisService(redis, options.available ?? true),
    options.withLoader === false ? undefined : loader,
  );
}

beforeEach(() => {
  redis = new FakeRedis();
  loader = new FakeLoader([SUPER_ADMIN_SNAPSHOT, ADMIN_SNAPSHOT, DRIVER_SNAPSHOT]);
  service = build();
});

/** Baci i vrati grešku kao `VfmException`. */
async function captureError(promise: Promise<unknown>): Promise<VfmException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}

describe('PermissionsService — efektivna prava', () => {
  it('Super Admin na webu ima sve permisije s opsegom ALL (R-07)', async () => {
    const result = await service.effective(USER_SUPER, 'WEB');

    expect(result?.isSuperAdmin).toBe(true);
    expect(result?.list.length).toBeGreaterThan(100);
    expect(result?.permissions.get('user:create')).toBe('ALL');
  });

  it('Super Admin na mobilnom klijentu nema nijedno pravo (N-05/P1 — drugi sloj odbrane)', async () => {
    for (const clientType of ['MOBILE_ANDROID', 'MOBILE_IOS'] as ClientType[]) {
      const result = await service.effective(USER_SUPER, clientType);

      expect(result?.isSuperAdmin, clientType).toBe(false);
      expect(result?.list, clientType).toEqual([]);
    }
  });

  it('neaktivan nalog nema nijedno pravo', async () => {
    loader.update(USER_ADMIN, { status: 'SUSPENDED' });

    const result = await service.effective(USER_ADMIN, 'WEB');

    expect(result?.list).toEqual([]);
    expect(await service.hasPermission(USER_ADMIN, 'vehicle:view')).toBe(false);
  });

  it('Administrator: ima dodijeljene, nema nedodijeljene permisije', async () => {
    expect(await service.hasPermission(USER_ADMIN, 'vehicle:create', 'ALL')).toBe(true);
    expect(await service.hasPermission(USER_ADMIN, 'user:create')).toBe(false);
    expect(await service.hasPermission(USER_ADMIN, 'role:update')).toBe(false);
  });

  it('nepostojeći korisnik → undefined (guard javlja 401, ne 404)', async () => {
    await expect(service.effective('nepostojeci-id')).resolves.toBeUndefined();
    await expect(service.hasPermission('nepostojeci-id', 'vehicle:view')).resolves.toBe(false);
  });

  it('assertPermission baca 403 PERMISSION_DENIED s tačnim kodovima koji nedostaju', async () => {
    const error = await captureError(
      service.assertPermission(USER_ADMIN, ['vehicle:view', 'user:create', 'role:update']),
    );

    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.httpStatus).toBe(403);
    expect(error.details?.map((detail) => detail.path[0])).toEqual(['user:create', 'role:update']);
  });

  it('assertPermission prolazi kad su sve tražene permisije prisutne', async () => {
    const result = await service.assertPermission(USER_ADMIN, ['vehicle:view', 'task:execute']);

    expect(result.isSuperAdmin).toBe(false);
  });

  it('permisija s užim opsegom ne zadovoljava zahtjev za širim (OWN < ALL)', async () => {
    expect(await service.hasPermission(USER_DRIVER, 'task:execute', 'OWN')).toBe(true);
    expect(await service.hasPermission(USER_DRIVER, 'task:execute', 'ALL')).toBe(false);
  });
});

describe('PermissionsService — opseg (ALL / OWN / VEHICLE_IDS / DRIVER_IDS)', () => {
  it('ALL: pristup svakom zapisu', async () => {
    const check = await service.checkScope(USER_ADMIN, 'vehicle:view', { vehicleId: VEHICLE_2 });

    expect(check).toMatchObject({ allowed: true, scope: 'ALL' });
  });

  it('VEHICLE_IDS: dozvoljeno samo vozilo s liste', async () => {
    const allowed = await service.checkScope(USER_DRIVER, 'vehicle:view', { vehicleId: VEHICLE_1 });
    const denied = await service.checkScope(USER_DRIVER, 'vehicle:view', { vehicleId: VEHICLE_2 });

    expect(allowed).toMatchObject({ allowed: true, scope: 'VEHICLE_IDS' });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('vozilo');
  });

  it('DRIVER_IDS: dozvoljen samo vozač s liste', async () => {
    const allowed = await service.checkScope(USER_DRIVER, 'task:view', { driverId: DRIVER_1 });
    const denied = await service.checkScope(USER_DRIVER, 'task:view', {
      driverId: '018f0000-0000-7000-8000-000000000d99',
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  it('OWN: samo vlastiti zapis', async () => {
    const own = await service.checkScope(USER_DRIVER, 'fuel:create', { ownerId: USER_DRIVER });
    const foreign = await service.checkScope(USER_DRIVER, 'fuel:create', { ownerId: USER_ADMIN });

    expect(own).toMatchObject({ allowed: true, scope: 'OWN' });
    expect(foreign.allowed).toBe(false);
  });

  it('Super Admin prolazi svaki opseg', async () => {
    const check = await service.checkScope(USER_SUPER, 'fuel:create', { ownerId: USER_ADMIN });

    expect(check).toMatchObject({ allowed: true, scope: 'ALL' });
  });

  it('assertScope baca 403 SCOPE_DENIED (P14 — bez podataka preko direktnog URL-a)', async () => {
    const error = await captureError(
      service.assertScope(USER_DRIVER, 'vehicle:view', { vehicleId: VEHICLE_2 }),
    );

    expect(error.code).toBe('SCOPE_DENIED');
    expect(error.httpStatus).toBe(403);
  });

  it('nedodijeljena permisija → checkScope allowed=false (ne ALL)', async () => {
    const check = await service.checkScope(USER_DRIVER, 'user:view', { ownerId: USER_DRIVER });

    expect(check.allowed).toBe(false);
    expect(check.scope).toBeUndefined();
  });
});

describe('PermissionsService — keš vfm:perm:{userId} (TTL 60 s)', () => {
  it('prvi poziv čita bazu i kešira, drugi ne čita bazu', async () => {
    await service.effective(USER_ADMIN);
    expect(loader.calls).toBe(1);

    await service.effective(USER_ADMIN);
    await service.effective(USER_ADMIN);
    expect(loader.calls).toBe(1);

    const cacheKey = `${REDIS_NS.permissions}:${USER_ADMIN}`;
    expect(redis.store.has(cacheKey)).toBe(true);
    expect(redis.ttls.get(cacheKey)).toBe(60); // PERMISSIONS_CACHE_TTL_SECONDS default
    expect(service.cacheTtlSeconds).toBe(60);
    expect(service.isCacheActive).toBe(true);
  });

  it('invalidateUser briše keš → sljedeći poziv ponovo čita bazu', async () => {
    await service.effective(USER_ADMIN);
    await service.invalidateUser(USER_ADMIN);

    expect(redis.store.has(`${REDIS_NS.permissions}:${USER_ADMIN}`)).toBe(false);
    await service.effective(USER_ADMIN);
    expect(loader.calls).toBe(2);
  });

  it('P3: bump verzije role bez brisanja keša → keš se sam odbacuje (≤ 5 s, bez re-logina)', async () => {
    await service.effective(USER_ADMIN);
    expect(loader.calls).toBe(1);

    // Roles modul: izmjena matrice → INCR verzije + nova prava u bazi.
    await redis.incr(`${REDIS_NS.permissionsVersion}:role:${ROLE_ADMIN_ID}`);
    loader.update(USER_ADMIN, {
      grants: ADMIN_GRANTS.filter((grant) => grant.permission !== 'vehicle:create'),
      permissionsVersion: 2,
    });

    const result = await service.effective(USER_ADMIN);

    expect(loader.calls, 'keš je morao biti odbačen').toBe(2);
    expect(result?.permissions.get('vehicle:create')).toBeUndefined();
    expect(await service.hasPermission(USER_ADMIN, 'vehicle:create')).toBe(false);
  });

  it('currentPermissionsVersion = max(global, role brojači, DB verzija)', async () => {
    expect(await service.currentPermissionsVersion([ROLE_ADMIN_ID])).toBe(0);

    await redis.incr(`${REDIS_NS.permissionsVersion}:global`);
    await redis.incr(`${REDIS_NS.permissionsVersion}:role:${ROLE_ADMIN_ID}`);
    await redis.incr(`${REDIS_NS.permissionsVersion}:role:${ROLE_ADMIN_ID}`);

    expect(await service.currentPermissionsVersion([ROLE_ADMIN_ID])).toBe(2);
    expect(await service.currentPermissionsVersion([ROLE_ADMIN_ID], 7)).toBe(7);
    // Nema role brojača → max(global=1, DB=3) = 3.
    expect(await service.currentPermissionsVersion([], 3)).toBe(3);
  });

  it('invalidateRole: bump verzije + SCAN/DEL keša (KEYS se ne koristi)', async () => {
    await service.effective(USER_ADMIN);
    await service.effective(USER_DRIVER);

    const version = await service.invalidateRole(ROLE_ADMIN_ID);

    expect(version).toBe(1);
    expect(redis.store.get(`${REDIS_NS.permissionsVersion}:role:${ROLE_ADMIN_ID}`)).toBe('1');
    expect(redis.store.has(`${REDIS_NS.permissions}:${USER_ADMIN}`)).toBe(false);
    expect(redis.store.has(`${REDIS_NS.permissions}:${USER_DRIVER}`)).toBe(false);
    expect(redis.scanCalls).toBeGreaterThan(0);
  });

  it('invalidateAll: globalni bump + brisanje svih keševa', async () => {
    await service.effective(USER_ADMIN);

    const version = await service.invalidateAll();

    expect(version).toBe(1);
    expect(redis.store.get(`${REDIS_NS.permissionsVersion}:global`)).toBe('1');
    expect(redis.store.size).toBe(1); // ostao je samo brojač verzije
  });

  it('oštećen JSON u kešu se odbacuje i čita iz baze (bez rušenja zahtjeva)', async () => {
    redis.store.set(`${REDIS_NS.permissions}:${USER_ADMIN}`, '{nije-json');

    const result = await service.effective(USER_ADMIN);

    expect(result?.isSuperAdmin).toBe(false);
    expect(loader.calls).toBe(1);
  });

  it('Redis greška (npr. NOPERM) se ne propagira — čita se iz baze', async () => {
    redis.failNext = true;

    const result = await service.effective(USER_ADMIN);

    expect(result?.permissions.get('vehicle:view')).toBe('ALL');
    expect(loader.calls).toBe(1);
  });
});

describe('PermissionsService — tokenVersion (trenutno odjavljivanje)', () => {
  it('čita Redis brojač kad postoji, inače vrijednost iz baze', async () => {
    expect(await service.tokenVersion(USER_ADMIN)).toBe(4);

    await redis.set(`${REDIS_NS.tokenVersion}:${USER_ADMIN}`, '9');
    expect(await service.tokenVersion(USER_ADMIN)).toBe(9);
  });

  it('bumpTokenVersion povećava brojač i briše keš prava', async () => {
    await service.effective(USER_ADMIN);

    const next = await service.bumpTokenVersion(USER_ADMIN);

    expect(next).toBe(1);
    expect(redis.store.get(`${REDIS_NS.tokenVersion}:${USER_ADMIN}`)).toBe('1');
    expect(redis.store.has(`${REDIS_NS.permissions}:${USER_ADMIN}`)).toBe(false);
  });

  it('nepostojeći korisnik → tokenVersion undefined', async () => {
    await expect(service.tokenVersion('nepostojeci-id')).resolves.toBeUndefined();
  });
});

describe('PermissionsService — graceful degradation i fail-closed', () => {
  it('bez Redis-a: prava se čitaju iz baze svaki put (nema keša, nema greške)', async () => {
    const noRedis = build({ available: false });

    expect(noRedis.isCacheActive).toBe(false);
    await expect(noRedis.effective(USER_ADMIN)).resolves.toBeDefined();
    await expect(noRedis.effective(USER_ADMIN)).resolves.toBeDefined();
    expect(loader.calls).toBe(2);
  });

  it('bez Redis-a: bumpTokenVersion vraća DB verziju + 1 (baza je izvor istine)', async () => {
    const noRedis = build({ available: false });

    await expect(noRedis.bumpTokenVersion(USER_ADMIN)).resolves.toBe(5);
  });

  it('bez loadera (Prisma) i bez keša → 503 DEPENDENCY_UNAVAILABLE (fail closed)', async () => {
    const noLoader = build({ withLoader: false });

    const error = await captureError(noLoader.effective(USER_ADMIN));

    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(error.httpStatus).toBe(503);
  });

  it('bez loadera ali s kešom → keš se koristi (nema lažnog 503)', async () => {
    await service.effective(USER_ADMIN); // puni keš
    const noLoader = build({ withLoader: false });

    const result = await noLoader.effective(USER_ADMIN);

    expect(result?.permissions.get('vehicle:create')).toBe('ALL');
  });

  it('prazan userId → 401 UNAUTHENTICATED (ne 500)', async () => {
    const error = await captureError(service.snapshot(''));

    expect(error.code).toBe('UNAUTHENTICATED');
  });
});

describe('PermissionsService — DI token', () => {
  it('PERMISSIONS_LOADER je Symbol (jedinstven token, bez kolizije s stringovima)', () => {
    expect(typeof PERMISSIONS_LOADER).toBe('symbol');
    expect(PERMISSIONS_LOADER.toString()).toContain('VFM_PERMISSIONS_LOADER');
  });
});
