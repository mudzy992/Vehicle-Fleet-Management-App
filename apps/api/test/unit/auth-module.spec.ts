import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { __resetEnvCache } from '../../src/config/env.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { PASSWORD_BLOCKLIST, PasswordService } from '../../src/modules/auth/services/password.service.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaPermissionsLoader } from '../../src/modules/auth/permissions/prisma-permissions.loader.js';
import { UnavailablePermissionsLoader } from '../../src/modules/auth/permissions/unavailable-permissions.loader.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  PERMISSIONS_LOADER,
  type UserPermissionsSnapshot,
} from '../../src/modules/auth/permissions/permissions.types.js';
import {
  LoggingSecurityEventSink,
  SECURITY_EVENT_SINK,
  type SecurityEventSink,
} from '../../src/common/audit/security-event.js';

/**
 * DI smoke testovi za `AuthModule` (Faza 1).
 *
 * Cilj: dokazati da se servisi za autentifikaciju mogu konstruisati kroz Nest
 * kontejner (bez ručnog `new`) — posebno da `@Optional()` blocklista ne lomi
 * instanciranje, da `TokenService` radi s ENV-om iz profila `test`, da je default
 * RBAC loader `PrismaPermissionsLoader` (izvor istine = baza) i da
 * `PermissionsService` **fail closed** (`503`) kada se eksplicitno registruje
 * zamjena bez baze (`UnavailablePermissionsLoader`).
 */

const ACCESS_SECRET = 'di-test-access-secret-0123456789abcdef0123456789';
const USER_ID = '018f0000-0000-7000-8000-0000000000a1';

const SNAPSHOT: UserPermissionsSnapshot = {
  userId: USER_ID,
  status: 'ACTIVE',
  roles: ['SUPER_ADMIN'],
  roleIds: ['018f0000-0000-7000-8000-000000000r00'],
  grants: [],
  tokenVersion: 1,
  allowedClientTypes: ['WEB'],
  permissionsVersion: 1,
  mustChangePassword: false,
};

/** Fake Redis (bez mreže) — `PermissionsService` ga koristi samo preko `getConnection`. */
/**
 * Fake Prisma servis: `PrismaPermissionsLoader` zove samo `user.findFirst`, pa je
 * ovo dovoljno za DI testove (stvarni upit se ne izvršava — nema baze u sandboxu).
 */
const fakePrisma = {
  user: { findFirst: async () => undefined },
} as unknown as PrismaService;

const fakeRedis = {
  isEnabled: false,
  isAvailable: () => false,
  getConnection: () => undefined,
  key: (namespace: string, ...parts: string[]) => `${namespace}:${parts.join(':')}`,
} as unknown as RedisService;

/**
 * `AuthModule` + `RedisModule` (globalni) s fake Redis servisom: dokazuje da su
 * sve zavisnosti injektibilne bez stvarne infrastrukture.
 */
function buildModule() {
  return (
    Test.createTestingModule({ imports: [AuthModule, RedisModule, PrismaModule] })
      .overrideProvider(RedisService)
      .useValue(fakeRedis)
      // `PrismaModule` je globalan; ovdje ga override-amo da se ne gradi pg.Pool.
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
  );
}

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  __resetEnvCache();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = savedSecret;
  __resetEnvCache();
});

describe('AuthModule — dependency injection', () => {
  it('rezolvuje PasswordService, TokenService i PermissionsService', async () => {
    const moduleRef = await buildModule().compile();

    expect(moduleRef.get(PasswordService)).toBeInstanceOf(PasswordService);
    expect(moduleRef.get(TokenService)).toBeInstanceOf(TokenService);
    expect(moduleRef.get(PermissionsService)).toBeInstanceOf(PermissionsService);

    await moduleRef.close();
  });

  it('krajnji tok kroz DI: hash → verify → sign → verify access tokena', async () => {
    const moduleRef = await buildModule().compile();
    const passwordService = moduleRef.get(PasswordService);
    const tokenService = moduleRef.get(TokenService);

    const password = passwordService.randomPassword();
    const hashed = await passwordService.hash(password);
    await expect(passwordService.verify(hashed, password)).resolves.toBe(true);

    const signed = tokenService.signAccessToken({
      userId: USER_ID,
      roles: ['Administrator'],
      tokenVersion: 1,
      permissionsVersion: 1,
      clientType: 'WEB',
      sessionId: '018f0000-0000-7000-8000-0000000000b2',
    });

    expect(tokenService.verifyAccessToken(signed.accessToken)).toMatchObject({
      sub: USER_ID,
      roles: ['Administrator'],
      ct: 'WEB',
    });

    await moduleRef.close();
  });

  it('provider PASSWORD_BLOCKLIST se poštuje (override bez izmjene koda servisa)', async () => {
    const moduleRef = await buildModule()
      .overrideProvider(PASSWORD_BLOCKLIST)
      .useValue(['mojaTajna'])
      .compile();

    const passwordService = moduleRef.get(PasswordService);

    expect(passwordService.validatePolicy('MojaTajna!2026').map((issue) => issue.code)).toContain(
      'common_password',
    );
    // Ugrađena lista i dalje važi.
    expect(passwordService.validatePolicy('Password123456!').map((issue) => issue.code)).toContain(
      'common_password',
    );

    await moduleRef.close();
  });

  it('default provider (prazna lista) ne mijenja ugrađenu blocklistu', async () => {
    const moduleRef = await buildModule().compile();
    const passwordService = moduleRef.get(PasswordService);

    expect(passwordService.validatePolicy('Kamion!Zima2026x')).toEqual([]);

    await moduleRef.close();
  });

  it('default RBAC loader je PrismaPermissionsLoader (izvor istine = baza)', async () => {
    const moduleRef = await buildModule().compile();
    const loader = moduleRef.get<PrismaPermissionsLoader>(PERMISSIONS_LOADER);

    expect(loader).toBeInstanceOf(PrismaPermissionsLoader);
    // Fake Prisma ne nalazi korisnika → `undefined`, nikad izuzetak (guard vraća 401).
    await expect(loader.loadSnapshot(USER_ID)).resolves.toBeUndefined();

    await moduleRef.close();
  });

  it('PermissionsService s loaderom bez baze → 503 DEPENDENCY_UNAVAILABLE (fail closed)', async () => {
    const moduleRef = await buildModule()
      .overrideProvider(PERMISSIONS_LOADER)
      .useClass(UnavailablePermissionsLoader)
      .compile();
    const permissions = moduleRef.get(PermissionsService);

    await expect(permissions.effective(USER_ID)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      httpStatus: 503,
    });

    await moduleRef.close();
  });

  it('PermissionsService s loaderom računa prava (putanja koja važi nakon blokera 1)', async () => {
    const moduleRef = await buildModule()
      .overrideProvider(PERMISSIONS_LOADER)
      .useValue({ loadSnapshot: async () => SNAPSHOT })
      .compile();
    const permissions = moduleRef.get(PermissionsService);

    const web = await permissions.effective(USER_ID, 'WEB');
    expect(web?.isSuperAdmin).toBe(true);
    expect(web?.list.length).toBeGreaterThan(100);

    // N-05: Super Admin na mobilnom klijentu nema nijedno pravo.
    const mobile = await permissions.effective(USER_ID, 'MOBILE_ANDROID');
    expect(mobile?.list).toEqual([]);

    await moduleRef.close();
  });

  it('SECURITY_EVENT_SINK je registrovan (default logira, ne baca)', async () => {
    const moduleRef = await buildModule().compile();

    const sink = moduleRef.get<SecurityEventSink>(SECURITY_EVENT_SINK);

    expect(sink).toBeInstanceOf(LoggingSecurityEventSink);
    expect(() =>
      sink.record({
        type: 'MOBILE_ACCESS_FORBIDDEN',
        userId: USER_ID,
        clientType: 'MOBILE_ANDROID',
        reason: 'test',
      }),
    ).not.toThrow();

    await moduleRef.close();
  });
});
