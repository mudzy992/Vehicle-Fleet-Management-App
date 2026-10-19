import { describe, expect, it } from 'vitest';
import { getEnv, getRawEnv, inspectEnv, __resetEnvCache } from '../../src/config/env.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { REDIS_NS } from '@vfm/shared';

/**
 * ENV validacija (fail-fast) i Redis key builder.
 *
 * `ENV_PROFILE=test` (postavljen u `vitest.config.ts`) → ništa nije obavezno,
 * pa se testira ponašanje bez stvarne infrastrukture.
 */

describe('config/env', () => {
  it('ENV_PROFILE=test prolazi bez obaveznih varijabli', () => {
    __resetEnvCache();
    const env = getEnv({ ENV_PROFILE: 'test' } as NodeJS.ProcessEnv);
    expect(env.ENV_PROFILE).toBe('test');
    expect(env.API_PORT).toBe(3000);
    __resetEnvCache();
  });

  it('getRawEnv ne baca ni kad profil nije kompletan', () => {
    const raw = getRawEnv({ ENV_PROFILE: 'api' } as NodeJS.ProcessEnv);
    expect(raw.ENV_PROFILE).toBe('api');
    expect(raw.DATABASE_URL).toBeUndefined();
  });

  it('inspectEnv vraća listu grešaka umjesto bacanja (za alate)', () => {
    const { env, errors, profile } = inspectEnv({ ENV_PROFILE: 'tool' } as NodeJS.ProcessEnv);
    expect(profile).toBe('tool');
    expect(env.APP_NAME).toBe('Vozni park');
    expect(errors.some((error) => error.includes('DATABASE_URL'))).toBe(true);
  });

  it('getEnv baca agregiranu grešku za nepotpun api profil', () => {
    expect(() => getEnv({ ENV_PROFILE: 'api' } as NodeJS.ProcessEnv)).toThrow(
      /Konfiguracija nije kompletna/u,
    );
  });

  it('default putanje pohrane: host == container path (/data/vfm)', () => {
    const env = getRawEnv({ ENV_PROFILE: 'test' } as NodeJS.ProcessEnv);
    expect(env.VFM_STORAGE_CONTAINER_PATH).toBe('/data/vfm/attachments');
    expect(env.VFM_STORAGE_PATH).toBe('/data/vfm/attachments');
    expect(env.ATTACHMENT_TEMP_PATH).toBe('/data/vfm/tmp');
    expect(env.REPORT_EXPORT_PATH).toBe('/data/vfm/attachments/exports');
  });

  it('default mreže: db_net (Postgres) i redis_net (Redis)', () => {
    const env = getRawEnv({ ENV_PROFILE: 'test' } as NodeJS.ProcessEnv);
    expect(env.DB_NETWORK).toBe('db_net');
    expect(env.REDIS_NETWORK).toBe('redis_net');
  });

  it('default ACL korisnici su vfm-api / vfm-worker / vfm-readonly', () => {
    const env = getRawEnv({ ENV_PROFILE: 'test' } as NodeJS.ProcessEnv);
    expect(env.REDIS_USER_API).toBe('vfm-api');
    expect(env.REDIS_USER_WORKER).toBe('vfm-worker');
    expect(env.REDIS_USER_READONLY).toBe('vfm-readonly');
  });
});

describe('RedisService.key — svi ključevi unutar ACL opsega ~vfm:*', () => {
  it('gradi ključeve s tačnim namespace-om', () => {
    const redis = new RedisService();
    const userId = 'u-123';

    expect(redis.key('permissions', userId)).toBe(`${REDIS_NS.permissions}:${userId}`);
    expect(redis.key('session', 'jti-1')).toBe('vfm:session:jti-1');
    expect(redis.key('lock', 'migrate')).toBe('vfm:lock:migrate');
    expect(redis.key('idempotency', 'u-1', 'key-1')).toBe('vfm:idem:u-1:key-1');
    expect(redis.key('queue', 'outbox')).toBe('vfm:queue:outbox');
  });

  it('svaki izgrađeni ključ počinje s "vfm:" (ACL ~vfm:*)', () => {
    const redis = new RedisService();
    for (const namespace of Object.keys(REDIS_NS) as (keyof typeof REDIS_NS)[]) {
      const key = redis.key(namespace, 'test');
      expect(key.startsWith('vfm:'), `${namespace} → ${key}`).toBe(true);
    }
  });

  it('key() bez dijelova vraća sam namespace', () => {
    const redis = new RedisService();
    expect(redis.key('rateLimit')).toBe('vfm:rl');
    expect(redis.key('cache')).toBe('vfm:cache');
  });

  it('cacheTtlSeconds dodaje jitter unutar granica', () => {
    const redis = new RedisService();
    for (let index = 0; index < 20; index += 1) {
      const ttl = redis.cacheTtlSeconds(300, 10);
      expect(ttl).toBeGreaterThanOrEqual(300);
      expect(ttl).toBeLessThanOrEqual(330);
    }
    expect(redis.cacheTtlSeconds(0)).toBeGreaterThanOrEqual(1);
  });

  it('REDIS_ENABLED=false → isEnabled false i nema konekcije', () => {
    const redis = new RedisService();
    // U test ENV-u je REDIS_ENABLED=false (vitest.config.ts)
    expect(redis.isEnabled).toBe(false);
    expect(redis.isAvailable()).toBe(false);
    expect(redis.getConnection('api')).toBeUndefined();
    expect(redis.getInfo()).toEqual([]);
  });

  it('ping() bez Redis-a vraća ok=false s jasnom porukom', async () => {
    const redis = new RedisService();
    const result = await redis.ping();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/REDIS_HOST nije postavljen/u);
  });
});
