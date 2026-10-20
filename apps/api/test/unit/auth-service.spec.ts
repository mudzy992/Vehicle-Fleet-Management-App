/**
 * `AuthService` — prijava, rotacija sesija, odjava, profil, promjena lozinke.
 *
 * Pokriva prihvatne kriterije:
 * - **P1**: Super Admin na mobilnom klijentu → `403 MOBILE_ACCESS_FORBIDDEN`
 *   + SECURITY_EVENT (provjera je pri prijavi; guard je pokriven u
 *   `auth-guards.spec.ts`),
 * - **P1/P3**: logout i promjena lozinke dižu `tokenVersion` (DB + Redis), pa
 *   postojeći access token odmah postaje nevažeći,
 * - reuse detection: iskorišteni refresh token → revokacija **svih** sesija.
 *
 * Fake-ovi: `FakePrismaClient` (redovi u memoriji), `FakeRedis` + `FakeLoader`
 * (stvarni `PermissionsService`), `RecordingSecuritySink` (događaji).
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __resetEnvCache } from '../../src/config/env.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PasswordService } from '../../src/modules/auth/services/password.service.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';
import {
  ADMIN_SNAPSHOT,
  DRIVER_SNAPSHOT,
  FakeLoader,
  FakeRedis,
  ROLE_ADMIN_ID,
  ROLE_DRIVER_ID,
  ROLE_SUPER_ID,
  RecordingSecuritySink,
  SUPER_ADMIN_SNAPSHOT,
  USER_ADMIN,
  USER_DRIVER,
  USER_SUPER,
  fakeRedisService,
} from '../helpers/rbac-fakes.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';

const ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789abcdef';
const REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef0123456789abcdef';
const PASSWORD = 'Sifra!Vfm2026';

const ENV_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'JWT_ACCESS_TTL',
  'JWT_REFRESH_TTL',
  'COOKIE_NAME',
  'COOKIE_DOMAIN',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'COOKIE_PATH',
  'AUTH_MAX_FAILED_ATTEMPTS',
  'AUTH_LOCKOUT_MINUTES',
  'AUTH_MAX_SESSIONS_PER_USER',
] as const;

const SUPER_EMAIL = 'super.admin@vfm.test';
const ADMIN_EMAIL = 'ana.anic@vfm.test';
const DRIVER_EMAIL = 'vozac@vfm.test';

const CONTEXT = {
  ipAddress: '203.0.113.7',
  userAgent: 'vitest-auth-service',
  requestId: '018f0000-0000-7000-8000-00000000req1',
  path: '/api/v1/auth/login',
  method: 'POST',
} as const;

let prisma: FakePrismaClient;
let redis: FakeRedis;
let loader: FakeLoader;
let permissions: PermissionsService;
let tokens: TokenService;
let passwords: PasswordService;
let sink: RecordingSecuritySink;
let service: AuthService;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let passwordHash = '';

beforeAll(async () => {
  // argon2id je spor (~90 ms) — hash se računa jednom i dijeli između testova.
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  __resetEnvCache();
  passwordHash = await new PasswordService().hash(PASSWORD);
});

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  process.env.JWT_ISSUER = 'vfm-api';
  process.env.JWT_AUDIENCE = 'vfm-clients';
  process.env.JWT_ACCESS_TTL = '10m';
  process.env.JWT_REFRESH_TTL = '30d';
  process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
  process.env.AUTH_LOCKOUT_MINUTES = '15';
  process.env.AUTH_MAX_SESSIONS_PER_USER = '5';
  __resetEnvCache();

  prisma = new FakePrismaClient();
  redis = new FakeRedis();
  loader = new FakeLoader([SUPER_ADMIN_SNAPSHOT, ADMIN_SNAPSHOT, DRIVER_SNAPSHOT]);
  permissions = new PermissionsService(fakeRedisService(redis, true), loader);
  tokens = new TokenService();
  passwords = new PasswordService();
  sink = new RecordingSecuritySink();

  const superRole = prisma.addRole({ id: ROLE_SUPER_ID, code: 'SUPER_ADMIN', name: 'Super Admin', priority: 10 });
  const adminRole = prisma.addRole({ id: ROLE_ADMIN_ID, code: 'ADMINISTRATOR', name: 'Administrator', priority: 20 });
  const driverRole = prisma.addRole({ id: ROLE_DRIVER_ID, code: 'OBICNI_KORISNIK', name: 'Obični korisnik', priority: 30 });

  prisma.addUser({ id: USER_SUPER, email: SUPER_EMAIL, passwordHash, firstName: 'Super', lastName: 'Admin' });
  prisma.assignRole(USER_SUPER, superRole);

  // `User.tokenVersion` u bazi mora odgovarati snapshot-u: u produkciji oba
  // dolaze iz istog reda (`PrismaPermissionsLoader`), pa JWT claim `tv` i DB
  // verzija nikad nisu razdvojeni. Bez toga testovi revokacije lažno prolaze/padaju.
  prisma.addUser({
    id: USER_ADMIN,
    email: ADMIN_EMAIL,
    passwordHash,
    firstName: 'Ana',
    lastName: 'Anić',
    tokenVersion: ADMIN_SNAPSHOT.tokenVersion,
  });
  prisma.assignRole(USER_ADMIN, adminRole);

  prisma.addUser({
    id: USER_DRIVER,
    email: DRIVER_EMAIL,
    passwordHash,
    firstName: 'Vozač',
    lastName: 'Test',
    mustChangePassword: true,
  });
  prisma.assignRole(USER_DRIVER, driverRole);

  service = new AuthService(asPrismaService(prisma), passwords, tokens, permissions, sink);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCache();
});

async function captureError(promise: Promise<unknown>): Promise<VfmException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}

function loginInput(overrides: Partial<{ email: string; password: string; clientType: string }> = {}) {
  return {
    email: overrides.email ?? ADMIN_EMAIL,
    password: overrides.password ?? PASSWORD,
    clientType: (overrides.clientType ?? 'WEB') as 'WEB' | 'MOBILE_ANDROID' | 'MOBILE_IOS',
  };
}

describe('AuthService.login — sretan put', () => {
  it('izdaje access token (600 s), refresh (30 dana) i httpOnly cookie opcije', async () => {
    const result = await service.login(loginInput(), CONTEXT);

    expect(result.response.tokenType).toBe('Bearer');
    expect(result.response.expiresIn).toBe(600);
    expect(result.response.refreshExpiresIn).toBe(2_592_000);
    expect(result.refreshCookieOptions.httpOnly).toBe(true);
    expect(result.refreshCookieOptions.maxAge).toBe(2_592_000_000);
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
  });

  it('access token nosi claimove sid/ct/tv/pv/roles iz baze', async () => {
    const result = await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);
    const claims = tokens.decodeClaims(result.response.accessToken);

    expect(claims.sub).toBe(USER_ADMIN);
    expect(claims.sid).toBe(result.response.sessionId);
    expect(claims.ct).toBe('MOBILE_ANDROID');
    expect(claims.tv).toBe(ADMIN_SNAPSHOT.tokenVersion);
    expect(claims.pv).toBe(ADMIN_SNAPSHOT.permissionsVersion);
    expect(claims.roles).toEqual(['ADMINISTRATOR']);
  });

  it('payload korisnika sadrži efektivna prava i dozvoljene tipove klijenta', async () => {
    const result = await service.login(loginInput(), CONTEXT);

    expect(result.response.user.id).toBe(USER_ADMIN);
    expect(result.response.user.email).toBe(ADMIN_EMAIL);
    expect(result.response.user.roles).toEqual([{ id: ROLE_ADMIN_ID, code: 'ADMINISTRATOR', name: 'Administrator' }]);
    expect(result.response.user.permissions).toContain('vehicle:create');
    expect(result.response.user.allowedClientTypes).toEqual(['WEB', 'MOBILE_ANDROID']);
    expect(result.response.user.isSuperAdmin).toBe(false);
    expect(result.response.user.mustChangePassword).toBe(false);
    expect(result.response.user.lastLoginAt).not.toBeNull();
  });

  it('Super Admin dobija isSuperAdmin=true i sva prava (R-07)', async () => {
    const result = await service.login(loginInput({ email: SUPER_EMAIL }), CONTEXT);

    expect(result.response.user.isSuperAdmin).toBe(true);
    expect(result.response.user.permissions.length).toBeGreaterThan(50);
    expect(result.response.user.allowedClientTypes).toEqual(['WEB']);
  });

  it('mobilni klijent dobija refreshToken u tijelu, web nikad (httpOnly cookie)', async () => {
    const web = await service.login(loginInput(), CONTEXT);
    expect(web.response.refreshToken).toBeUndefined();
    expect(web.clientType).toBe('WEB');

    const mobile = await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);
    expect(mobile.response.refreshToken).toBe(mobile.refreshToken);
    expect(mobile.clientType).toBe('MOBILE_ANDROID');
  });

  it('čuva HASH refresh tokena (nikad sirovi token) i briše brojač neuspjeha', async () => {
    const prismaUser = prisma.users.get(USER_ADMIN);
    if (prismaUser) prismaUser.failedLoginCount = 2;

    const result = await service.login(loginInput(), CONTEXT);
    const session = prisma.sessions.get(result.response.sessionId);
    const expectedHash = tokens.hashToken(result.refreshToken);

    expect(session?.tokenHash).toBe(expectedHash);
    expect(JSON.stringify(session)).not.toContain(result.refreshToken);
    expect(prisma.users.get(USER_ADMIN)?.failedLoginCount).toBe(0);
    expect(prisma.users.get(USER_ADMIN)?.lockedUntil).toBeNull();
    expect(prisma.users.get(USER_ADMIN)?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('piše AuthAttempt (uspjeh) s IP-om i user agentom', async () => {
    await service.login(loginInput(), CONTEXT);

    expect(prisma.authAttempts).toHaveLength(1);
    expect(prisma.authAttempts[0]).toMatchObject({
      email: ADMIN_EMAIL,
      userId: USER_ADMIN,
      success: true,
      clientType: 'WEB',
      ipAddress: '203.0.113.7',
      userAgent: 'vitest-auth-service',
      failureReason: null,
    });
  });

  it('normalizuje deviceInfo na whitelist polja (JSONB bez smeća)', async () => {
    const result = await service.login(
      {
        ...loginInput({ clientType: 'MOBILE_ANDROID' }),
        deviceInfo: { model: 'Pixel 9', osVersion: '16', nepoznatoPolje: 'x' } as unknown as { model?: string },
      },
      CONTEXT,
    );

    expect(prisma.sessions.get(result.response.sessionId)?.deviceInfo).toEqual({
      model: 'Pixel 9',
      osVersion: '16',
    });
  });

  it('greška pri upisu AuthAttempt ne ruši prijavu', async () => {
    prisma.failures.authAttempt = new Error('auth_attempt insert failed');

    const result = await service.login(loginInput(), CONTEXT);

    expect(result.response.accessToken).toBeTruthy();
    expect(prisma.calls.authAttemptCreate).toBe(1);
  });
});

describe('AuthService.login — odbijanja', () => {
  it('nepoznat e-mail → 401 INVALID_CREDENTIALS + LOGIN_FAILED (bez otkrivanja naloga)', async () => {
    const error = await captureError(service.login(loginInput({ email: 'nepostojeci@vfm.test' }), CONTEXT));

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.httpStatus).toBe(401);
    expect(sink.types).toEqual(['LOGIN_FAILED']);
    expect(sink.events[0]).toMatchObject({ email: 'nepostojeci@vfm.test', reason: 'UNKNOWN_USER' });
    expect(prisma.authAttempts[0]).toMatchObject({ userId: null, success: false, failureReason: 'UNKNOWN_USER' });
    expect(prisma.sessions.size).toBe(0);
  });

  it('pogrešna lozinka → 401 INVALID_CREDENTIALS i brojač neuspjeha raste', async () => {
    const error = await captureError(service.login(loginInput({ password: 'Pogresna!Sifra2026' }), CONTEXT));

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(prisma.users.get(USER_ADMIN)?.failedLoginCount).toBe(1);
    expect(sink.types).toEqual(['LOGIN_FAILED']);
  });

  it('nakon AUTH_MAX_FAILED_ATTEMPTS (3) → ACCOUNT_LOCKED s retryAfter i lockedUntil', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await captureError(service.login(loginInput({ password: 'Pogresna!Sifra2026' }), CONTEXT));
    }

    const user = prisma.users.get(USER_ADMIN);
    expect(user?.failedLoginCount).toBe(3);
    expect(user?.lockedUntil).toBeInstanceOf(Date);
    expect(sink.types).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED']);

    // Tačna lozinka dok traje zaključavanje → i dalje 423 (lockout ima prednost).
    const locked = await captureError(service.login(loginInput(), CONTEXT));
    expect(locked.code).toBe('ACCOUNT_LOCKED');
    expect(locked.httpStatus).toBe(423);
    expect(locked.extra?.retryAfterSeconds).toBeGreaterThan(0);
    expect(prisma.authAttempts.at(-1)?.failureReason).toBe('ACCOUNT_LOCKED');
  });

  it('neaktivan nalog → 403 ACCOUNT_INACTIVE', async () => {
    const user = prisma.users.get(USER_ADMIN);
    if (user) user.status = 'SUSPENDED';

    const error = await captureError(service.login(loginInput(), CONTEXT));

    expect(error.code).toBe('ACCOUNT_INACTIVE');
    expect(error.httpStatus).toBe(403);
    expect(sink.events[0]).toMatchObject({ type: 'LOGIN_FAILED', reason: 'STATUS_SUSPENDED' });
  });

  it('PENDING_PASSWORD_CHANGE se MOŽE prijaviti (privremena lozinka) uz mustChangePassword=true', async () => {
    // Regresija: ranije je svaki nalog s privremenom lozinkom (bootstrap, seed,
    // korisnik kojeg kreira administrator) dobijao 403 ACCOUNT_INACTIVE i nije
    // se mogao prijaviti — pa nije mogao ni promijeniti lozinku.
    const user = prisma.users.get(USER_ADMIN);
    if (user) {
      user.status = 'PENDING_PASSWORD_CHANGE';
      user.mustChangePassword = true;
    }

    const result = await service.login(loginInput(), CONTEXT);

    expect(result.response.user.mustChangePassword).toBe(true);
    expect(result.response.user.status).toBe('PENDING_PASSWORD_CHANGE');
    expect(result.response.accessToken).toBeTruthy();
  });

  it('soft-obrisan nalog se ne može prijaviti', async () => {
    const user = prisma.users.get(USER_ADMIN);
    if (user) user.deletedAt = new Date();

    const error = await captureError(service.login(loginInput(), CONTEXT));

    expect(error.code).toBe('INVALID_CREDENTIALS');
  });

  it('P1: Super Admin na MOBILE_ANDROID → 403 MOBILE_ACCESS_FORBIDDEN + SECURITY_EVENT', async () => {
    const error = await captureError(
      service.login(loginInput({ email: SUPER_EMAIL, clientType: 'MOBILE_ANDROID' }), CONTEXT),
    );

    expect(error.code).toBe('MOBILE_ACCESS_FORBIDDEN');
    expect(error.httpStatus).toBe(403);
    expect(sink.types).toEqual(['MOBILE_ACCESS_FORBIDDEN']);
    expect(sink.events[0]).toMatchObject({
      userId: USER_SUPER,
      email: SUPER_EMAIL,
      clientType: 'MOBILE_ANDROID',
      roles: ['SUPER_ADMIN'],
      reason: 'SUPER_ADMIN_WEB_ONLY',
      requestId: CONTEXT.requestId,
      ip: CONTEXT.ipAddress,
    });
    expect(prisma.sessions.size).toBe(0);
    expect(prisma.authAttempts.at(-1)).toMatchObject({ success: false, failureReason: 'CLIENT_TYPE_NOT_ALLOWED' });
  });

  it('uloga bez prava na dati tip klijenta → 403 MOBILE_SCOPE_NOT_ALLOWED', async () => {
    const error = await captureError(
      service.login(loginInput({ email: ADMIN_EMAIL, clientType: 'MOBILE_IOS' }), CONTEXT),
    );

    expect(error.code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
    expect(error.httpStatus).toBe(403);
    expect(sink.types).toEqual(['MOBILE_SCOPE_NOT_ALLOWED']);
    expect(sink.events[0]?.reason).toBe('DOZVOLJENI_TIPOVI:WEB,MOBILE_ANDROID');
  });

  it('korisnik bez važećih uloga (prazan allowedClientTypes) → odbijen fail-closed', async () => {
    loader.update(USER_DRIVER, { roles: [], roleIds: [], allowedClientTypes: [], grants: [] });

    const error = await captureError(service.login(loginInput({ email: DRIVER_EMAIL }), CONTEXT));

    expect(error.code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
    expect(sink.events[0]?.reason).toBe('DOZVOLJENI_TIPOVI:nijedan');
  });
});

describe('AuthService.refresh — rotacija i reuse detection', () => {
  it('rotira token: stara sesija je revoked + replacedById, nova u istoj porodici', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    const oldSessionId = login.response.sessionId;

    const rotated = await service.refresh({}, CONTEXT, login.refreshToken);

    const oldSession = prisma.sessions.get(oldSessionId);
    const newSession = prisma.sessions.get(rotated.response.sessionId);
    expect(oldSession?.revokedAt).toBeInstanceOf(Date);
    expect(oldSession?.replacedById).toBe(rotated.response.sessionId);
    expect(oldSession?.lastUsedAt).toBeInstanceOf(Date);
    expect(newSession?.familyId).toBe(oldSession?.familyId);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(tokens.decodeClaims(rotated.response.accessToken).sid).toBe(rotated.response.sessionId);
  });

  it('prihvata refresh token iz tijela (mobilni klijenti)', async () => {
    const login = await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);

    const rotated = await service.refresh(
      { refreshToken: login.refreshToken, clientType: 'MOBILE_ANDROID' },
      CONTEXT,
      undefined,
    );

    expect(rotated.response.user.allowedClientTypes).toContain('MOBILE_ANDROID');
    expect(prisma.sessions.get(rotated.response.sessionId)?.clientType).toBe('MOBILE_ANDROID');
  });

  it('reuse detection: iskorišteni token → REFRESH_TOKEN_REUSE_DETECTED, sve sesije revoked, tokenVersion++', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    await service.refresh({}, CONTEXT, login.refreshToken);

    const before = prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0;
    const error = await captureError(service.refresh({}, CONTEXT, login.refreshToken));
    const redisVersion = await permissions.tokenVersion(USER_ADMIN);

    expect(error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
    expect(error.httpStatus).toBe(401);
    expect(sink.types).toContain('REFRESH_REUSE_DETECTED');
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0).toBe(before + 1);
    // Guard poredi claim `tv` s Redis brojačem — mora biti strogo veći.
    expect(redisVersion).toBeGreaterThan(before);
    expect(redisVersion).toBe(before + 1);
  });

  it('nepoznat token → 401 TOKEN_REVOKED + SECURITY_EVENT', async () => {
    const error = await captureError(service.refresh({}, CONTEXT, 'nepoznat-token'));

    expect(error.code).toBe('TOKEN_REVOKED');
    expect(sink.types).toEqual(['TOKEN_REVOKED']);
    expect(sink.events[0]?.reason).toBe('UNKNOWN_REFRESH_TOKEN');
  });

  it('bez tokena (ni cookie ni tijelo) → 401 UNAUTHENTICATED', async () => {
    const error = await captureError(service.refresh({}, CONTEXT, undefined));

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(prisma.calls.sessionFindUnique).toBe(0);
  });

  it('istekao refresh token → 401 TOKEN_EXPIRED i sesija se revokuje', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    const session = prisma.sessions.get(login.response.sessionId);
    if (session) session.expiresAt = new Date(Date.now() - 1000);

    const error = await captureError(service.refresh({}, CONTEXT, login.refreshToken));

    expect(error.code).toBe('TOKEN_EXPIRED');
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });

  it('odbija refresh za neaktivan nalog i za obrisanog korisnika', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    const user = prisma.users.get(USER_ADMIN);
    if (user) user.status = 'DEACTIVATED';

    const inactive = await captureError(service.refresh({}, CONTEXT, login.refreshToken));
    expect(inactive.code).toBe('ACCOUNT_INACTIVE');

    if (user) {
      user.status = 'ACTIVE';
      user.deletedAt = new Date();
    }
    const deleted = await captureError(service.refresh({}, CONTEXT, login.refreshToken));
    expect(deleted.code).toBe('UNAUTHENTICATED');
  });

  it('docs/05 §6.2: web sesija ne može izdati mobilni token (Super Admin P1)', async () => {
    const login = await service.login(loginInput({ email: SUPER_EMAIL }), CONTEXT);

    const error = await captureError(service.refresh({ clientType: 'MOBILE_IOS' }, CONTEXT, login.refreshToken));

    expect(error.code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
    expect(sink.types).toContain('MOBILE_SCOPE_NOT_ALLOWED');
    expect(sink.events.at(-1)?.reason).toBe('SESIJA_IZDATA_ZA:WEB');
    // Stara sesija ostaje važeća — pokušaj prevare ne smije ugasiti legitiman lanac.
    expect(prisma.sessions.get(login.response.sessionId)?.revokedAt).toBeNull();
  });

  it('mobilna sesija se može rotirati samo kao mobilna', async () => {
    const login = await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);

    const ok = await service.refresh({ clientType: 'MOBILE_ANDROID' }, CONTEXT, login.refreshToken);
    expect(ok.clientType).toBe('MOBILE_ANDROID');

    const error = await captureError(service.refresh({ clientType: 'WEB' }, CONTEXT, ok.refreshToken));
    expect(error.code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
  });
});

describe('AuthService.logout — odjava jedne sesije (docs/07 §7)', () => {
  it('revokuje samo priloženu sesiju; drugi uređaj ostaje prijavljen i tokenVersion raste NE', async () => {
    const mobile = await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);
    const web = await service.login(loginInput(), CONTEXT);
    const before = prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0;

    const result = await service.logout(USER_ADMIN, { refreshToken: web.refreshToken }, CONTEXT, web.response.sessionId);

    expect(result.revokedSessions).toBe(1);
    expect(prisma.sessions.get(web.response.sessionId)?.revokedAt).toBeInstanceOf(Date);
    expect(prisma.sessions.get(mobile.response.sessionId)?.revokedAt).toBeNull();
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0).toBe(before);
  });

  it('bez refresh tokena koristi `sid` iz access tokena', async () => {
    const login = await service.login(loginInput(), CONTEXT);

    const result = await service.logout(USER_ADMIN, {}, CONTEXT, login.response.sessionId);

    expect(result.revokedSessions).toBe(1);
    expect(prisma.sessions.get(login.response.sessionId)?.revokedAt).toBeInstanceOf(Date);
  });

  it('tuđi refresh token se ne može ugasiti kao svoj (where uključuje userId)', async () => {
    const login = await service.login(loginInput(), CONTEXT);

    const result = await service.logout(USER_DRIVER, { refreshToken: login.refreshToken }, CONTEXT);

    expect(result.revokedSessions).toBe(0);
    expect(prisma.sessions.get(login.response.sessionId)?.revokedAt).toBeNull();
  });
});

describe('AuthService.logoutAll — odjava sa svih uređaja', () => {
  it('revokuje sve sesije i diže tokenVersion (DB + Redis) — stari access token pada', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    const claims = tokens.decodeClaims(login.response.accessToken);
    const before = prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0;

    const result = await service.logoutAll(USER_ADMIN, CONTEXT);

    expect(result.revokedSessions).toBe(1);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion ?? 0).toBe(before + 1);
    // Ključ P1/P3: Redis brojač je iznad `tv` izdatog tokena → guard ga odbija.
    expect(await permissions.tokenVersion(USER_ADMIN)).toBeGreaterThan(claims.tv);
  });

  it('web i mobilna sesija padaju istovremeno', async () => {
    await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);
    await service.login(loginInput(), CONTEXT);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(2);

    const result = await service.logoutAll(USER_ADMIN, CONTEXT);

    expect(result.revokedSessions).toBe(2);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
  });
});

describe('AuthService.me', () => {
  it('vraća profil i efektivna prava iz baze (ne iz claimova)', async () => {
    const me = await service.me(USER_DRIVER, 'WEB');

    expect(me.id).toBe(USER_DRIVER);
    expect(me.roles).toEqual([{ id: ROLE_DRIVER_ID, code: 'OBICNI_KORISNIK', name: 'Obični korisnik' }]);
    expect(me.permissions).toEqual(expect.arrayContaining(['vehicle:view', 'task:execute', 'fuel:create']));
    expect(me.mustChangePassword).toBe(true);
    expect(me.lastLoginAt).toBeNull();
  });

  it('nakon revokacije prava `me` odmah vraža smanjenu listu (P3)', async () => {
    await service.me(USER_ADMIN, 'WEB');
    loader.update(USER_ADMIN, {
      grants: ADMIN_SNAPSHOT.grants.filter((grant) => grant.permission !== 'vehicle:create'),
      permissionsVersion: ADMIN_SNAPSHOT.permissionsVersion + 1,
    });
    // U produkciji keš briše Roles modul (`invalidateRole`/`invalidateUser`).
    await permissions.invalidateUser(USER_ADMIN);

    const me = await service.me(USER_ADMIN, 'WEB');

    expect(me.permissions).not.toContain('vehicle:create');
    expect(me.permissionsVersion).toBe(ADMIN_SNAPSHOT.permissionsVersion + 1);
  });

  it('PENDING_PASSWORD_CHANGE: me radi (web mora učitati profil prije promjene lozinke)', async () => {
    const user = prisma.users.get(USER_ADMIN);
    if (user) {
      user.status = 'PENDING_PASSWORD_CHANGE';
      user.mustChangePassword = true;
    }
    // Snapshot u produkciji dolazi iz baze; ovdje je fiksan, pa ga uskladimo.
    loader.update(USER_ADMIN, { status: 'PENDING_PASSWORD_CHANGE', mustChangePassword: true });
    await permissions.invalidateUser(USER_ADMIN);

    const me = await service.me(USER_ADMIN, 'WEB');

    expect(me.status).toBe('PENDING_PASSWORD_CHANGE');
    expect(me.mustChangePassword).toBe(true);
    // Efektivna prava su prazna — pristup podacima je zatvoren do promjene lozinke.
    expect(me.permissions).toEqual([]);
  });

  it('obrisan korisnik → 401, neaktivan → 403', async () => {
    const missing = await captureError(service.me('018f0000-0000-7000-8000-0000000000ff', 'WEB'));
    expect(missing.code).toBe('UNAUTHENTICATED');

    const user = prisma.users.get(USER_ADMIN);
    if (user) user.status = 'SUSPENDED';
    const inactive = await captureError(service.me(USER_ADMIN, 'WEB'));
    expect(inactive.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('AuthService.changePassword', () => {
  it('pogrešna trenutna lozinka → 401 INVALID_CREDENTIALS + LOGIN_FAILED', async () => {
    const error = await captureError(
      service.changePassword(USER_ADMIN, { currentPassword: 'Pogresna!Sifra2026', newPassword: 'Nova!Sifra2026x' }, CONTEXT),
    );

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(sink.types).toEqual(['LOGIN_FAILED']);
    expect(sink.events[0]?.reason).toBe('CHANGE_PASSWORD_WRONG_CURRENT');
    expect(prisma.users.get(USER_ADMIN)?.passwordHash).toBe(passwordHash);
  });

  it('nova lozinka koja krši politiku → VALIDATION_ERROR, hash ostaje isti', async () => {
    const error = await captureError(
      service.changePassword(USER_ADMIN, { currentPassword: PASSWORD, newPassword: '123456' }, CONTEXT),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.length).toBeGreaterThan(0);
    expect(prisma.users.get(USER_ADMIN)?.passwordHash).toBe(passwordHash);
  });

  it('uspješna promjena: novi hash, mustChangePassword=false, tokenVersion++, sve sesije revoked', async () => {
    const login = await service.login(loginInput({ email: DRIVER_EMAIL }), CONTEXT);
    const before = prisma.users.get(USER_DRIVER)?.tokenVersion ?? 0;

    await service.changePassword(USER_DRIVER, { currentPassword: PASSWORD, newPassword: 'Nova!Sifra2026x' }, CONTEXT);

    const user = prisma.users.get(USER_DRIVER);
    expect(user?.passwordHash).not.toBe(passwordHash);
    expect(await passwords.verify(user?.passwordHash ?? '', 'Nova!Sifra2026x')).toBe(true);
    expect(user?.mustChangePassword).toBe(false);
    expect(user?.tokenVersion ?? 0).toBe(before + 1);
    expect(await permissions.tokenVersion(USER_DRIVER)).toBeGreaterThan(before);
    expect(prisma.activeSessions(USER_DRIVER)).toHaveLength(0);
    expect(tokens.decodeClaims(login.response.accessToken).tv).toBeLessThan(user?.tokenVersion ?? 0);
  });

  it('PENDING_PASSWORD_CHANGE: promjena lozinke prelazi nalog u ACTIVE (regresija)', async () => {
    const user = prisma.users.get(USER_ADMIN);
    if (user) {
      user.status = 'PENDING_PASSWORD_CHANGE';
      user.mustChangePassword = true;
    }

    await service.changePassword(
      USER_ADMIN,
      { currentPassword: PASSWORD, newPassword: 'Nova!Sifra2026x' },
      CONTEXT,
    );

    expect(prisma.users.get(USER_ADMIN)).toMatchObject({
      status: 'ACTIVE',
      mustChangePassword: false,
    });
  });
});

describe('AuthService — sesije', () => {
  it('AUTH_MAX_SESSIONS_PER_USER: najstariji višak se revokuje', async () => {
    process.env.AUTH_MAX_SESSIONS_PER_USER = '2';
    __resetEnvCache();

    const first = await service.login(loginInput(), CONTEXT);
    const second = await service.login(loginInput(), CONTEXT);
    const third = await service.login(loginInput(), CONTEXT);

    expect(prisma.sessions.get(first.response.sessionId)?.revokedAt).toBeInstanceOf(Date);
    expect(prisma.sessions.get(second.response.sessionId)?.revokedAt).toBeNull();
    expect(prisma.sessions.get(third.response.sessionId)?.revokedAt).toBeNull();
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(2);
  });

  it('listActiveSessions vraća ISO datume i podatke o uređaju', async () => {
    await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);

    const sessions = await service.listActiveSessions(USER_ADMIN);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ clientType: 'MOBILE_ANDROID', ipAddress: '203.0.113.7' });
    expect(sessions[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(sessions[0]?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(sessions[0]?.lastUsedAt).toBeNull();
  });

  it('revokeSession gasi jedan uređaj i diže tokenVersion', async () => {
    const login = await service.login(loginInput(), CONTEXT);
    const before = await permissions.tokenVersion(USER_ADMIN);

    await service.revokeSession(USER_ADMIN, login.response.sessionId);

    expect(prisma.sessions.get(login.response.sessionId)?.revokedAt).toBeInstanceOf(Date);
    expect(await permissions.tokenVersion(USER_ADMIN)).toBeGreaterThan(before ?? 0);
  });

  it('tuđa sesija → 404 NOT_FOUND (bez otkrivanja postojanja)', async () => {
    const login = await service.login(loginInput(), CONTEXT);

    const error = await captureError(service.revokeSession(USER_DRIVER, login.response.sessionId));

    expect(error.code).toBe('NOT_FOUND');
    expect(prisma.sessions.get(login.response.sessionId)?.revokedAt).toBeNull();
  });

  it('revokeAllSessions vraća broj revokovanih sesija (admin force logout)', async () => {
    await service.login(loginInput(), CONTEXT);
    await service.login(loginInput({ clientType: 'MOBILE_ANDROID' }), CONTEXT);

    const count = await service.revokeAllSessions(USER_ADMIN, 'ADMIN_FORCE_LOGOUT');

    expect(count).toBe(2);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
  });
});

describe('AuthService — reset lozinke tokenom', () => {
  const NEW_PASSWORD = 'Nova!Sifra2026x';

  function issueToken(userId: string, overrides: { expiresAt?: Date; usedAt?: Date | null } = {}) {
    const generated = tokens.generatePasswordResetToken();
    // Isti oblik kao u servisu (`{ data: ... }`) — fake čita `args.data`.
    prisma.passwordResetToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: generated.tokenHash,
        expiresAt: overrides.expiresAt ?? generated.expiresAt,
        createdById: USER_SUPER,
      },
    });

    const row = prisma.passwordResetTokens.at(-1);
    if (row && overrides.usedAt) row.usedAt = overrides.usedAt;

    return generated.token;
  }

  it('uspješan reset: nova lozinka, tokenVersion++, sve sesije revokovane, token iskorišten', async () => {
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'session-1' });
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'session-2' });
    redis.store.set(`vfm:perm:${USER_ADMIN}`, '{"keš":true}');
    const token = issueToken(USER_ADMIN);

    const result = await service.resetPasswordWithToken({ token, newPassword: NEW_PASSWORD }, CONTEXT);

    expect(result).toEqual({ userId: USER_ADMIN, email: ADMIN_EMAIL });

    const stored = prisma.users.get(USER_ADMIN);
    expect(stored?.tokenVersion).toBe(ADMIN_SNAPSHOT.tokenVersion + 1);
    expect(stored?.failedLoginCount).toBe(0);
    expect(stored?.lockedUntil).toBeNull();
    expect(await passwords.verify(stored?.passwordHash ?? '', NEW_PASSWORD)).toBe(true);
    expect(await passwords.verify(stored?.passwordHash ?? '', PASSWORD)).toBe(false);

    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
    expect(redis.store.get(`vfm:perm:${USER_ADMIN}`)).toBeUndefined();
    expect(prisma.passwordResetTokens.every((row) => row.usedAt !== null)).toBe(true);
  });

  it('nepoznat token → 400 VALIDATION_ERROR (bez enumeracije)', async () => {
    const error = await service
      .resetPasswordWithToken({ token: 'x'.repeat(43), newPassword: NEW_PASSWORD }, CONTEXT)
      .catch((caught: unknown) => caught as VfmException);

    expect(error).toBeInstanceOf(VfmException);
    expect((error as VfmException).code).toBe('VALIDATION_ERROR');
    expect((error as VfmException).details?.[0]?.path).toEqual(['token']);
  });

  it('istekao token → odbijeno, lozinka nepromijenjena', async () => {
    const token = issueToken(USER_ADMIN, { expiresAt: new Date(Date.now() - 1_000) });
    const before = prisma.users.get(USER_ADMIN)?.passwordHash;

    await expect(
      service.resetPasswordWithToken({ token, newPassword: NEW_PASSWORD }, CONTEXT),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(prisma.users.get(USER_ADMIN)?.passwordHash).toBe(before);
  });

  it('iskorišten token se ne može ponoviti', async () => {
    const token = issueToken(USER_ADMIN);
    await service.resetPasswordWithToken({ token, newPassword: NEW_PASSWORD }, CONTEXT);

    await expect(
      service.resetPasswordWithToken({ token, newPassword: 'Druga!Sifra2026y' }, CONTEXT),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('slaba lozinka ne prolazi politiku i token ostaje neiskorišten', async () => {
    const token = issueToken(USER_ADMIN);

    await expect(
      service.resetPasswordWithToken({ token, newPassword: '12345678' }, CONTEXT),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(prisma.passwordResetTokens.every((row) => row.usedAt === null)).toBe(true);
    const stored = prisma.users.get(USER_ADMIN);
    expect(stored?.tokenVersion).toBe(ADMIN_SNAPSHOT.tokenVersion);
  });
});
