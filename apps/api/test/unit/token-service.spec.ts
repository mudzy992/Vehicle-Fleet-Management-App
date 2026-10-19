import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { __resetEnvCache } from '../../src/config/env.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  TokenService,
  type AccessTokenClaims,
  type SignAccessTokenInput,
} from '../../src/modules/auth/services/token.service.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { JWT_CLAIMS, REFRESH_COOKIE_NAME, REFRESH_TOKEN_BYTES, type ClientType } from '@vfm/shared';

/**
 * `TokenService` — access JWT + refresh token (docs/05 §5, docs/07 §3.1).
 *
 * Sigurnosna svojstva koja se ovdje dokazuju:
 * - algoritam pinovan na HS256 (`alg: none` i tuđi secret ne prolaze),
 * - `iss`/`aud` se provjeravaju,
 * - istekao token → `401 TOKEN_EXPIRED`, sve ostalo → `401 UNAUTHENTICATED`,
 * - claimovi `tv`/`pv`/`ct`/`sid`/`roles` su obavezni (bez njih nema autorizacije),
 * - refresh token je CSPRNG, u bazi ide samo SHA-256 hash,
 * - cookie: HttpOnly (fiksan), Secure, SameSite, Path `/api/v1/auth`, max-age = TTL.
 */

const ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789abcdef';
const REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef0123456789abcdef';

/** Snapshot ENV-a da se testovi ne preliju u druge spec fajlove. */
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
] as const;

const LOGIN_INPUT: SignAccessTokenInput = {
  userId: '018f0000-0000-7000-8000-000000000001',
  roles: ['SUPER_ADMIN'],
  tokenVersion: 3,
  permissionsVersion: 7,
  clientType: 'WEB',
  sessionId: '018f0000-0000-7000-8000-0000000000aa',
};

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  process.env.JWT_ISSUER = 'vfm-api';
  process.env.JWT_AUDIENCE = 'vfm-clients';
  process.env.JWT_ACCESS_TTL = '10m';
  process.env.JWT_REFRESH_TTL = '30d';
  __resetEnvCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCache();
});

/** Sirovi JWT servis za namjerno „neprijateljske" tokene u testovima. */
function rawJwt(
  options: {
    secret?: string;
    issuer?: string;
    audience?: string;
    algorithm?: string;
  } = {},
): JwtService {
  return new JwtService({
    secret: options.secret ?? ACCESS_SECRET,
    signOptions: {
      algorithm: (options.algorithm ?? ACCESS_TOKEN_ALGORITHM) as 'HS256',
      issuer: options.issuer ?? 'vfm-api',
      audience: options.audience ?? 'vfm-clients',
    },
  });
}

/** Payload s punim setom claimova (kao što ga servis potpisuje). */
function fullPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: LOGIN_INPUT.userId,
    jti: '018f0000-0000-7000-8000-0000000000ff',
    [JWT_CLAIMS.roles]: ['SUPER_ADMIN'],
    [JWT_CLAIMS.tokenVersion]: 3,
    [JWT_CLAIMS.permissionsVersion]: 7,
    [JWT_CLAIMS.clientType]: 'WEB',
    [JWT_CLAIMS.sessionId]: LOGIN_INPUT.sessionId,
    ...overrides,
  };
}

/** Baci grešku i vrati je kao `VfmException`. */
function captureError(run: () => unknown): VfmException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}

/** `alg: none` token (klasični JWT bypass) — ručno sastavljen. */
function algNoneToken(): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    ...fullPayload(),
    iss: 'vfm-api',
    aud: 'vfm-clients',
    iat: now,
    exp: now + 600,
  })}.`;
}

describe('TokenService — TTL konfiguracija', () => {
  it('default: access 10 min (600 s), refresh 30 dana (2 592 000 s)', () => {
    const service = new TokenService();

    expect(service.accessTokenTtlSeconds()).toBe(600);
    expect(service.refreshTokenTtlSeconds()).toBe(2_592_000);
  });

  it('TTL čita ENV (JWT_ACCESS_TTL=15m → 900 s)', () => {
    process.env.JWT_ACCESS_TTL = '15m';
    __resetEnvCache();
    const service = new TokenService();

    expect(service.accessTokenTtlSeconds()).toBe(900);
    expect(service.signAccessToken(LOGIN_INPUT).expiresIn).toBe(900);
  });
});

describe('TokenService — izdavanje access tokena', () => {
  it('potpisuje HS256 s punim setom claimova (sub, jti, roles, tv, pv, ct, sid)', () => {
    const service = new TokenService();

    const signed = service.signAccessToken(LOGIN_INPUT);

    expect(signed.tokenType).toBe('Bearer');
    expect(signed.expiresIn).toBe(600);
    expect(signed.accessToken.split('.')).toHaveLength(3);

    const [header] = signed.accessToken.split('.');
    const decodedHeader = JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8')) as {
      alg: string;
      typ: string;
    };
    expect(decodedHeader).toMatchObject({ alg: 'HS256', typ: 'JWT' });

    expect(signed.claims).toMatchObject({
      sub: LOGIN_INPUT.userId,
      roles: ['SUPER_ADMIN'],
      tv: 3,
      pv: 7,
      ct: 'WEB',
      sid: LOGIN_INPUT.sessionId,
      iss: 'vfm-api',
      aud: 'vfm-clients',
    });
    expect(signed.claims.jti).toBeTruthy();
    expect(signed.claims.exp - signed.claims.iat).toBe(600);
  });

  it('mobilni clientType se upisuje u claim `ct` (N-05/P1 — provjera na svakom zahtjevu)', () => {
    const service = new TokenService();

    const android = service.signAccessToken({ ...LOGIN_INPUT, clientType: 'MOBILE_ANDROID' });
    const ios = service.signAccessToken({ ...LOGIN_INPUT, clientType: 'MOBILE_IOS' });

    expect(android.claims.ct).toBe('MOBILE_ANDROID');
    expect(ios.claims.ct).toBe('MOBILE_IOS');
  });

  it('svaki token dobija jedinstven jti', () => {
    const service = new TokenService();

    const jtis = new Set(Array.from({ length: 5 }, () => service.signAccessToken(LOGIN_INPUT).claims.jti));

    expect(jtis.size).toBe(5);
  });

  it('bez JWT_ACCESS_SECRET → 500 INTERNAL_ERROR (fail fast, bez potpisivanja prazninom)', () => {
    delete process.env.JWT_ACCESS_SECRET;
    __resetEnvCache();
    const service = new TokenService();

    const error = captureError(() => service.signAccessToken(LOGIN_INPUT));

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.httpStatus).toBe(500);
  });

  it('neispravan clientType → 500 INTERNAL_ERROR (mora proći DTO validaciju ranije)', () => {
    const service = new TokenService();

    const error = captureError(() =>
      service.signAccessToken({ ...LOGIN_INPUT, clientType: 'DESKTOP' as ClientType }),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('TokenService — verifikacija access tokena', () => {
  it('ispravan token → isti claimovi (round-trip)', () => {
    const service = new TokenService();
    const signed = service.signAccessToken(LOGIN_INPUT);

    const claims: AccessTokenClaims = service.verifyAccessToken(signed.accessToken);

    expect(claims.sub).toBe(signed.claims.sub);
    expect(claims.jti).toBe(signed.claims.jti);
    expect(claims.roles).toEqual(['SUPER_ADMIN']);
    expect(claims.tv).toBe(3);
    expect(claims.pv).toBe(7);
    expect(claims.ct).toBe('WEB');
    expect(claims.sid).toBe(LOGIN_INPUT.sessionId);
  });

  it('promijenjen potpis → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const signed = service.signAccessToken(LOGIN_INPUT);
    const [header, payload] = signed.accessToken.split('.');
    const tampered = `${header}.${payload}.${'A'.repeat(43)}`;

    const error = captureError(() => service.verifyAccessToken(tampered));

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.httpStatus).toBe(401);
  });

  it('promijenjen payload (eskalacija: roles/tv) → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const signed = service.signAccessToken(LOGIN_INPUT);
    const [header, , signature] = signed.accessToken.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...fullPayload({ [JWT_CLAIMS.roles]: ['SUPER_ADMIN'], [JWT_CLAIMS.tokenVersion]: 99 }),
      }),
      'utf8',
    ).toString('base64url');

    const error = captureError(() => service.verifyAccessToken(`${header}.${forgedPayload}.${signature}`));

    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('token potpisan drugim secretom → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const foreign = rawJwt({ secret: REFRESH_SECRET }).sign(fullPayload(), { expiresIn: '600s' });

    expect(captureError(() => service.verifyAccessToken(foreign)).code).toBe('UNAUTHENTICATED');
  });

  it('`alg: none` token → 401 UNAUTHENTICATED (algoritam je pinovan)', () => {
    const service = new TokenService();

    const error = captureError(() => service.verifyAccessToken(algNoneToken()));

    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('istekao token → 401 TOKEN_EXPIRED (razlikuje se od neispravnog)', () => {
    const service = new TokenService();
    const expired = rawJwt().sign(fullPayload(), { expiresIn: '-10s' });

    const error = captureError(() => service.verifyAccessToken(expired));

    expect(error.code).toBe('TOKEN_EXPIRED');
    expect(error.httpStatus).toBe(401);
  });

  it('pogrešan issuer → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const foreignIssuer = rawJwt({ issuer: 'drugi-servis' }).sign(fullPayload(), { expiresIn: '600s' });

    expect(captureError(() => service.verifyAccessToken(foreignIssuer)).code).toBe('UNAUTHENTICATED');
  });

  it('pogrešan audience → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const foreignAudience = rawJwt({ audience: 'druga-publika' }).sign(fullPayload(), {
      expiresIn: '600s',
    });

    expect(captureError(() => service.verifyAccessToken(foreignAudience)).code).toBe('UNAUTHENTICATED');
  });

  it('nedostaju claimovi (tv/pv/ct/sid/roles) → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();

    for (const claim of ['tv', 'pv', 'ct', 'sid', 'roles', 'sub', 'jti']) {
      const payload = fullPayload();
      delete payload[claim];
      const token = rawJwt().sign(payload, { expiresIn: '600s' });

      expect(captureError(() => service.verifyAccessToken(token)).code, `claim "${claim}"`).toBe(
        'UNAUTHENTICATED',
      );
    }
  });

  it('neispravan clientType u claimu → 401 UNAUTHENTICATED', () => {
    const service = new TokenService();
    const token = rawJwt().sign(fullPayload({ [JWT_CLAIMS.clientType]: 'DESKTOP' }), {
      expiresIn: '600s',
    });

    expect(captureError(() => service.verifyAccessToken(token)).code).toBe('UNAUTHENTICATED');
  });

  it('prazan token ili smeće → 401 UNAUTHENTICATED (bez bacanja sirove greške)', () => {
    const service = new TokenService();

    expect(captureError(() => service.verifyAccessToken('')).code).toBe('UNAUTHENTICATED');
    expect(captureError(() => service.verifyAccessToken('   ')).code).toBe('UNAUTHENTICATED');
    expect(captureError(() => service.verifyAccessToken('nije.jwt.token')).code).toBe('UNAUTHENTICATED');
  });

  it('claim ključevi su skraćeni (tv/pv/ct/sid) — manji token', () => {
    expect(JWT_CLAIMS).toMatchObject({
      tokenVersion: 'tv',
      permissionsVersion: 'pv',
      clientType: 'ct',
      sessionId: 'sid',
      roles: 'roles',
    });
  });
});

describe('TokenService — refresh token i token za reset lozinke', () => {
  it('refresh token: 32 B CSPRNG base64url (43 znaka) + SHA-256 hash (64 hex)', () => {
    const service = new TokenService();

    const { token, tokenHash } = service.generateRefreshToken();

    expect(REFRESH_TOKEN_BYTES).toBe(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('dva refresh tokena su različita, hash je deterministički', () => {
    const service = new TokenService();

    const first = service.generateRefreshToken();
    const second = service.generateRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
    expect(service.hashToken(first.token)).toBe(first.tokenHash);
  });

  it('token za reset lozinke: TTL 30 min, hash za bazu (sirovi token se ne čuva)', () => {
    const service = new TokenService();

    const before = Date.now();
    const reset = service.generatePasswordResetToken();
    const after = Date.now();

    expect(reset.ttlMinutes).toBe(30);
    expect(reset.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(reset.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(reset.expiresAt.getTime()).toBeLessThanOrEqual(after + 30 * 60_000);
  });
});

describe('TokenService — refresh cookie (docs/05 §5.2)', () => {
  it('naziv je COOKIE_NAME (default vfm_refresh)', () => {
    const service = new TokenService();

    expect(REFRESH_COOKIE_NAME).toBe('vfm_refresh');
    expect(service.refreshCookieName).toBe('vfm_refresh');
  });

  it('HttpOnly je fiksan (nije konfigurabilan), Secure/SameSite/Path iz ENV-a', () => {
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_SAME_SITE = 'lax';
    process.env.COOKIE_PATH = '/api/v1/auth';
    __resetEnvCache();
    const service = new TokenService();

    expect(service.refreshCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 2_592_000_000, // 30 dana u ms (express konvencija)
    });
  });

  it('SameSite=strict i COOKIE_SECURE=false (dev) se poštuju', () => {
    process.env.COOKIE_SAME_SITE = 'strict';
    process.env.COOKIE_SECURE = 'false';
    __resetEnvCache();
    const service = new TokenService();

    expect(service.refreshCookieOptions()).toMatchObject({ sameSite: 'strict', secure: false });
  });

  it('COOKIE_DOMAIN: prazno → .ba101.top (prema šemi), postavljeno → tačna vrijednost', () => {
    process.env.COOKIE_DOMAIN = '';
    __resetEnvCache();
    expect(new TokenService().refreshCookieOptions().domain).toBe('.ba101.top');

    process.env.COOKIE_DOMAIN = 'vehicle.ba101.top';
    __resetEnvCache();
    expect(new TokenService().refreshCookieOptions().domain).toBe('vehicle.ba101.top');
  });

  it('brisanje cookie-ja: isti path/domain, maxAge 0', () => {
    const service = new TokenService();
    const options = service.refreshCookieOptions();

    expect(service.clearRefreshCookieOptions()).toEqual({ ...options, maxAge: 0 });
  });
});

describe('TokenService — decodeClaims (dijagnostika bez verifikacije)', () => {
  it('čita claimove iz potpisanog tokena', () => {
    const service = new TokenService();
    const signed = service.signAccessToken(LOGIN_INPUT);

    expect(service.decodeClaims(signed.accessToken)).toMatchObject({
      sub: LOGIN_INPUT.userId,
      ct: 'WEB',
      tv: 3,
    });
  });

  it('odbija payload bez obaveznih claimova (isti ugovor kao verify)', () => {
    const service = new TokenService();
    const token = rawJwt().sign({ sub: LOGIN_INPUT.userId }, { expiresIn: '600s' });

    expect(captureError(() => service.decodeClaims(token)).code).toBe('UNAUTHENTICATED');
  });
});
