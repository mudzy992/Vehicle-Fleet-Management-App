import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetEnvCache } from '../../src/config/env.js';
import { RateLimitService, sanitizeIdentity } from '../../src/common/rate-limit/rate-limit.service.js';
import { RateLimit, SkipRateLimit } from '../../src/common/rate-limit/rate-limit.decorator.js';
import {
  RATE_LIMIT_HEADERS,
  RateLimitGuard,
  requestIdentity,
  resolvePolicy,
} from '../../src/common/guards/rate-limit.guard.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import {
  FakeRedis,
  FakeResponse,
  RecordingSecuritySink,
  USER_ADMIN,
  authenticatedUser,
  fakeExecutionContext,
  fakeRedisService,
  fakeRequest,
} from '../helpers/rbac-fakes.js';
import type { VfmRequest } from '../../src/common/types/authenticated-user.js';

/**
 * Rate limiting (docs/07 §5): `vfm:rl:{scope}:{identity}`, fiksni prozor
 * `INCR` + `PEXPIRE`, limiti iz ENV-a (global 300/60 s, login 5/900 s,
 * upload 30/60 s).
 *
 * Guard je registrovan **prije** `JwtAuthGuard`-a, pa je odbijanje jeftinije od
 * argon2id verifikacije — to je i testirano (login ruta troši `login` opseg).
 */

class TestController {
  bezLimitera(): void {}

  @RateLimit('login')
  login(): void {}

  @RateLimit('upload', { limit: 2 })
  upload(): void {}

  @RateLimit('global', { limit: 9999 })
  pokusajPovecanja(): void {}

  @SkipRateLimit()
  health(): void {}
}

let redis: FakeRedis;
let service: RateLimitService;
let security: RecordingSecuritySink;
let guard: RateLimitGuard;
let reflector: Reflector;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ['THROTTLE_ENABLED', 'THROTTLE_LOGIN_LIMIT']) savedEnv[key] = process.env[key];
  delete process.env.THROTTLE_ENABLED;
  delete process.env.THROTTLE_LOGIN_LIMIT;
  __resetEnvCache();

  redis = new FakeRedis();
  service = new RateLimitService(fakeRedisService(redis));
  security = new RecordingSecuritySink();
  reflector = new Reflector();
  guard = new RateLimitGuard(reflector, service, security);
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCache();
});

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

/** IP zahtjev (kao iz Traefik/nginx proxy-ja). */
function ipRequest(ip = '198.51.100.7'): VfmRequest {
  return fakeRequest({
    ip,
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
}

describe('RateLimitService — politike iz ENV-a', () => {
  it('global 300/60 s, login 5/900 s, upload 30/60 s (docs/07 §5)', () => {
    expect(service.policyFor('global')).toEqual({ limit: 300, windowSeconds: 60 });
    expect(service.policyFor('login')).toEqual({ limit: 5, windowSeconds: 900 });
    expect(service.policyFor('upload')).toEqual({ limit: 30, windowSeconds: 60 });
    expect(service.isEnabled).toBe(true);
  });

  it('ENV preklop se poštuje (THROTTLE_LOGIN_LIMIT=3)', () => {
    process.env.THROTTLE_LOGIN_LIMIT = '3';
    __resetEnvCache();

    expect(new RateLimitService(fakeRedisService(redis)).policyFor('login').limit).toBe(3);
  });
});

describe('RateLimitService — consume (fiksni prozor)', () => {
  it('login: 5 pokušaja prolazi, 6. je odbijen s Retry-After', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const result = await service.consume('login', 'ip-198.51.100.7');
      expect(result.allowed, `pokušaj ${i}`).toBe(true);
      expect(result.current).toBe(i);
      expect(result.remaining).toBe(5 - i);
    }

    const denied = await service.consume('login', 'ip-198.51.100.7');

    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(denied.degraded).toBe(false);
  });

  it('ključ je `vfm:rl:{scope}:{identity}` (unutar ACL opsega ~vfm:*)', async () => {
    await service.consume('login', 'ip-198.51.100.7');

    expect(redis.keys()).toEqual(['vfm:rl:login:ip-198.51.100.7']);
    expect(redis.keys()[0]?.startsWith('vfm:rl:')).toBe(true);
  });

  it('PEXPIRE se postavlja samo pri prvom zahtjevu (prozor se ne pomjera)', async () => {
    await service.consume('global', 'ip-1.1.1.1');
    expect(redis.pttls.get('vfm:rl:global:ip-1.1.1.1')).toBe(60_000);

    await service.consume('global', 'ip-1.1.1.1');
    await service.consume('global', 'ip-1.1.1.1');
    expect(redis.pttls.get('vfm:rl:global:ip-1.1.1.1')).toBe(60_000);
    expect(redis.store.get('vfm:rl:global:ip-1.1.1.1')).toBe('3');
  });

  it('PEXPIRE kvar uklanja prvi brojač da ne ostane trajni rate-limit key', async () => {
    redis.failNextPexpire = true;

    const result = await service.consume('login', 'ip-9.9.9.9');

    expect(result).toMatchObject({ allowed: true, degraded: true });
    expect(redis.store.has('vfm:rl:login:ip-9.9.9.9')).toBe(false);
    expect(redis.pttls.has('vfm:rl:login:ip-9.9.9.9')).toBe(false);
  });

  it('različiti identiteti imaju odvojene brojače', async () => {
    await service.consume('login', 'ip-1.1.1.1');
    await service.consume('login', 'ip-1.1.1.1');
    const other = await service.consume('login', 'ip-2.2.2.2');

    expect(other.current).toBe(1);
    expect(redis.store.get('vfm:rl:login:ip-1.1.1.1')).toBe('2');
  });

  it('različiti opsezi ne dijele brojač', async () => {
    await service.consume('login', 'ip-1.1.1.1');
    const global = await service.consume('global', 'ip-1.1.1.1');

    expect(global.current).toBe(1);
    expect(redis.keys().sort()).toEqual(['vfm:rl:global:ip-1.1.1.1', 'vfm:rl:login:ip-1.1.1.1']);
  });

  it('reset briše brojač (npr. nakon uspješnog logina)', async () => {
    await service.consume('login', 'ip-1.1.1.1');
    await service.reset('login', 'ip-1.1.1.1');

    expect(redis.keys()).toEqual([]);
    await expect(service.consume('login', 'ip-1.1.1.1')).resolves.toMatchObject({ current: 1 });
  });

  it('bez Redis-a → degraded: propušta zahtjev (drugi sloj je lockout u bazi)', async () => {
    const noRedis = new RateLimitService(fakeRedisService(redis, false));

    const result = await noRedis.consume('login', 'ip-1.1.1.1');

    expect(result).toMatchObject({ allowed: true, degraded: true, scope: 'login' });
  });

  it('THROTTLE_ENABLED=false isključuje limiter', async () => {
    process.env.THROTTLE_ENABLED = 'false';
    __resetEnvCache();
    const disabled = new RateLimitService(fakeRedisService(redis));

    expect(disabled.isEnabled).toBe(false);
    await expect(disabled.consume('login', 'ip-1.1.1.1')).resolves.toMatchObject({
      allowed: true,
      degraded: true,
    });
    expect(redis.keys()).toEqual([]);
  });

  it('Redis greška (NOPERM/timeout) se ne propagira', async () => {
    redis.failNext = true;

    await expect(service.consume('login', 'ip-1.1.1.1')).resolves.toMatchObject({
      allowed: true,
      degraded: true,
    });
  });
});

describe('sanitizeIdentity — ključ ne može biti podmetnut', () => {
  it('uklanja `:`, razmake i kontrolne znakove iz identiteta', () => {
    expect(sanitizeIdentity('198.51.100.7')).toBe('198.51.100.7');
    expect(sanitizeIdentity('ip:1.2.3.4')).toBe('ip-1.2.3.4');
    expect(sanitizeIdentity('global:login')).toBe('global-login');
    expect(sanitizeIdentity('  razmak  ')).toBe('razmak');
    expect(sanitizeIdentity('')).toBe('unknown');
    expect(sanitizeIdentity('a'.repeat(200))).toHaveLength(128);
  });

  it('klijent ne može konstruisati tuđi ključ preko X-Forwarded-For', () => {
    const request = fakeRequest({ headers: { 'x-forwarded-for': '1.1.1.1, login:2.2.2.2' } });
    delete (request as { ip?: string }).ip;

    expect(requestIdentity(request)).toBe('ip-1.1.1.1');
  });
});

describe('requestIdentity / resolvePolicy', () => {
  it('autentificiran korisnik → user-{id}, inače ip-{adresa}', () => {
    expect(requestIdentity(fakeRequest({ user: authenticatedUser({ id: USER_ADMIN }) }))).toBe(
      `user-${USER_ADMIN}`,
    );
    expect(requestIdentity(ipRequest('203.0.113.9'))).toBe('ip-203.0.113.9');
  });

  it('X-Forwarded-For prvi hop kad nema request.ip', () => {
    const request = fakeRequest({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } });
    delete (request as { ip?: string }).ip;

    expect(requestIdentity(request)).toBe('ip-203.0.113.5');
  });

  it('metadata može samo postrožiti limit (ENV je gornja granica)', () => {
    expect(resolvePolicy({ limit: 5, windowSeconds: 900 }, { scope: 'login', limit: 2 })).toEqual({
      limit: 2,
      windowSeconds: 900,
    });
    expect(resolvePolicy({ limit: 300, windowSeconds: 60 }, { scope: 'global', limit: 9999 })).toEqual({
      limit: 300,
      windowSeconds: 60,
    });
    expect(resolvePolicy({ limit: 30, windowSeconds: 60 }, { scope: 'upload' })).toEqual({
      limit: 30,
      windowSeconds: 60,
    });
  });
});

describe('RateLimitGuard', () => {
  it('bez metadata → global opseg po IP-u + X-RateLimit zaglavlja', async () => {
    const response = new FakeResponse();
    const { context } = contextFor('bezLimitera', ipRequest(), response);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.headers[RATE_LIMIT_HEADERS.limit]).toBe(300);
    expect(response.headers[RATE_LIMIT_HEADERS.remaining]).toBe(299);
    expect(redis.keys()).toEqual(['vfm:rl:global:ip-198.51.100.7']);
  });

  it('@RateLimit("login"): 5 prolazi, 6. → 429 RATE_LIMITED + Retry-After + SECURITY_EVENT', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { context } = contextFor('login', ipRequest());
      await expect(guard.canActivate(context), `pokušaj ${i + 1}`).resolves.toBe(true);
    }

    const response = new FakeResponse();
    const { context } = contextFor('login', ipRequest(), response);
    let error: unknown;
    try {
      await guard.canActivate(context);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VfmException);
    expect((error as VfmException).code).toBe('RATE_LIMITED');
    expect((error as VfmException).httpStatus).toBe(429);
    expect(response.headers[RATE_LIMIT_HEADERS.remaining]).toBe(0);
    expect(Number(response.headers[RATE_LIMIT_HEADERS.retryAfter])).toBeGreaterThan(0);
    expect(security.types).toContain('RATE_LIMITED');
  });

  it('@RateLimit("upload", { limit: 2 }) → stroži limit po ruti', async () => {
    await expect(guard.canActivate(contextFor('upload', ipRequest()).context)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('upload', ipRequest()).context)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('upload', ipRequest()).context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('@RateLimit("global", { limit: 9999 }) ne može povećati ENV limit', async () => {
    const response = new FakeResponse();
    const { context } = contextFor('pokusajPovecanja', ipRequest(), response);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.headers[RATE_LIMIT_HEADERS.limit]).toBe(300);
  });

  it('@SkipRateLimit (health) prolazi i ne broji zahtjeve', async () => {
    const { context } = contextFor('health', ipRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.keys()).toEqual([]);
  });

  it('autentificiran korisnik se limitira po user-{id}', async () => {
    const request = fakeRequest({ user: authenticatedUser({ id: USER_ADMIN }), ip: '203.0.113.9' });
    const { context } = contextFor('bezLimitera', request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.keys()).toEqual([`vfm:rl:global:user-${USER_ADMIN}`]);
  });

  it('degradiran Redis → guard propušta (bez 500/429)', async () => {
    const degraded = new RateLimitGuard(
      reflector,
      new RateLimitService(fakeRedisService(redis, false)),
      security,
    );
    const { context } = contextFor('login', ipRequest());

    await expect(degraded.canActivate(context)).resolves.toBe(true);
  });
});
