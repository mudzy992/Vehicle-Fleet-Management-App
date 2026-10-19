import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { JWT_CLAIMS, REDIS_NS, type ClientType } from '@vfm/shared';
import { __resetEnvCache } from '../../src/config/env.js';
import { JwtAuthGuard, extractBearerToken } from '../../src/common/guards/jwt-auth.guard.js';
import {
  ClientTypeGuard,
  fallbackAllowedClientTypes,
  isMobileClientType,
} from '../../src/common/guards/client-type.guard.js';
import {
  PERMISSIONS_STALE_RETRY_AFTER,
  PermissionsGuard,
  missingFor,
} from '../../src/common/guards/permissions.guard.js';
import {
  AllowedClientTypes,
  Public,
  RequireAnyPermission,
  RequirePermissions,
  RequireScope,
} from '../../src/common/decorators/auth.decorators.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import {
  ADMIN_GRANTS,
  ADMIN_SNAPSHOT,
  DRIVER_SNAPSHOT,
  FakeLoader,
  FakeRedis,
  FakeResponse,
  RecordingSecuritySink,
  ROLE_ADMIN_ID,
  ROLE_SUPER_ID,
  SUPER_ADMIN_SNAPSHOT,
  USER_ADMIN,
  USER_DRIVER,
  USER_SUPER,
  authenticatedUser,
  fakeExecutionContext,
  fakeRedisService,
  fakeRequest,
} from '../helpers/rbac-fakes.js';

/**
 * Guard-ovi autentifikacije/autorizacije (docs/05 §5.3, §6) — P1, P3, P14.
 *
 * Koristi se **stvarni `Reflector`** i stvarni dekoratori na test controlleru, pa
 * se istovremeno provjerava da metadata dekoratora radi, a ne samo logika guard-a.
 *
 * Redoslijed guard-ova u `AppModule`: `JwtAuthGuard` → `ClientTypeGuard` →
 * `PermissionsGuard`. Testovi poštuju isti redoslijed.
 */

/** Test controller s dekoratorima (metadata čita stvarni `Reflector`). */
class TestController {
  @Public()
  publicRoute(): void {}

  noMetadata(): void {}

  @RequirePermissions('vehicle:create')
  createVehicle(): void {}

  @RequirePermissions('user:create', 'role:update')
  manageUsers(): void {}

  @RequireAnyPermission('system:view_health', 'system:view_queue')
  diagnostics(): void {}

  @RequireScope('vehicle:view', 'ALL')
  allVehicles(): void {}

  @AllowedClientTypes('WEB')
  webOnly(): void {}

  @AllowedClientTypes('MOBILE_ANDROID', 'MOBILE_IOS')
  mobileOnly(): void {}
}

const ACCESS_SECRET = 'guard-test-access-secret-0123456789abcdef0123456789';

let redis: FakeRedis;
let loader: FakeLoader;
let tokens: TokenService;
let permissions: PermissionsService;
let security: RecordingSecuritySink;
let reflector: Reflector;
let jwtGuard: JwtAuthGuard;
let clientGuard: ClientTypeGuard;
let permissionsGuard: PermissionsGuard;
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  __resetEnvCache();

  redis = new FakeRedis();
  loader = new FakeLoader([SUPER_ADMIN_SNAPSHOT, ADMIN_SNAPSHOT, DRIVER_SNAPSHOT]);
  security = new RecordingSecuritySink();
  reflector = new Reflector();
  tokens = new TokenService();
  permissions = new PermissionsService(fakeRedisService(redis), loader);
  jwtGuard = new JwtAuthGuard(reflector, tokens, permissions, security);
  clientGuard = new ClientTypeGuard(reflector, security);
  permissionsGuard = new PermissionsGuard(reflector, permissions, security);
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = savedSecret;
  __resetEnvCache();
});

/** Snapshot iz `loader`-a po userId-u. */
function snapshotOf(userId: string) {
  if (userId === USER_SUPER) return SUPER_ADMIN_SNAPSHOT;
  if (userId === USER_ADMIN) return ADMIN_SNAPSHOT;
  return DRIVER_SNAPSHOT;
}

/** Potpisan access token za korisnika iz fixture seta. */
function tokenFor(
  userId: string,
  options: { clientType?: ClientType; tv?: number; pv?: number; roles?: string[] } = {},
): string {
  const data = snapshotOf(userId);
  return tokens.signAccessToken({
    userId,
    roles: options.roles ?? [...data.roles],
    tokenVersion: options.tv ?? data.tokenVersion,
    permissionsVersion: options.pv ?? data.permissionsVersion,
    clientType: options.clientType ?? 'WEB',
    sessionId: '018f0000-0000-7000-8000-0000000000aa',
  }).accessToken;
}

/** Već istekao token s ispravnim claimovima (isti secret/iss/aud). */
function expiredTokenFor(userId: string): string {
  const data = snapshotOf(userId);
  const raw = new JwtService({
    secret: ACCESS_SECRET,
    signOptions: { algorithm: 'HS256', issuer: 'vfm-api', audience: 'vfm-clients' },
  });
  return raw.sign(
    {
      sub: userId,
      jti: '018f0000-0000-7000-8000-0000000000cc',
      [JWT_CLAIMS.roles]: [...data.roles],
      [JWT_CLAIMS.tokenVersion]: data.tokenVersion,
      [JWT_CLAIMS.permissionsVersion]: data.permissionsVersion,
      [JWT_CLAIMS.clientType]: 'WEB',
      [JWT_CLAIMS.sessionId]: '018f0000-0000-7000-8000-0000000000aa',
    },
    { expiresIn: '-10s' },
  );
}

/** Kontekst za datu metodu test controllera. */
function contextFor(method: keyof TestController, request: VfmRequest, response = new FakeResponse()) {
  return {
    context: fakeExecutionContext({
      handler: TestController.prototype[method] as (...args: never[]) => unknown,
      controller: TestController,
      request,
      response,
    }),
    response,
  };
}

/** Baci i vrati grešku kao `VfmException`. */
async function captureError(promise: Promise<unknown> | unknown): Promise<VfmException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}

/** Korisnik s izračunatim pravima (kao nakon `JwtAuthGuard`). */
async function userWithPermissions(
  userId: string,
  overrides: Partial<AuthenticatedUser> = {},
): Promise<AuthenticatedUser> {
  const data = snapshotOf(userId);
  return authenticatedUser({
    id: userId,
    roles: data.roles,
    roleIds: data.roleIds,
    isSuperAdmin: data.roles.includes('SUPER_ADMIN'),
    allowedClientTypes: data.allowedClientTypes,
    tokenVersion: data.tokenVersion,
    permissionsVersion: data.permissionsVersion,
    permissions: await permissions.effective(userId, overrides.clientType ?? 'WEB'),
    ...overrides,
  });
}

/** Puni lanac guard-ova (kao u `AppModule`). */
async function runGuards(
  method: keyof TestController,
  request: VfmRequest,
  response = new FakeResponse(),
): Promise<boolean> {
  const { context } = contextFor(method, request, response);
  if (!(await jwtGuard.canActivate(context))) return false;
  if (!(await clientGuard.canActivate(context))) return false;
  return permissionsGuard.canActivate(context);
}

describe('JwtAuthGuard — autentifikacija', () => {
  it('@Public ruta prolazi bez tokena (health, login)', async () => {
    const { context } = contextFor('publicRoute', fakeRequest({}));

    await expect(jwtGuard.canActivate(context)).resolves.toBe(true);
  });

  it('bez tokena → 401 UNAUTHENTICATED + sigurnosni događaj', async () => {
    const { context } = contextFor('noMetadata', fakeRequest({}));

    const error = await captureError(jwtGuard.canActivate(context));

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.httpStatus).toBe(401);
    expect(security.types).toContain('UNAUTHENTICATED');
    expect(security.events[0]?.requestId).toBe('req-test-1');
  });

  it('X-Client-Type zaglavlje NE zamjenjuje token', async () => {
    const { context } = contextFor('noMetadata', fakeRequest({ headers: { 'x-client-type': 'WEB' } }));

    expect((await captureError(jwtGuard.canActivate(context))).code).toBe('UNAUTHENTICATED');
  });

  it('neispravan token → 401 UNAUTHENTICATED', async () => {
    const { context } = contextFor(
      'noMetadata',
      fakeRequest({ headers: { authorization: 'Bearer nije.jwt.token' } }),
    );

    expect((await captureError(jwtGuard.canActivate(context))).code).toBe('UNAUTHENTICATED');
  });

  it('istekao token → 401 TOKEN_EXPIRED', async () => {
    const { context } = contextFor(
      'noMetadata',
      fakeRequest({ headers: { authorization: `Bearer ${expiredTokenFor(USER_ADMIN)}` } }),
    );

    expect((await captureError(jwtGuard.canActivate(context))).code).toBe('TOKEN_EXPIRED');
  });

  it('validan token → request.user s pravima (Super Admin web ima sve)', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_SUPER)}` },
    });
    const { context } = contextFor('noMetadata', request);

    await expect(jwtGuard.canActivate(context)).resolves.toBe(true);

    const user = request.user as AuthenticatedUser;
    expect(user.id).toBe(USER_SUPER);
    expect(user.roles).toEqual(['SUPER_ADMIN']);
    expect(user.isSuperAdmin).toBe(true);
    expect(user.clientType).toBe('WEB');
    expect(user.roleIds).toEqual([ROLE_SUPER_ID]);
    expect(user.permissions?.isSuperAdmin).toBe(true);
    expect(user.permissions?.permissions.get('user:create')).toBe('ALL');
  });

  it('nepostojeći korisnik u tokenu → 401 (ne 404)', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor('018f0000-0000-7000-8000-0000000000ff')}` },
    });
    const { context } = contextFor('noMetadata', request);

    expect((await captureError(jwtGuard.canActivate(context))).code).toBe('UNAUTHENTICATED');
  });

  it('neaktivan nalog (SUSPENDED) → 403 ACCOUNT_INACTIVE', async () => {
    loader.update(USER_ADMIN, { status: 'SUSPENDED' });
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_ADMIN)}` },
    });
    const { context } = contextFor('noMetadata', request);

    const error = await captureError(jwtGuard.canActivate(context));

    expect(error.code).toBe('ACCOUNT_INACTIVE');
    expect(error.httpStatus).toBe(403);
  });

  it('tokenVersion niža od trenutne → 401 TOKEN_REVOKED (prisilno odjavljivanje)', async () => {
    await redis.set(`${REDIS_NS.tokenVersion}:${USER_ADMIN}`, '9');
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_ADMIN)}` },
    });
    const { context } = contextFor('noMetadata', request);

    expect((await captureError(jwtGuard.canActivate(context))).code).toBe('TOKEN_REVOKED');
    expect(security.types).toContain('TOKEN_REVOKED');
  });

  it('tokenVersion jednaka → prolazi', async () => {
    await redis.set(`${REDIS_NS.tokenVersion}:${USER_ADMIN}`, String(ADMIN_SNAPSHOT.tokenVersion));
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_ADMIN)}` },
    });
    const { context } = contextFor('noMetadata', request);

    await expect(jwtGuard.canActivate(context)).resolves.toBe(true);
  });

  it('mobilni token Super Admina prolazi auth, ali prava su prazna (drugi sloj odbrane)', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_SUPER, { clientType: 'MOBILE_ANDROID' })}` },
    });
    const { context } = contextFor('noMetadata', request);

    await expect(jwtGuard.canActivate(context)).resolves.toBe(true);
    expect((request.user as AuthenticatedUser).permissions?.list).toEqual([]);
  });

  it('bez Prisma loadera → 503 DEPENDENCY_UNAVAILABLE (fail closed, bloker 1)', async () => {
    const brokenLoader = new FakeLoader([]);
    brokenLoader.loadSnapshot = async () => {
      throw new VfmException('DEPENDENCY_UNAVAILABLE');
    };
    const brokenPermissions = new PermissionsService(fakeRedisService(redis), brokenLoader);
    const guard = new JwtAuthGuard(reflector, tokens, brokenPermissions, security);
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_ADMIN)}` },
    });

    const error = await captureError(guard.canActivate(contextFor('noMetadata', request).context));

    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(error.httpStatus).toBe(503);
  });

  it('extractBearerToken: case-insensitive shema, višestruki razmaci, niz zaglavlja', () => {
    expect(extractBearerToken(fakeRequest({ headers: { authorization: 'Bearer abc' } }))).toBe('abc');
    expect(extractBearerToken(fakeRequest({ headers: { authorization: 'bearer   abc ' } }))).toBe('abc');
    expect(extractBearerToken(fakeRequest({ headers: { authorization: 'Basic abc' } }))).toBeUndefined();
    expect(extractBearerToken(fakeRequest({ headers: { authorization: 'Bearer ' } }))).toBeUndefined();
    expect(extractBearerToken(fakeRequest({ headers: { authorization: ['Bearer a', 'Bearer b'] } }))).toBe(
      'a',
    );
  });
});

describe('ClientTypeGuard — N-05 / P1 (Super Admin je web-only)', () => {
  it('Super Admin + MOBILE_ANDROID → 403 MOBILE_ACCESS_FORBIDDEN + SECURITY_EVENT', async () => {
    const request = fakeRequest({
      user: await userWithPermissions(USER_SUPER, { clientType: 'MOBILE_ANDROID' }),
    });
    const { context } = contextFor('noMetadata', request);

    const error = await captureError(clientGuard.canActivate(context));

    expect(error.code).toBe('MOBILE_ACCESS_FORBIDDEN');
    expect(error.httpStatus).toBe(403);
    expect(security.events[0]).toMatchObject({
      type: 'MOBILE_ACCESS_FORBIDDEN',
      userId: USER_SUPER,
      clientType: 'MOBILE_ANDROID',
    });
  });

  it('Super Admin + MOBILE_IOS → isto 403 (pravilo važi za oba mobilna klijenta)', async () => {
    const request = fakeRequest({
      user: await userWithPermissions(USER_SUPER, { clientType: 'MOBILE_IOS' }),
    });
    const { context } = contextFor('noMetadata', request);

    expect((await captureError(clientGuard.canActivate(context))).code).toBe('MOBILE_ACCESS_FORBIDDEN');
  });

  it('Super Admin + WEB → prolazi', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_SUPER) });
    const { context } = contextFor('noMetadata', request);

    await expect(clientGuard.canActivate(context)).resolves.toBe(true);
  });

  it('Administrator + MOBILE_ANDROID → prolazi (uloga dozvoljava)', async () => {
    const request = fakeRequest({
      user: await userWithPermissions(USER_ADMIN, { clientType: 'MOBILE_ANDROID' }),
    });
    const { context } = contextFor('noMetadata', request);

    await expect(clientGuard.canActivate(context)).resolves.toBe(true);
  });

  it('Administrator + MOBILE_IOS → 403 MOBILE_SCOPE_NOT_ALLOWED', async () => {
    const request = fakeRequest({
      user: await userWithPermissions(USER_ADMIN, { clientType: 'MOBILE_IOS' }),
    });
    const { context } = contextFor('noMetadata', request);

    const error = await captureError(clientGuard.canActivate(context));

    expect(error.code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
    expect(error.httpStatus).toBe(403);
    expect(security.types).toContain('MOBILE_SCOPE_NOT_ALLOWED');
  });

  it('@AllowedClientTypes("WEB") odbija mobilni token i kad ga uloga dozvoljava', async () => {
    const request = fakeRequest({
      user: await userWithPermissions(USER_ADMIN, { clientType: 'MOBILE_ANDROID' }),
    });
    const { context } = contextFor('webOnly', request);

    expect((await captureError(clientGuard.canActivate(context))).code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
  });

  it('@AllowedClientTypes("MOBILE_ANDROID","MOBILE_IOS") odbija web token', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const { context } = contextFor('mobileOnly', request);

    expect((await captureError(clientGuard.canActivate(context))).code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
  });

  it('@Public ruta prolazi bez korisnika', async () => {
    const { context } = contextFor('publicRoute', fakeRequest({}));

    await expect(clientGuard.canActivate(context)).resolves.toBe(true);
  });

  it('prazna allowedClientTypes iz baze → fallback na ROLE_ALLOWED_CLIENT_TYPES', () => {
    expect(fallbackAllowedClientTypes(['SUPER_ADMIN'])).toEqual(['WEB']);
    expect(fallbackAllowedClientTypes(['ADMINISTRATOR'])).toContain('MOBILE_ANDROID');
    expect(fallbackAllowedClientTypes(['nepoznata-uloga'])).toEqual(['WEB']);
  });

  it('isMobileClientType prepoznaje mobilne klijente', () => {
    expect(isMobileClientType('MOBILE_ANDROID')).toBe(true);
    expect(isMobileClientType('MOBILE_IOS')).toBe(true);
    expect(isMobileClientType('WEB')).toBe(false);
    expect(isMobileClientType(undefined)).toBe(false);
  });
});

describe('PermissionsGuard — permisije i opseg (P14)', () => {
  it('ruta bez @RequirePermissions prolazi (npr. /auth/me)', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const { context } = contextFor('noMetadata', request);

    await expect(permissionsGuard.canActivate(context)).resolves.toBe(true);
  });

  it('Administrator ima vehicle:create → prolazi', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const { context } = contextFor('createVehicle', request);

    await expect(permissionsGuard.canActivate(context)).resolves.toBe(true);
  });

  it('Administrator nema user:create/role:update → 403 PERMISSION_DENIED s details[]', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const { context } = contextFor('manageUsers', request);

    const error = await captureError(permissionsGuard.canActivate(context));

    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.httpStatus).toBe(403);
    expect(error.details?.map((detail) => detail.path[0])).toEqual(['user:create', 'role:update']);
    expect(security.types).toContain('PERMISSION_DENIED');
  });

  it('Super Admin (web) prolazi svaku provjeru permisija (R-07)', async () => {
    const request = fakeRequest({ user: await userWithPermissions(USER_SUPER) });

    for (const method of ['createVehicle', 'manageUsers', 'diagnostics', 'allVehicles'] as const) {
      const { context } = contextFor(method, request);
      await expect(permissionsGuard.canActivate(context), method).resolves.toBe(true);
    }
  });

  it('@RequireAnyPermission: prolazi ako je barem jedna prisutna', async () => {
    const allowed = fakeRequest({ user: await userWithPermissions(USER_SUPER) });
    const denied = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });

    await expect(permissionsGuard.canActivate(contextFor('diagnostics', allowed).context)).resolves.toBe(
      true,
    );
    expect(
      (await captureError(permissionsGuard.canActivate(contextFor('diagnostics', denied).context))).code,
    ).toBe('PERMISSION_DENIED');
  });

  it('@RequireScope(…, "ALL"): opseg VEHICLE_IDS nije dovoljan', async () => {
    const admin = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const driver = fakeRequest({ user: await userWithPermissions(USER_DRIVER) });

    await expect(permissionsGuard.canActivate(contextFor('allVehicles', admin).context)).resolves.toBe(true);
    expect(
      (await captureError(permissionsGuard.canActivate(contextFor('allVehicles', driver).context))).code,
    ).toBe('PERMISSION_DENIED');
  });

  it('missingFor: ALL/ANY logika i minimalan opseg', () => {
    const onlyVehicleView = authenticatedUser({
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([['vehicle:view', 'ALL'] as const]),
        list: ['vehicle:view'],
        grants: [],
      },
    });
    const ownOnly = authenticatedUser({
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([['task:execute', 'OWN'] as const]),
        list: ['task:execute'],
        grants: [],
      },
    });

    expect(
      missingFor(onlyVehicleView, {
        permissions: ['user:create', 'role:update'],
        mode: 'ALL',
        scope: 'OWN',
      }),
    ).toEqual(['user:create', 'role:update']);
    expect(
      missingFor(onlyVehicleView, {
        permissions: ['vehicle:view', 'user:create'],
        mode: 'ANY',
        scope: 'OWN',
      }),
    ).toEqual([]);
    expect(
      missingFor(onlyVehicleView, {
        permissions: ['user:create', 'role:update'],
        mode: 'ANY',
        scope: 'OWN',
      }),
    ).toEqual(['user:create', 'role:update']);
    expect(missingFor(ownOnly, { permissions: ['task:execute'], mode: 'ALL', scope: 'ALL' })).toEqual([
      'task:execute',
    ]);
    expect(missingFor(ownOnly, { permissions: ['task:execute'], mode: 'ALL', scope: 'OWN' })).toEqual([]);
  });
});

describe('PermissionsGuard — P3: revokacija prava ≤ 5 s bez ponovnog logina', () => {
  it('stari pv → 401 PERMISSIONS_STALE + Retry-After: 0 + sigurnosni događaj', async () => {
    // Roles modul je upisao novu matricu → brojač verzije je sada 2, a token
    // korisnika nosi pv=1 (izdat prije izmjene).
    await redis.set(`${REDIS_NS.permissionsVersion}:role:${ROLE_ADMIN_ID}`, '2');
    const response = new FakeResponse();
    const request = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    const { context } = contextFor('createVehicle', request, response);

    const error = await captureError(permissionsGuard.canActivate(context));

    expect(error.code).toBe('PERMISSIONS_STALE');
    expect(error.httpStatus).toBe(401);
    expect(response.headers['Retry-After']).toBe(PERMISSIONS_STALE_RETRY_AFTER);
    expect(security.types).toContain('PERMISSIONS_STALE');
  });

  it('pun P3 tok: opoziv → PERMISSIONS_STALE → refresh (novi pv) → PERMISSION_DENIED', async () => {
    // 1) Korisnik ima pravo i token s pv=1.
    const before = fakeRequest({ user: await userWithPermissions(USER_ADMIN) });
    await expect(permissionsGuard.canActivate(contextFor('createVehicle', before).context)).resolves.toBe(
      true,
    );

    // 2) Super Admin oduzima `vehicle:create` u matrici role (Roles modul).
    loader.update(USER_ADMIN, {
      grants: ADMIN_GRANTS.filter((grant) => grant.permission !== 'vehicle:create'),
      permissionsVersion: 2,
    });
    await permissions.invalidateRole(ROLE_ADMIN_ID, 2);

    // 3) Stari token (pv=1) → PERMISSIONS_STALE, klijent radi refresh.
    const stale = fakeRequest({
      user: authenticatedUser({
        id: USER_ADMIN,
        roleIds: [ROLE_ADMIN_ID],
        permissionsVersion: 1,
        permissions: await permissions.effective(USER_ADMIN),
      }),
    });
    expect(
      (await captureError(permissionsGuard.canActivate(contextFor('createVehicle', stale).context))).code,
    ).toBe('PERMISSIONS_STALE');

    // 4) Novi token (pv=2) → 403 PERMISSION_DENIED, bez ponovnog logina.
    const afterRefresh = fakeRequest({
      user: authenticatedUser({
        id: USER_ADMIN,
        roleIds: [ROLE_ADMIN_ID],
        permissionsVersion: 2,
        permissions: await permissions.effective(USER_ADMIN),
      }),
    });
    const error = await captureError(
      permissionsGuard.canActivate(contextFor('createVehicle', afterRefresh).context),
    );

    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.details?.map((detail) => detail.path[0])).toEqual(['vehicle:create']);
  });

  it('svjež pv prolazi (nema lažnih PERMISSIONS_STALE)', async () => {
    const request = fakeRequest({
      user: authenticatedUser({
        id: USER_ADMIN,
        roleIds: [ROLE_ADMIN_ID],
        permissionsVersion: 5,
        permissions: await permissions.effective(USER_ADMIN),
      }),
    });

    await expect(permissionsGuard.canActivate(contextFor('createVehicle', request).context)).resolves.toBe(
      true,
    );
  });
});

describe('Puni lanac guard-ova (JwtAuth → ClientType → Permissions)', () => {
  it('P1: Super Admin s mobilnim tokenom ne prolazi ni na jednoj ruti', async () => {
    const request = fakeRequest({
      headers: {
        authorization: `Bearer ${tokenFor(USER_SUPER, { clientType: 'MOBILE_ANDROID' })}`,
      },
    });

    const error = await captureError(runGuards('noMetadata', request));

    expect(error.code).toBe('MOBILE_ACCESS_FORBIDDEN');
    expect(security.types).toContain('MOBILE_ACCESS_FORBIDDEN');
  });

  it('P1: isti Super Admin s web tokenom prolazi', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_SUPER)}` },
    });

    await expect(runGuards('createVehicle', request)).resolves.toBe(true);
  });

  it('P14: Administrator bez prava ne dobija pristup ni s validnim tokenom', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_ADMIN)}` },
    });

    expect((await captureError(runGuards('manageUsers', request))).code).toBe('PERMISSION_DENIED');
  });

  it('javna ruta prolazi bez tokena kroz cijeli lanac', async () => {
    await expect(runGuards('publicRoute', fakeRequest({}))).resolves.toBe(true);
  });

  it('mobilni Administrator na web-only ruti → 403 (claim `ct` pobjeđuje zaglavlje)', async () => {
    const request = fakeRequest({
      headers: {
        authorization: `Bearer ${tokenFor(USER_ADMIN, { clientType: 'MOBILE_ANDROID' })}`,
        'x-client-type': 'WEB',
      },
    });

    expect((await captureError(runGuards('webOnly', request))).code).toBe('MOBILE_SCOPE_NOT_ALLOWED');
  });

  it('vozač s opsegom VEHICLE_IDS prolazi rutu bez eksplicitne permisije', async () => {
    const request = fakeRequest({
      headers: { authorization: `Bearer ${tokenFor(USER_DRIVER)}` },
    });

    await expect(runGuards('noMetadata', request)).resolves.toBe(true);
    expect((request.user as AuthenticatedUser).permissions?.permissions.get('vehicle:view')).toBe(
      'VEHICLE_IDS',
    );
  });

  it('fixture podaci su konzistentni (snapshot → guard → prava)', async () => {
    expect(SUPER_ADMIN_SNAPSHOT.allowedClientTypes).toEqual(['WEB']);
    expect(DRIVER_SNAPSHOT.grants.length).toBeGreaterThan(0);
    expect(new FakeResponse().statusCode).toBeUndefined();
    expect(isMobileClientType('WEB')).toBe(false);
  });
});
