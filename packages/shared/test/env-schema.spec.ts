import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  baseEnvSchema,
  buildDatabaseUrl,
  envProfileSchema,
  isProduction,
  loadEnv,
  maxFileSizeBytes,
  paginationQuerySchema,
  normalizeRedisKeyPrefix,
  parseEnv,
  plateSchema,
  queueKeyPrefix,
  queueNames,
  redisConfig,
  trustProxyHops,
  validateEnvProfile,
  validateRedisAclScope,
} from '../dist/env-schema.js';
import {
  DEFAULT_COOKIE_DOMAIN,
  DEFAULT_PUBLIC_API_URL,
  DEFAULT_WEB_ORIGIN,
  QUEUE_KEY_PREFIX,
  REDIS_ACL_USERS,
  bullQueueKey,
  isInsideRedisAclScope,
} from '../dist/index.js';

/**
 * ENV šema je **ugovor s `.env.example`** (vlasnik deploya na Coolify).
 * Ako ovi testovi padnu, deploy može pasti u produkciji → ne commitovati.
 */

/** Minimalan ispravan ENV za profil `api` (produkcija). */
const VALID_API_ENV = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  ENV_PROFILE: 'api',
  DATABASE_URL: 'postgresql://vfm:s3cret@vfm-postgres-global:5432/vfm?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  REDIS_HOST: 'redis-global',
  REDIS_PASSWORD_API: 'api-pass',
  REDIS_PASSWORD_WORKER: 'worker-pass',
  FILE_SIGNING_SECRET: 'c'.repeat(48),
  COOKIE_SECURE: 'true',
  SWAGGER_ENABLED: 'false',
} as const;

describe('sinhronizacija s .env.example', () => {
  const envExamplePath = resolve(__dirname, '../../../.env.example');
  const exampleKeys = readFileSync(envExamplePath, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf('=')));

  const schemaKeys = Object.keys(baseEnvSchema.shape);

  it('.env.example je parsiran (očekuje se 170+ varijabli)', () => {
    expect(exampleKeys.length).toBeGreaterThan(170);
  });

  it('svaka varijabla iz .env.example postoji u šemi', () => {
    const missing = exampleKeys.filter((key) => !schemaKeys.includes(key));
    expect(missing, `Nedostaju u env-schema.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('nema varijabli u šemi kojih nema u .env.example', () => {
    const extra = schemaKeys.filter((key) => !exampleKeys.includes(key));
    expect(extra, `Nisu dokumentovane u .env.example: ${extra.join(', ')}`).toEqual([]);
  });
});

describe('envProfileSchema', () => {
  it('default je "api"', () => {
    expect(envProfileSchema.parse(undefined)).toBe('api');
    expect(envProfileSchema.parse('tool')).toBe('tool');
    expect(envProfileSchema.parse('test')).toBe('test');
  });

  it('odbacuje nepoznat profil', () => {
    expect(envProfileSchema.safeParse('worker').success).toBe(false);
  });
});

describe('parseEnv — defaulti i normalizacija', () => {
  it('prazan ENV dobija sigurne defaulte', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.API_HOST).toBe('0.0.0.0');
    expect(env.APP_PREFIX).toBe('vfm');
    expect(env.APP_TIMEZONE).toBe('Europe/Sarajevo');
    expect(env.COOKIE_NAME).toBe('vfm_refresh');
    expect(env.REDIS_USER_API).toBe(REDIS_ACL_USERS.api);
    expect(env.REDIS_USER_WORKER).toBe(REDIS_ACL_USERS.worker);
    expect(env.QUEUE_OUTBOX).toBe('vfm-queue-outbox');
    expect(env.VFM_REDIS_KEY_PREFIX).toBe('vfm:');
  });

  it('R-03: defaultne domene su vehicle.ba101.top / api.vehicle.ba101.top', () => {
    expect(DEFAULT_WEB_ORIGIN).toBe('https://vehicle.ba101.top');
    expect(DEFAULT_PUBLIC_API_URL).toBe('https://api.vehicle.ba101.top/api/v1');
    expect(DEFAULT_COOKIE_DOMAIN).toBe('.ba101.top');

    const env = parseEnv({});
    expect(env.CORS_ORIGINS).toEqual(['https://vehicle.ba101.top']);
    expect(env.PUBLIC_API_URL).toBe('https://api.vehicle.ba101.top/api/v1');
    expect(env.COOKIE_DOMAIN).toBe('.ba101.top');
  });

  it('prazan string se tretira kao "nije postavljeno"', () => {
    const env = parseEnv({
      DATABASE_URL: '',
      REDIS_HOST: '',
      REDIS_PASSWORD_API: '',
      FIREBASE_PROJECT_ID: '',
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REDIS_HOST).toBeUndefined();
    expect(env.REDIS_PASSWORD_API).toBeUndefined();
    expect(env.FIREBASE_PROJECT_ID).toBeUndefined();
  });

  it('CORS_ORIGINS se parsira iz stringa s razmacima i prazninama', () => {
    const env = parseEnv({
      CORS_ORIGINS: 'https://vehicle.ba101.top, http://localhost:5173 ,, https://preview.ba101.top',
    });
    expect(env.CORS_ORIGINS).toEqual([
      'https://vehicle.ba101.top',
      'http://localhost:5173',
      'https://preview.ba101.top',
    ]);
  });

  it('MIGRATIONS_BASELINE / MIGRATIONS_ROLLED_BACK: prazno = [] (normalan rad)', () => {
    // Coolify šalje prazan string kada varijabla postoji ali nije popunjena —
    // tad se historija migracija NE dira (migrate ide kroz običan `migrate deploy`).
    expect(parseEnv({}).MIGRATIONS_BASELINE).toEqual([]);
    expect(parseEnv({ MIGRATIONS_BASELINE: '' }).MIGRATIONS_BASELINE).toEqual([]);
    expect(parseEnv({ MIGRATIONS_ROLLED_BACK: '' }).MIGRATIONS_ROLLED_BACK).toEqual([]);
  });

  it('MIGRATIONS_BASELINE se parsira kao lista naziva migracija (oporavak od P3005)', () => {
    const env = parseEnv({ MIGRATIONS_BASELINE: '0_extensions, 1_init ,, 2_manual' });
    expect(env.MIGRATIONS_BASELINE).toEqual(['0_extensions', '1_init', '2_manual']);
    expect(parseEnv({ MIGRATIONS_ROLLED_BACK: '1_init' }).MIGRATIONS_ROLLED_BACK).toEqual(['1_init']);
  });

  it('boolean-like vrijednosti (Coolify često šalje string)', () => {
    expect(parseEnv({ COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ COOKIE_SECURE: '1' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ COOKIE_SECURE: 'yes' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(parseEnv({ COOKIE_SECURE: '' }).COOKIE_SECURE).toBe(true); // default true
    expect(parseEnv({ FIREBASE_ENABLED: 'on' }).FIREBASE_ENABLED).toBe(true);
    expect(parseEnv({}).FIREBASE_ENABLED).toBe(false);
    expect(parseEnv({}).WORKER_ENABLED).toBe(true);
  });

  it('numeričke varijable se koerciraju iz stringa (ENV je uvijek string)', () => {
    const env = parseEnv({
      API_PORT: '8080',
      THROTTLE_GLOBAL_LIMIT: '60',
      ATTACHMENT_MAX_SIZE_MB: '20',
      QUEUE_MAX_ATTEMPTS: '7',
    });
    expect(env.API_PORT).toBe(8080);
    expect(env.THROTTLE_GLOBAL_LIMIT).toBe(60);
    expect(env.ATTACHMENT_MAX_SIZE_MB).toBe(20);
    expect(env.QUEUE_MAX_ATTEMPTS).toBe(7);
  });

  it('trajanja ostaju stringovi u formatu koji očekuje jsonwebtoken', () => {
    const env = parseEnv({ JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d' });
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('7d');
  });

  it('odbacuje neispravne vrijednosti s čitljivom porukom', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/u);
    expect(() => parseEnv({ API_PORT: '70000' })).toThrow(/API_PORT/u);
    expect(() => parseEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/u);
    expect(() => parseEnv({ JWT_ACCESS_TTL: 'deset minuta' })).toThrow(/JWT_ACCESS_TTL/u);
    expect(() => parseEnv({ TRUST_PROXY: 'maybe' })).toThrow(/TRUST_PROXY/u);
  });

  it('Coolify-ove nepoznate varijable ne smetaju', () => {
    const env = parseEnv({
      COOLIFY_FQDN: 'vehicle.ba101.top',
      SOURCE_COMMIT: 'abc123',
      APP_NAME: 'Vozni park',
    });
    expect(env.APP_NAME).toBe('Vozni park');
  });
});

describe('validateEnvProfile — profilne obaveze', () => {
  it('test profil ne zahtijeva ništa', () => {
    expect(validateEnvProfile(parseEnv({ ENV_PROFILE: 'test' }), 'test')).toEqual([]);
  });

  it('api profil traži JWT tajne (min 32), DATABASE_URL i REDIS_HOST', () => {
    const errors = validateEnvProfile(parseEnv({ ENV_PROFILE: 'api' }), 'api');
    expect(errors.join('\n')).toMatch(/DATABASE_URL/u);
    expect(errors.join('\n')).toMatch(/JWT_ACCESS_SECRET/u);
    expect(errors.join('\n')).toMatch(/JWT_REFRESH_SECRET/u);
    expect(errors.join('\n')).toMatch(/REDIS_HOST/u);
  });

  it('kratke JWT tajne se odbijaju', () => {
    const errors = validateEnvProfile(
      parseEnv({ ...VALID_API_ENV, JWT_ACCESS_SECRET: 'kratko', JWT_REFRESH_SECRET: 'b'.repeat(48) }),
      'api',
    );
    expect(errors.join('\n')).toMatch(/JWT_ACCESS_SECRET je obavezan i mora imati barem 32 znaka/u);
  });

  it('iste access i refresh tajne se odbijaju', () => {
    const same = 'a'.repeat(48);
    const errors = validateEnvProfile(
      parseEnv({ ...VALID_API_ENV, JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
      'api',
    );
    expect(errors.join('\n')).toMatch(/moraju biti različiti/u);
  });

  it('potpuna produkcijska konfiguracija prolazi bez grešaka', () => {
    expect(validateEnvProfile(parseEnv({ ...VALID_API_ENV }), 'api')).toEqual([]);
  });

  it('bootstrap u profilu tool traži lozinku (varijanta A, migrate kontejner)', () => {
    const bezLozinke = validateEnvProfile(
      parseEnv({
        ENV_PROFILE: 'tool',
        DATABASE_URL: 'postgresql://x/y',
        BOOTSTRAP_SUPER_ADMIN_ENABLED: 'true',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@firma.ba',
      }),
      'tool',
    );
    expect(bezLozinke.join('\n')).toMatch(/BOOTSTRAP_SUPER_ADMIN_PASSWORD je obavezan/u);

    const kratka = validateEnvProfile(
      parseEnv({
        ENV_PROFILE: 'tool',
        DATABASE_URL: 'postgresql://x/y',
        BOOTSTRAP_SUPER_ADMIN_ENABLED: 'true',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@firma.ba',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'kratka1234',
      }),
      'tool',
    );
    expect(kratka.join('\n')).toMatch(/barem 12 znakova/u);

    expect(
      validateEnvProfile(
        parseEnv({
          ENV_PROFILE: 'tool',
          DATABASE_URL: 'postgresql://x/y',
          BOOTSTRAP_SUPER_ADMIN_ENABLED: 'true',
          BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@firma.ba',
          BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'Bootstrap!Vfm2026',
        }),
        'tool',
      ),
    ).toEqual([]);

    // Isključen bootstrap → lozinka nije obavezna (nema regresije za deploy).
    expect(
      validateEnvProfile(parseEnv({ ENV_PROFILE: 'tool', DATABASE_URL: 'postgresql://x/y' }), 'tool'),
    ).toEqual([]);
  });

  it('tool profil traži samo DATABASE_URL', () => {
    const errors = validateEnvProfile(parseEnv({ ENV_PROFILE: 'tool' }), 'tool');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/DATABASE_URL/u);

    expect(
      validateEnvProfile(parseEnv({ ENV_PROFILE: 'tool', DATABASE_URL: 'postgresql://x/y' }), 'tool'),
    ).toEqual([]);
  });

  it('produkcija traži Redis lozinke za api i worker ACL korisnike', () => {
    const errors = validateEnvProfile(
      parseEnv({
        ...VALID_API_ENV,
        REDIS_PASSWORD_API: '',
        REDIS_PASSWORD_WORKER: '',
      }),
      'api',
    );
    expect(errors.join('\n')).toMatch(/REDIS_PASSWORD_API/u);
    expect(errors.join('\n')).toMatch(/REDIS_PASSWORD_WORKER/u);
  });

  it('produkcija traži COOKIE_SECURE, FILE_SIGNING_SECRET i SWAGGER isključen', () => {
    const errors = validateEnvProfile(
      parseEnv({
        ...VALID_API_ENV,
        COOKIE_SECURE: 'false',
        FILE_SIGNING_SECRET: '',
        SWAGGER_ENABLED: 'true',
      }),
      'api',
    );
    expect(errors.join('\n')).toMatch(/COOKIE_SECURE/u);
    expect(errors.join('\n')).toMatch(/FILE_SIGNING_SECRET/u);
    expect(errors.join('\n')).toMatch(/SWAGGER_ENABLED/u);
  });

  it('FIREBASE_ENABLED=true traži projekat i putanju service account-a (R-04)', () => {
    const errors = validateEnvProfile(parseEnv({ ...VALID_API_ENV, FIREBASE_ENABLED: 'true' }), 'api');
    expect(errors.join('\n')).toMatch(/FIREBASE_PROJECT_ID/u);
    expect(errors.join('\n')).toMatch(/FIREBASE_SERVICE_ACCOUNT_PATH/u);
  });

  it('loadEnv baca agregiranu grešku kad profil nije kompletan', () => {
    expect(() => loadEnv({ ENV_PROFILE: 'api' })).toThrow(/Konfiguracija nije kompletna/u);
    expect(() => loadEnv({ ENV_PROFILE: 'test' })).not.toThrow();
    expect(() => loadEnv({ ...VALID_API_ENV })).not.toThrow();
  });
});

describe('izvedene vrijednosti', () => {
  it('redisConfig koristi različitog ACL korisnika po ulozi (least privilege)', () => {
    const env = parseEnv({
      REDIS_HOST: 'redis-global',
      REDIS_PASSWORD_API: 'api-pass',
      REDIS_PASSWORD_WORKER: 'worker-pass',
      REDIS_PASSWORD_READONLY: 'ro-pass',
    });

    const api = redisConfig(env, 'api');
    expect(api.username).toBe('vfm-api');
    expect(api.password).toBe('api-pass');
    expect(api.host).toBe('redis-global');

    expect(redisConfig(env, 'worker').username).toBe('vfm-worker');
    expect(redisConfig(env, 'readonly').username).toBe('vfm-readonly');
    expect(new Set([api.username, redisConfig(env, 'worker').username]).size).toBe(2);
  });

  it('trustProxyHops mapira TRUST_PROXY iz ENV-a', () => {
    expect(trustProxyHops(parseEnv({ TRUST_PROXY: 'loopback' }))).toBe(1);
    expect(trustProxyHops(parseEnv({ TRUST_PROXY: 'all' }))).toBe(true);
    expect(trustProxyHops(parseEnv({ TRUST_PROXY: 'false' }))).toBe(false);
  });

  it('queueNames vraća imena redova s prefixom vfm', () => {
    const names = queueNames(parseEnv({}));
    expect(names.outbox).toBe('vfm-queue-outbox');
    expect(names.notifications).toBe('vfm-queue-notifications');
    expect(names.reminders).toBe('vfm-queue-reminders');
    expect(names.reports).toBe('vfm-queue-reports');
    expect(names.maintenance).toBe('vfm-queue-maintenance');
  });

  it('isProduction prepoznaje production u APP_ENV ili NODE_ENV', () => {
    expect(isProduction(parseEnv({ APP_ENV: 'production' }))).toBe(true);
    expect(isProduction(parseEnv({ NODE_ENV: 'production' }))).toBe(true);
    expect(isProduction(parseEnv({ APP_ENV: 'local', NODE_ENV: 'development' }))).toBe(false);
  });

  it('maxFileSizeBytes poštuje ATTACHMENT_MAX_SIZE_MB', () => {
    expect(maxFileSizeBytes(parseEnv({ ATTACHMENT_MAX_SIZE_MB: '10' }))).toBe(10 * 1024 * 1024);
    expect(maxFileSizeBytes(parseEnv({ ATTACHMENT_MAX_SIZE_MB: '20' }))).toBe(20 * 1024 * 1024);
  });

  it('buildDatabaseUrl sastavlja URL iz dijelova kad DATABASE_URL nije zadan', () => {
    const env = parseEnv({
      DATABASE_HOST: 'postgres-global',
      DATABASE_PASSWORD: 'tajna',
      DATABASE_NAME: 'vfm',
      DATABASE_USER: 'vfm',
      DATABASE_CONNECTION_LIMIT: '10',
    });
    const url = buildDatabaseUrl(env);
    expect(url).toContain('postgresql://vfm:tajna@postgres-global:5432/vfm');
    expect(url).toContain('connection_limit=10');

    // Ako je DATABASE_URL zadan, koristi se on (compose ga postavlja).
    const withUrl = parseEnv({ DATABASE_URL: 'postgresql://a:b@c:5432/d?schema=public' });
    expect(buildDatabaseUrl(withUrl)).toBe('postgresql://a:b@c:5432/d?schema=public');
  });
});

describe('zajedničke šeme za API ugovor', () => {
  it('paginationQuerySchema ima sigurne defaulte i limit', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed).toMatchObject({ page: 1, pageSize: 25, sortOrder: 'asc' });
    expect(() => paginationQuerySchema.parse({ pageSize: 500 })).toThrow();
  });

  it('plateSchema prihvata BIH formate i odbija smeće', () => {
    expect(plateSchema.parse('T12-E-456')).toBe('T12-E-456');
    expect(plateSchema.parse(' A12-B-34 ')).toBe('A12-B-34');
    expect(() => plateSchema.parse('XX')).toThrow();
    expect(() => plateSchema.parse('<script>')).toThrow();
  });
});

/**
 * BullMQ prefiks i ACL opseg (`REDIS_ACL.md` §1 i §4).
 *
 * Regresija iz produkcije (Coolify, 19.10.2026.): worker je logovao
 * `NOPERM No permissions to access a key` za korisnika `vfm-worker` jer je BullMQ
 * bio pokrenut s default prefiksom `'bull'` → ključevi `bull:vfm-queue-*` su bili
 * izvan ACL opsega `~vfm:*`. Ovi testovi čuvaju ispravku.
 */
describe('queueKeyPrefix / validateRedisAclScope', () => {
  it('normalizeRedisKeyPrefix vraća root s dvotačkom (default vfm:)', () => {
    expect(normalizeRedisKeyPrefix(undefined)).toBe('vfm:');
    expect(normalizeRedisKeyPrefix('')).toBe('vfm:');
    expect(normalizeRedisKeyPrefix('  ')).toBe('vfm:');
    expect(normalizeRedisKeyPrefix('vfm:')).toBe('vfm:');
    expect(normalizeRedisKeyPrefix('vfm')).toBe('vfm:');
  });

  it('default BullMQ prefiks je "vfm:queue" (nikad "bull")', () => {
    const env = parseEnv({});
    expect(queueKeyPrefix(env)).toBe('vfm:queue');
    expect(queueKeyPrefix(env)).toBe(QUEUE_KEY_PREFIX);
    expect(queueKeyPrefix(env)).not.toBe('bull');
  });

  it('prefiks prati VFM_REDIS_KEY_PREFIX iz ENV-a', () => {
    expect(queueKeyPrefix(parseEnv({ VFM_REDIS_KEY_PREFIX: 'vfm:' }))).toBe('vfm:queue');
    expect(queueKeyPrefix(parseEnv({ VFM_REDIS_KEY_PREFIX: 'vfm' }))).toBe('vfm:queue');
    expect(queueKeyPrefix(parseEnv({ VFM_REDIS_KEY_PREFIX: 'tudji:' }))).toBe('tudji:queue');
  });

  it('ključevi redova su unutar ACL opsega ~vfm:*', () => {
    const env = parseEnv({});
    const prefix = queueKeyPrefix(env);
    for (const name of Object.keys(queueNames(env)) as (keyof ReturnType<typeof queueNames>)[]) {
      const key = bullQueueKey(prefix, queueNames(env)[name]);
      expect(isInsideRedisAclScope(key), key).toBe(true);
      expect(key.startsWith('vfm:queue:vfm-queue-'), key).toBe(true);
    }
  });

  it('prazan naziv reda se odbija već u šemi (fail-fast)', () => {
    expect(() => parseEnv({ QUEUE_OUTBOX: '' })).toThrow(/QUEUE_OUTBOX/u);
  });

  it('queueNames fallback daje nazive "vfm-queue-*" (defenzivno, bez ENV-a)', () => {
    // Šema nikad ne vrati prazan naziv, ali helper mora biti otporan i na
    // djelimičan ENV (npr. pozvan prije validacije) — zato fallback postoji.
    const partial = { QUEUE_OUTBOX: '' } as unknown as ReturnType<typeof parseEnv>;
    expect(queueNames(partial)).toMatchObject({ outbox: 'vfm-queue-outbox' });
    expect(queueNames(parseEnv({}))).toEqual({
      outbox: 'vfm-queue-outbox',
      notifications: 'vfm-queue-notifications',
      reminders: 'vfm-queue-reminders',
      reports: 'vfm-queue-reports',
      maintenance: 'vfm-queue-maintenance',
    });
  });

  it('validateRedisAclScope je prazan za ispravnu konfiguraciju', () => {
    expect(validateRedisAclScope(parseEnv({}))).toEqual([]);
    expect(validateRedisAclScope(parseEnv({ VFM_REDIS_KEY_PREFIX: 'vfm' }))).toEqual([]);
    expect(validateRedisAclScope(parseEnv({ QUEUE_OUTBOX: 'vfm-queue-outbox-v2' }))).toEqual([]);
  });

  it('validateRedisAclScope prijavljuje prefiks izvan ~vfm:* (uzrok NOPERM-a)', () => {
    const problems = validateRedisAclScope(parseEnv({ VFM_REDIS_KEY_PREFIX: 'tudji:' }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(/tudji:queue/u);
    expect(problems.join('\n')).toMatch(/~vfm:\*/u);
    expect(problems.join('\n')).toMatch(/REDIS_ACL\.md/u);
  });
});
