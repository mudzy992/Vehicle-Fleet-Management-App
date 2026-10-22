/**
 * `AuthController` — rute, metadata i HTTP detalji (`/api/v1/auth/*`).
 *
 * Šta se ovdje pokriva (servis je pokriven u `auth-service.spec.ts`):
 * - `@Public()` na `login`/`refresh`, puni lanac guard-ova na ostalim rutama,
 * - `@RateLimit('login')` samo na prijavi (5 / 15 min po IP-u),
 * - audit metadata (`LOGIN`/`LOGOUT`/`UPDATE` + severity),
 * - refresh token ide u **httpOnly cookie**, a nikad u tijelo odgovora,
 * - `refresh` čita token iz cookie-ja kad ga nema u tijelu (web),
 * - `logout`/`change-password` brišu cookie s istim atributima.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { __resetEnvCache } from '../../src/config/env.js';
import {
  AUDIT_METADATA_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../src/common/decorators/auth.decorators.js';
import { RATE_LIMIT_METADATA_KEY } from '../../src/common/rate-limit/rate-limit.decorator.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { AuthController } from '../../src/modules/auth/auth.controller.js';
import type { AuthService, AuthSessionResult } from '../../src/modules/auth/auth.service.js';
import type { TokenService, RefreshCookieOptions } from '../../src/modules/auth/services/token.service.js';
import { authenticatedUser } from '../helpers/rbac-fakes.js';

const COOKIE_NAME = 'vfm_refresh';
const ENV_KEYS = ['COOKIE_NAME', 'COOKIE_DOMAIN', 'COOKIE_SECURE', 'COOKIE_SAME_SITE', 'COOKIE_PATH'] as const;

const SESSION_ID = '018f0000-0000-7000-8000-0000000000aa';
const REFRESH_TOKEN = 'RT-0123456789abcdefghijklmnopqrstuvwxyzABC';
const ACCESS_TOKEN = 'header.payload.signature';

const COOKIE_OPTIONS: RefreshCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 2_592_000_000,
};

const USER_PAYLOAD = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-000000000r01', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['vehicle:view'],
  permissionsVersion: 1,
  tokenVersion: 4,
  mustChangePassword: false,
  timezone: 'Europe/Sarajevo',
  locale: 'bs',
  isSuperAdmin: false,
  allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
  lastLoginAt: null,
} as const;

function sessionResult(clientType: 'WEB' | 'MOBILE_ANDROID' = 'WEB'): AuthSessionResult {
  const refreshToken = clientType === 'WEB' ? {} : { refreshToken: REFRESH_TOKEN };

  return {
    clientType,
    response: {
      ...refreshToken,
      accessToken: ACCESS_TOKEN,
      tokenType: 'Bearer',
      expiresIn: 600,
      refreshExpiresIn: 2_592_000,
      sessionId: SESSION_ID,
      user: { ...USER_PAYLOAD, roles: [...USER_PAYLOAD.roles], permissions: [...USER_PAYLOAD.permissions], allowedClientTypes: [...USER_PAYLOAD.allowedClientTypes] },
    },
    refreshToken: REFRESH_TOKEN,
    refreshCookieOptions: COOKIE_OPTIONS,
  };
}

class FakeResponse {
  readonly cookieCalls: Array<{ name: string; value: string; options: unknown }> = [];
  readonly clearCalls: Array<{ name: string; options: unknown }> = [];

  cookie(name: string, value: string, options?: unknown): void {
    this.cookieCalls.push({ name, value, options });
  }

  clearCookie(name: string, options?: unknown): void {
    this.clearCalls.push({ name, options });
  }

  asExpress(): Response {
    return this as unknown as Response;
  }
}

function fakeRequest(options: { cookie?: string; userAgent?: string } = {}) {
  return {
    id: '018f0000-0000-7000-8000-00000000req1',
    ip: '203.0.113.9',
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.userAgent ? { 'user-agent': options.userAgent } : {}),
    },
  } as never;
}

let authCalls: Record<string, unknown[][]>;
let fakeAuth: AuthService;
let fakeTokens: TokenService;
let controller: AuthController;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.COOKIE_NAME = COOKIE_NAME;
  process.env.COOKIE_SECURE = 'true';
  process.env.COOKIE_SAME_SITE = 'strict';
  __resetEnvCache();

  authCalls = {
    login: [],
    refresh: [],
    logout: [],
    logoutAll: [],
    me: [],
    changePassword: [],
    listActiveSessions: [],
    revokeSession: [],
  };

  fakeAuth = {
    login: vi.fn(async (...args: unknown[]) => {
      authCalls.login?.push(args);
      return sessionResult();
    }),
    refresh: vi.fn(async (...args: unknown[]) => {
      authCalls.refresh?.push(args);
      return sessionResult();
    }),
    logout: vi.fn(async (...args: unknown[]) => {
      authCalls.logout?.push(args);
      return { revokedSessions: 1 };
    }),
    logoutAll: vi.fn(async (...args: unknown[]) => {
      authCalls.logoutAll?.push(args);
      return { revokedSessions: 2 };
    }),
    me: vi.fn(async (...args: unknown[]) => {
      authCalls.me?.push(args);
      return USER_PAYLOAD;
    }),
    changePassword: vi.fn(async (...args: unknown[]) => {
      authCalls.changePassword?.push(args);
    }),
    listActiveSessions: vi.fn(async (...args: unknown[]) => {
      authCalls.listActiveSessions?.push(args);
      return [];
    }),
    revokeSession: vi.fn(async (...args: unknown[]) => {
      authCalls.revokeSession?.push(args);
    }),
  } as unknown as AuthService;

  fakeTokens = {
    clearRefreshCookieOptions: () => ({ ...COOKIE_OPTIONS, maxAge: 0 }),
  } as unknown as TokenService;

  controller = new AuthController(fakeAuth, fakeTokens);
});

afterEach(() => {
  restoreEnv();
});

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCache();
}

describe('AuthController — metadata ruta', () => {
  it('login i refresh su @Public (bez JWT-a), ostale rute nisu', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.login)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.refresh)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.logout)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.logoutAll)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.me)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.changePassword)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.sessions)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.revokeSession)).toBeUndefined();
  });

  it('dozvole: logout-all/sessions traže auth:manage_sessions, change-password nema permisiju', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthController.prototype.logoutAll)).toMatchObject({
      permissions: ['auth:manage_sessions'],
      mode: 'ALL',
    });
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthController.prototype.sessions)).toMatchObject({
      permissions: ['auth:manage_sessions'],
    });
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthController.prototype.revokeSession)).toMatchObject({
      permissions: ['auth:manage_sessions'],
    });
    // Promjena vlastite lozinke i odjava ne traže permisiju: nalog s privremenom
    // lozinkom nema efektivna prava, a bez tih ruta ne bi mogao ni početi raditi.
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthController.prototype.changePassword)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthController.prototype.logout)).toBeUndefined();
  });

  it('stroži limiter (login: 5/15 min) važi samo za prijavu', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, AuthController.prototype.login)).toMatchObject({ scope: 'login' });
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, AuthController.prototype.refresh)).toBeUndefined();
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, AuthController.prototype.logout)).toBeUndefined();
  });

  it('audit: LOGIN/LOGOUT/UPDATE s SECURITY severity, bez diffa (nema osjetljivih polja)', () => {
    expect(Reflect.getMetadata(AUDIT_METADATA_KEY, AuthController.prototype.login)).toMatchObject({
      action: 'LOGIN',
      severity: 'SECURITY',
      diff: false,
    });
    expect(Reflect.getMetadata(AUDIT_METADATA_KEY, AuthController.prototype.logout)).toMatchObject({
      action: 'LOGOUT',
      severity: 'SECURITY',
    });
    expect(Reflect.getMetadata(AUDIT_METADATA_KEY, AuthController.prototype.changePassword)).toMatchObject({
      action: 'UPDATE',
      resource: 'User',
      severity: 'SECURITY',
      diff: false,
    });
    // `GET /me` se zove pri svakom učitavanju ekrana — bez audit zapisa.
    expect(Reflect.getMetadata(AUDIT_METADATA_KEY, AuthController.prototype.me)).toBeUndefined();
  });

});

describe('AuthController.login', () => {
  it('postavlja httpOnly cookie i vraća tijelo BEZ refresh tokena', async () => {
    const response = new FakeResponse();

    const body = await controller.login(
      { email: 'ana.anic@vfm.test', password: 'Sifra!Vfm2026', clientType: 'WEB' },
      fakeRequest(),
      response.asExpress(),
    );

    expect(response.cookieCalls).toEqual([{ name: COOKIE_NAME, value: REFRESH_TOKEN, options: COOKIE_OPTIONS }]);
    expect(body.accessToken).toBe(ACCESS_TOKEN);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(JSON.stringify(body)).not.toContain(REFRESH_TOKEN);
  });

  it('za mobilni klijent NE postavlja cookie, a refresh token je u tijelu', async () => {
    const response = new FakeResponse();
    (fakeAuth.login as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sessionResult('MOBILE_ANDROID'));

    const body = await controller.login(
      { email: 'ana.anic@vfm.test', password: 'Sifra!Vfm2026', clientType: 'MOBILE_ANDROID' },
      fakeRequest({ cookie: `${COOKIE_NAME}=stari-token` }),
      response.asExpress(),
    );

    expect(response.cookieCalls).toHaveLength(0);
    expect(response.clearCalls[0]?.name).toBe(COOKIE_NAME);
    expect(body.refreshToken).toBe(REFRESH_TOKEN);
  });

  it('prosljeđuje IP/UA/requestId servisu (audit i AuthAttempt)', async () => {
    const response = new FakeResponse();

    await controller.login(
      { email: 'ana.anic@vfm.test', password: 'Sifra!Vfm2026', clientType: 'WEB' },
      fakeRequest({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }),
      response.asExpress(),
    );

    const [, context] = authCalls.login?.[0] ?? [];
    expect(context).toMatchObject({
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      requestId: '018f0000-0000-7000-8000-00000000req1',
      method: 'POST',
    });
  });
});

describe('AuthController.refresh', () => {
  it('čita refresh token iz cookie-ja kad tijelo ne nosi token (web)', async () => {
    const response = new FakeResponse();

    await controller.refresh({}, fakeRequest({ cookie: `${COOKIE_NAME}=${REFRESH_TOKEN}; drugi=1` }), response.asExpress());

    const [, , cookieToken] = authCalls.refresh?.[0] ?? [];
    expect(cookieToken).toBe(REFRESH_TOKEN);
    expect(response.cookieCalls).toHaveLength(1);
  });

  it('bez cookie-ja prosljeđuje undefined (servis vraća 401)', async () => {
    const response = new FakeResponse();

    await controller.refresh({ refreshToken: REFRESH_TOKEN }, fakeRequest(), response.asExpress());

    const [, , cookieToken] = authCalls.refresh?.[0] ?? [];
    expect(cookieToken).toBeUndefined();
  });

  it('cookie s percent-encoded vrijednošću se dekodira', async () => {
    const response = new FakeResponse();

    await controller.refresh({}, fakeRequest({ cookie: `${COOKIE_NAME}=abc%2Bdef` }), response.asExpress());

    const [, , cookieToken] = authCalls.refresh?.[0] ?? [];
    expect(cookieToken).toBe('abc+def');
  });
});

describe('AuthController.logout / change-password', () => {
  it('logout briše cookie, prosljeđuje `sid` i refresh token iz cookie-ja', async () => {
    const response = new FakeResponse();
    const user: AuthenticatedUser = authenticatedUser({ id: USER_PAYLOAD.id });

    const result = await controller.logout(
      {},
      user,
      fakeRequest({ cookie: `${COOKIE_NAME}=${REFRESH_TOKEN}` }),
      response.asExpress(),
    );

    const args = authCalls.logout?.[0] ?? [];
    expect(result).toBeUndefined();
    expect(response.clearCalls[0]?.name).toBe(COOKIE_NAME);
    expect(response.clearCalls[0]?.options).toMatchObject({ httpOnly: true, secure: true, maxAge: 0 });
    expect(args[0]).toBe(USER_PAYLOAD.id);
    expect(args[1]).toEqual({ refreshToken: REFRESH_TOKEN });
    expect(args[3]).toBe(user.sessionId);
  });

  it('logout s tokenom u tijelu ne čita cookie (tijelo ima prednost)', async () => {
    const response = new FakeResponse();
    const user: AuthenticatedUser = authenticatedUser({ id: USER_PAYLOAD.id });

    await controller.logout(
      { refreshToken: 'RT-iz-tijela' },
      user,
      fakeRequest({ cookie: `${COOKIE_NAME}=RT-iz-cookieja` }),
      response.asExpress(),
    );

    expect(authCalls.logout?.[0]?.[1]).toEqual({ refreshToken: 'RT-iz-tijela' });
  });

  it('logout-all revokuje sve sesije i briše cookie', async () => {
    const response = new FakeResponse();
    const user: AuthenticatedUser = authenticatedUser({ id: USER_PAYLOAD.id });

    const result = await controller.logoutAll(user, fakeRequest(), response.asExpress());

    expect(result).toBeUndefined();
    expect(authCalls.logoutAll?.[0]?.[0]).toBe(USER_PAYLOAD.id);
    expect(response.clearCalls).toHaveLength(1);
  });

  it('change-password briše cookie (sve sesije su revokovane)', async () => {
    const response = new FakeResponse();
    const user: AuthenticatedUser = authenticatedUser({ id: USER_PAYLOAD.id });

    const result = await controller.changePassword(
      { currentPassword: 'Sifra!Vfm2026', newPassword: 'Nova!Sifra2026x' },
      user,
      fakeRequest(),
      response.asExpress(),
    );

    expect(result).toBeUndefined();
    expect(response.clearCalls).toHaveLength(1);
    expect(authCalls.changePassword?.[0]?.[0]).toBe(USER_PAYLOAD.id);
  });

  it('ruta bez korisnika u zahtjevu → 401 UNAUTHENTICATED (odbrambena provjera)', async () => {
    const response = new FakeResponse();

    const error = await controller
      .logout({}, undefined, fakeRequest(), response.asExpress())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VfmException);
    expect((error as VfmException).code).toBe('UNAUTHENTICATED');
  });
});

describe('AuthController.me / sessions', () => {
  it('me prosljeđuje clientType iz tokena (efektivna prava ovise o klijentu)', async () => {
    const user = authenticatedUser({ id: USER_PAYLOAD.id, clientType: 'MOBILE_ANDROID' });

    const payload = await controller.me(user);

    expect(authCalls.me?.[0]).toEqual([USER_PAYLOAD.id, 'MOBILE_ANDROID']);
    expect(payload.email).toBe('ana.anic@vfm.test');
  });

  it('sessions i revokeSession rade nad trenutnim korisnikom; trenutna sesija briše cookie', async () => {
    const user = authenticatedUser({ id: USER_PAYLOAD.id, sessionId: SESSION_ID });
    const response = new FakeResponse();

    await controller.sessions(user);
    const current = await controller.revokeSession(SESSION_ID, user, response.asExpress());
    const other = await controller.revokeSession('018f0000-0000-7000-8000-0000000000bb', user, response.asExpress());

    expect(authCalls.listActiveSessions?.[0]).toEqual([USER_PAYLOAD.id]);
    expect(authCalls.revokeSession).toEqual([
      [USER_PAYLOAD.id, SESSION_ID],
      [USER_PAYLOAD.id, '018f0000-0000-7000-8000-0000000000bb'],
    ]);
    expect(current).toEqual({ currentSessionRevoked: true });
    expect(other).toEqual({ currentSessionRevoked: false });
    expect(response.clearCalls).toEqual([{ name: COOKIE_NAME, options: expect.any(Object) }]);
  });
});
