/**
 * VFM — validacija okruženja (jedini izvor istine, sinhronizovano s `.env.example`).
 *
 * Pravila:
 * 1. **Svaka varijabla iz `.env.example` mora biti ovdje** — inače deploy na
 *    Coolify može proći s neispravnom konfiguracijom. Test
 *    `env-schema.spec.ts` poredi ključeve šeme s `.env.example`.
 * 2. Varijable koje API ne koristi (Vite, Expo, Coolify magic, build) su ipak
 *    deklarisane — da `parseEnv` ne odbaci `.env` koji sadrži i njih.
 * 3. `ENV_PROFILE` određuje šta je **obavezno**:
 *    - `api`  → DATABASE_URL + JWT tajne + Redis kredencijali,
 *    - `tool` → DATABASE_URL (migrate/seed/backup),
 *    - `test` → ništa.
 * 4. Greška je **agregirana i čitljiva** — Coolify log odmah pokazuje šta fali.
 *
 * Ovaj modul je **server-only** i izvozi se kao `@vfm/shared/env` (ne u root
 * izvozu), da `zod` ne završi u browser bundle-u.
 */
import { z } from 'zod';
import {
  API_PREFIX,
  CURRENCY,
  DB_NETWORK,
  DEFAULT_API_ORIGIN,
  DEFAULT_PUBLIC_API_URL,
  DEFAULT_WEB_ORIGIN,
  MAX_FILE_SIZE_BYTES,
  QUEUE_KEY_PREFIX,
  QUEUE_NAMES,
  REDIS_ACL_KEY_PATTERN,
  REDIS_ACL_USERS,
  REDIS_KEY_PREFIX,
  REDIS_NETWORK,
  REDIS_NS,
  REFRESH_COOKIE_NAME,
  REPORT_EXPORT_PATH_DEFAULT,
  STORAGE_PATH_DEFAULT,
  STORAGE_TMP_PATH_DEFAULT,
  TIMEZONE,
  bullQueueKey,
  isInsideRedisAclScope,
  queueName,
} from './constants.js';
import type { QueueName } from './constants.js';

// -----------------------------------------------------------------------------
//  Pomoćne šeme
// -----------------------------------------------------------------------------

/** Prazan string se tretira kao "nije postavljeno" (Coolify često šalje ""). */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value));

/** URL ili prazno → `undefined`. */
const optionalUrl = z
  .union([z.url(), z.literal('')])
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

/** Boolean-like: `.env` i Coolify šalju stringove (`true`, `1`, `yes`, `on`). */
function toBoolean(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => toBoolean(value, fallback));

/**
 * Cijeli broj iz ENV stringa, s defaultom za prazno/odsutno.
 * `constraints` prima Zod broj i vraća ga (npr. `.min(1).max(65535)`).
 */
const integer = (fallback: number, constraints?: (schema: z.ZodNumber) => z.ZodNumber) => {
  // `z.coerce.number().int()` vraća ZodCoercedNumber; tretiramo ga kao ZodNumber
  // da bi `constraints` mogao koristiti `.min()/.max()` bez generičkih šuma.
  const base = z.coerce.number().int() as unknown as z.ZodNumber;
  const shaped = constraints ? constraints(base) : base;
  // `.optional()` na uniji je neophodan: bez njega Zod 4 tretira odsutan ključ
  // kao grešku ("expected nonoptional") umjesto da primijeni `fallback`.
  return z
    .union([shaped, z.literal('')])
    .optional()
    .transform((value) => (value === '' || value === undefined ? fallback : (value as number)));
};

const port = (fallback: number) =>
  integer(fallback, (schema) => schema.min(1).max(65535));

/** Zarezom odvojena lista → niz (prazno == `[]`). */
const csv = (fallback: readonly string[] = []) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return [...fallback];
      const raw = Array.isArray(value) ? value : value.split(',');
      return raw.map((entry) => entry.trim()).filter(Boolean);
    });

/** Fiksni niz (npr. formati izvoza) → normalizovan na mala slova. */
const csvLower = (fallback: readonly string[] = []) =>
  csv(fallback).transform((values) => values.map((value) => value.toLowerCase()));

/** Trajanje u stilu `10m`, `30d`, `900s` (zadržava se kao string za `jsonwebtoken`). */
const duration = (fallback: string) =>
  z
    .string()
    .regex(/^\d+\s*[smhdw]$/u, 'Format trajanja: npr. 900s, 10m, 24h, 30d')
    .default(fallback);

const ratio = (fallback: number) =>
  z.coerce
    .number()
    .min(0)
    .max(100)
    .default(fallback);

// -----------------------------------------------------------------------------
//  Profil
// -----------------------------------------------------------------------------

/** Profil runtime-a: određuje koje varijable su obavezne. */
export const ENV_PROFILES = ['api', 'tool', 'test'] as const;
export type EnvProfile = (typeof ENV_PROFILES)[number];

export const envProfileSchema = z.enum(ENV_PROFILES).default('api');

// -----------------------------------------------------------------------------
//  Osnovna šema — 1:1 s .env.example (sekcije 1–19)
// -----------------------------------------------------------------------------

export const baseEnvSchema = z.object({
  // 1) Opće / aplikacija ------------------------------------------------------
  APP_ENV: z.enum(['local', 'dev', 'staging', 'production']).default('local'),
  APP_NAME: z.string().min(1).default('Vozni park'),
  APP_VERSION: z.string().min(1).default('1.0.0'),
  APP_PREFIX: z.string().min(1).default('vfm'),
  APP_TIMEZONE: z.string().min(1).default(TIMEZONE),
  APP_LOCALE: z.string().min(2).default('bs'),
  APP_DEFAULT_CURRENCY: z.string().length(3).default(CURRENCY),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ENV_PROFILE: envProfileSchema,

  // 2) API server -------------------------------------------------------------
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: port(3000),
  PUBLIC_API_URL: optionalUrl.transform((value) => value ?? DEFAULT_PUBLIC_API_URL),
  API_PREFIX: z.string().min(1).default(API_PREFIX),
  SWAGGER_ENABLED: bool(false),
  SWAGGER_PATH: z.string().min(1).default('/api/v1/docs'),
  HEALTH_PATH: z.string().min(1).default('/health'),
  BODY_LIMIT_JSON: z.string().min(2).default('1mb'),
  BODY_LIMIT_MULTIPART: z.string().min(2).default('25mb'),
  API_REPLICAS: integer(1, (schema) => schema.min(1)),
  SHUTDOWN_TIMEOUT_MS: integer(15_000, (schema) => schema.min(1000)),

  // 3) CORS / sigurnost zahtjeva ---------------------------------------------
  CORS_ORIGINS: csv([DEFAULT_WEB_ORIGIN]),
  CORS_METHODS: csv(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  CORS_CREDENTIALS: bool(true),
  /** `loopback` (default) | `all` — koliko hopova proxy headera vjerujemo. */
  TRUST_PROXY: z.enum(['loopback', 'all', 'false', 'true', '1', '0']).default('loopback'),
  API_CSP_ENABLED: bool(true),

  // 4) Rate limiting ----------------------------------------------------------
  THROTTLE_ENABLED: bool(true),
  THROTTLE_GLOBAL_TTL_SECONDS: integer(60, (schema) => schema.min(1)),
  THROTTLE_GLOBAL_LIMIT: integer(300, (schema) => schema.min(1)),
  THROTTLE_LOGIN_TTL_SECONDS: integer(900, (schema) => schema.min(1)),
  THROTTLE_LOGIN_LIMIT: integer(5, (schema) => schema.min(1)),
  THROTTLE_UPLOAD_TTL_SECONDS: integer(60, (schema) => schema.min(1)),
  THROTTLE_UPLOAD_LIMIT: integer(30, (schema) => schema.min(1)),
  AUTH_MAX_FAILED_ATTEMPTS: integer(5, (schema) => schema.min(1)),
  AUTH_LOCKOUT_MINUTES: integer(15, (schema) => schema.min(1)),

  // 5) PostgreSQL (globalna baza na db_net — external) ------------------------
  DATABASE_HOST: optionalString,
  DATABASE_PORT: port(5432),
  DATABASE_NAME: z.string().min(1).default('vfm'),
  DATABASE_USER: z.string().min(1).default('vfm'),
  DATABASE_PASSWORD: optionalString,
  DATABASE_SSL: bool(false),
  DATABASE_URL: optionalString,
  DATABASE_CONNECTION_LIMIT: integer(10, (schema) => schema.min(1)),
  DATABASE_POOL_TIMEOUT: integer(20, (schema) => schema.min(1)),
  DB_NETWORK: z.string().min(1).default(DB_NETWORK),
  DATABASE_CREATE_EXTENSIONS: bool(false),

  // 6) Redis (globalni Redis na redis_net — external, ACL po ulozi) ----------
  REDIS_HOST: optionalString,
  REDIS_PORT: port(6379),
  REDIS_TLS: bool(false),
  REDIS_USER_API: z.string().min(1).default(REDIS_ACL_USERS.api),
  REDIS_PASSWORD_API: optionalString,
  REDIS_USER_WORKER: z.string().min(1).default(REDIS_ACL_USERS.worker),
  REDIS_PASSWORD_WORKER: optionalString,
  REDIS_USER_READONLY: z.string().min(1).default(REDIS_ACL_USERS.readonly),
  REDIS_PASSWORD_READONLY: optionalString,
  REDIS_DB: integer(0, (schema) => schema.min(0)),
  REDIS_NETWORK: z.string().min(1).default(REDIS_NETWORK),
  VFM_REDIS_KEY_PREFIX: z.string().min(1).default('vfm:'),

  // 7) BullMQ / worker --------------------------------------------------------
  WORKER_ENABLED: bool(true),
  WORKER_CONCURRENCY_OUTBOX: integer(5, (schema) => schema.min(1)),
  WORKER_CONCURRENCY_NOTIFICATIONS: integer(10, (schema) => schema.min(1)),
  WORKER_CONCURRENCY_REMINDERS: integer(2, (schema) => schema.min(1)),
  WORKER_CONCURRENCY_REPORTS: integer(2, (schema) => schema.min(1)),
  QUEUE_OUTBOX: z.string().min(1).default('vfm-queue-outbox'),
  QUEUE_NOTIFICATIONS: z.string().min(1).default('vfm-queue-notifications'),
  QUEUE_REMINDERS: z.string().min(1).default('vfm-queue-reminders'),
  QUEUE_REPORTS: z.string().min(1).default('vfm-queue-reports'),
  QUEUE_MAINTENANCE: z.string().min(1).default('vfm-queue-maintenance'),
  QUEUE_MAX_ATTEMPTS: integer(5, (schema) => schema.min(1)),
  QUEUE_BACKOFF_TYPE: z.enum(['exponential', 'fixed']).default('exponential'),
  QUEUE_BACKOFF_DELAY_MS: integer(5_000, (schema) => schema.min(100)),
  QUEUE_REMOVE_ON_COMPLETE_MS: integer(86_400_000, (schema) => schema.min(0)),
  QUEUE_REMOVE_ON_FAIL_MS: integer(604_800_000, (schema) => schema.min(0)),
  OUTBOX_POLL_INTERVAL_MS: integer(30_000, (schema) => schema.min(1000)),
  OUTBOX_BATCH_SIZE: integer(50, (schema) => schema.min(1)),
  OUTBOX_MAX_ATTEMPTS: integer(8, (schema) => schema.min(1)),
  OUTBOX_DEAD_ALERT_THRESHOLD: integer(1, (schema) => schema.min(0)),

  // 8) JWT / sesije / kolačići ------------------------------------------------
  JWT_ACCESS_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  JWT_ACCESS_TTL: duration('10m'),
  JWT_REFRESH_TTL: duration('30d'),
  JWT_ISSUER: z.string().min(1).default('vfm-api'),
  JWT_AUDIENCE: z.string().min(1).default('vfm-clients'),
  COOKIE_NAME: z.string().min(1).default(REFRESH_COOKIE_NAME),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? '.ba101.top' : value)),
  COOKIE_SECURE: bool(true),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_PATH: z.string().min(1).default('/api/v1/auth'),
  FILE_SIGNING_SECRET: optionalString,
  FILE_SIGNED_URL_TTL_SECONDS: integer(300, (schema) => schema.min(30)),
  PERMISSIONS_CACHE_TTL_SECONDS: integer(60, (schema) => schema.min(1)),
  AUTH_MAX_SESSIONS_PER_USER: integer(5, (schema) => schema.min(1)),

  // 9) Bootstrap prvog Super Admina ------------------------------------------
  BOOTSTRAP_SUPER_ADMIN_ENABLED: bool(false),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.email().default('admin@example.local'),
  BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: z.string().min(1).default('Super'),
  BOOTSTRAP_SUPER_ADMIN_LAST_NAME: z.string().min(1).default('Admin'),
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: optionalString,
  SEED_DEMO_DATA: bool(false),

  // 10) Firebase Cloud Messaging (R-04: do Faze 5 isključeno) -----------------
  FIREBASE_ENABLED: bool(false),
  FIREBASE_PROJECT_ID: optionalString,
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  FIREBASE_SERVICE_ACCOUNT_HOST_DIR: optionalString,
  FCM_ANDROID_PACKAGE: z.string().min(1).default('ba.example.voznipark'),
  FCM_MESSAGE_TTL_SECONDS: integer(86_400, (schema) => schema.min(0)),
  FCM_INVALID_TOKEN_THRESHOLD: integer(1, (schema) => schema.min(1)),

  // 11) Pohrana priloga (host bind-mount) ------------------------------------
  VFM_STORAGE_PATH: z.string().min(1).default(STORAGE_PATH_DEFAULT),
  VFM_STORAGE_CONTAINER_PATH: z.string().min(1).default(STORAGE_PATH_DEFAULT),
  ATTACHMENT_MAX_SIZE_MB: integer(10, (schema) => schema.min(1).max(1024)),
  ATTACHMENT_ALLOWED_MIME: csv([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
  ]),
  ATTACHMENT_VALIDATE_MAGIC_BYTES: bool(true),
  ATTACHMENT_IMAGE_MAX_WIDTH: integer(1920, (schema) => schema.min(0)),
  ATTACHMENT_IMAGE_JPEG_QUALITY: integer(82, (schema) => schema.min(1).max(100)),
  ATTACHMENT_TEMP_PATH: z.string().min(1).default(STORAGE_TMP_PATH_DEFAULT),

  // 12) Web frontend (nginx) -------------------------------------------------
  WEB_API_INTERNAL_URL: z.string().min(1).default('http://api:3000'),
  VITE_PUBLIC_API_URL: optionalUrl.transform((value) => value ?? DEFAULT_PUBLIC_API_URL),
  VITE_APP_TITLE: z.string().min(1).default('Vozni park'),
  VITE_APP_ENV: z.string().min(1).default('production'),
  VITE_SENTRY_DSN: optionalString,
  VITE_APP_VERSION: z.string().min(1).default('1.0.0'),

  // 13) Mobilna aplikacija (Expo/EAS — nije dio Docker stacka) ----------------
  EXPO_PUBLIC_API_URL: optionalUrl.transform((value) => value ?? DEFAULT_PUBLIC_API_URL),
  EXPO_PUBLIC_APP_ENV: z.string().min(1).default('production'),
  EAS_PROJECT_ID: optionalString,
  ANDROID_PACKAGE: z.string().min(1).default('ba.example.voznipark'),
  ANDROID_VERSION_CODE: integer(1, (schema) => schema.min(1)),
  ANDROID_VERSION_NAME: z.string().min(1).default('1.0.0'),
  GOOGLE_SERVICES_JSON_PATH: z.string().min(1).default('./apps/mobile/google-services.json'),

  // 14) Podsjetnici ----------------------------------------------------------
  REMINDERS_ENABLED: bool(true),
  REMINDERS_SCHEDULE_CRON: z.string().min(9).default('0 6 * * *'),
  REMINDER_REGISTRATION_DAYS_BEFORE: integer(5, (schema) => schema.min(0)),
  REMINDER_INSURANCE_DAYS_BEFORE: integer(5, (schema) => schema.min(0)),
  REMINDER_SERVICE_DAYS_BEFORE: integer(7, (schema) => schema.min(0)),
  REMINDER_SERVICE_KM_BEFORE: integer(500, (schema) => schema.min(0)),
  REMINDER_DRIVER_LICENSE_DAYS_BEFORE: integer(30, (schema) => schema.min(0)),
  REMINDER_TECHNICAL_INSPECTION_DAYS_BEFORE: integer(10, (schema) => schema.min(0)),
  REMINDER_REPEAT_DAYS: integer(0, (schema) => schema.min(0)),
  REMINDER_RECIPIENTS_PERMISSION: z.string().min(1).default('vehicle:view'),

  // 15) Izvještaji i izvoz ---------------------------------------------------
  REPORTS_ENABLED: bool(true),
  REPORT_EXPORT_SYNC_MAX_ROWS: integer(5_000, (schema) => schema.min(1)),
  REPORT_EXPORT_FORMATS: csvLower(['pdf', 'xlsx']),
  REPORT_EXPORT_RETENTION_DAYS: integer(7, (schema) => schema.min(1)),
  REPORT_EXPORT_PATH: z.string().min(1).default(REPORT_EXPORT_PATH_DEFAULT),

  // 16) Audit ----------------------------------------------------------------
  AUDIT_ENABLED: bool(true),
  AUDIT_RETENTION_DAYS: integer(0, (schema) => schema.min(0)),
  AUDIT_REDACT_FIELDS: csv([
    'password',
    'passwordHash',
    'token',
    'refreshToken',
    'authorization',
    'cookie',
    'jti',
    'firebaseServiceAccount',
  ]),
  AUDIT_CAPTURE_IP: bool(true),

  // 17) Monitoring -----------------------------------------------------------
  METRICS_ENABLED: bool(false),
  METRICS_PATH: z.string().min(1).default('/metrics'),
  ALERT_DISK_USAGE_PERCENT: ratio(85),
  ALERT_QUEUE_DEPTH: integer(100, (schema) => schema.min(1)),
  UPTIME_HEARTBEAT_URL: optionalString,

  // 18) Coolify magic varijable (Coolify ih popunjava) -----------------------
  SERVICE_URL_API_3000: z.string().min(1).default('/'),
  SERVICE_URL_WEB: z.string().min(1).default('/'),
  COOLIFY_NETWORK: z.string().min(1).default('coolify'),
  DB_NET_EXTERNAL: bool(true),
  REDIS_NET_EXTERNAL: bool(true),
  COOLIFY_BASE_DIRECTORY: z.string().min(1).default('/'),

  // 18b) Docker build / compose / resursi -----------------------------------
  VFM_API_IMAGE: z.string().min(1).default('vfm-api:local'),
  VFM_WEB_IMAGE: z.string().min(1).default('vfm-web:local'),
  // NAPOMENA: `default` mrežu stacka imenuje Coolify (resource-specific) i na nju
  // kači Traefik — namjerno NEMA varijable za njeno ime (ručno ime → 404/504).
  API_MEMORY_LIMIT: z.string().min(2).default('1024M'),
  WORKER_MEMORY_LIMIT: z.string().min(2).default('768M'),
  WEB_MEMORY_LIMIT: z.string().min(2).default('128M'),
  API_CPU_LIMIT: z.coerce.number().min(0.1).default(1.5),
  WORKER_CPU_LIMIT: z.coerce.number().min(0.1).default(1),
  WEB_CPU_LIMIT: z.coerce.number().min(0.1).default(0.5),
  TURBO_TEAM: optionalString,
  TURBO_TOKEN: optionalString,
  RUN_DB_SEED: bool(false),
  // false = nedostatak Prisma CLI-ja samo preskače migracije (Faza 0);
  // true  = deploy se prekida ako migracije nisu mogle biti pokrenute.
  MIGRATIONS_STRICT: bool(false),

  // 19) Razvoj / test -------------------------------------------------------
  DEV_DB_PASSWORD: optionalString,
  DEV_REDIS_PASSWORD_API: optionalString,
  DEV_REDIS_PASSWORD_WORKER: optionalString,
  DEV_REDIS_PASSWORD_READONLY: optionalString,
  TEST_DATABASE_URL: optionalString,
  TEST_REDIS_URL: optionalString,
  DEV_POSTGRES_PORT: port(5433),
  DEV_REDIS_PORT: port(6380),
  DEV_STORAGE_PATH: z.string().min(1).default('./.data/attachments'),
});

export type BaseEnv = z.output<typeof baseEnvSchema>;

// -----------------------------------------------------------------------------
//  Parse + profilna validacija
// -----------------------------------------------------------------------------

/** Parsira i validira `process.env` (oblik/tipovi). Baca agregiranu grešku. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  const parsed = baseEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Neispravna konfiguracija okruženja (.env / Coolify varijable):\n${issues}\n\n` +
        'Usporedite s .env.example (verzija je navedena u zaglavlju fajla).',
    );
  }
  return parsed.data;
}

/** Da li je produkcijsko okruženje (strože provjere). */
export function isProduction(env: BaseEnv): boolean {
  return env.APP_ENV === 'production' || env.NODE_ENV === 'production';
}

/**
 * Profilno-specifična provjera (poziva se nakon `parseEnv`). Vraća listu grešaka.
 *
 * Ne baca — vraća sve probleme odjednom (bolje za Coolify log).
 */
export function validateEnvProfile(
  env: BaseEnv,
  profile: EnvProfile = env.ENV_PROFILE,
): readonly string[] {
  const errors: string[] = [];
  if (profile === 'test') return errors;

  // Zajedničko za api i tool
  if (!env.DATABASE_URL) {
    errors.push(
      'DATABASE_URL je obavezan (globalni PostgreSQL na mreži db_net — vidi .env.example §5).',
    );
  }

  if (profile === 'tool') return errors;

  // Profil "api"
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
  ] as const) {
    if (!value || value.length < 32) {
      errors.push(`${name} je obavezan i mora imati barem 32 znaka.`);
    }
  }
  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_REFRESH_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    errors.push('JWT_ACCESS_SECRET i JWT_REFRESH_SECRET moraju biti različiti.');
  }

  if (!env.REDIS_HOST) {
    errors.push('REDIS_HOST je obavezan (globalni Redis na mreži redis_net — vidi .env.example §6).');
  }

  if (isProduction(env)) {
    if (!env.REDIS_PASSWORD_API) {
      errors.push('REDIS_PASSWORD_API je obavezan u produkciji (ACL korisnik vfm-api).');
    }
    if (!env.REDIS_PASSWORD_WORKER) {
      errors.push('REDIS_PASSWORD_WORKER je obavezan u produkciji (ACL korisnik vfm-worker).');
    }
    if (!env.COOKIE_SECURE) {
      errors.push('COOKIE_SECURE mora biti true u produkciji (HTTPS preko Coolify TLS-a).');
    }
    if (env.SWAGGER_ENABLED) {
      errors.push('SWAGGER_ENABLED mora biti false u produkciji (ne izlagati API šemu).');
    }
    if (!env.FILE_SIGNING_SECRET) {
      errors.push('FILE_SIGNING_SECRET je obavezan u produkciji (potpisani URL-ovi priloga).');
    }
  }

  if (env.FIREBASE_ENABLED) {
    if (!env.FIREBASE_PROJECT_ID) {
      errors.push('FIREBASE_PROJECT_ID je obavezan kad je FIREBASE_ENABLED=true.');
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      errors.push('FIREBASE_SERVICE_ACCOUNT_PATH je obavezan kad je FIREBASE_ENABLED=true.');
    }
  }

  if (env.BOOTSTRAP_SUPER_ADMIN_ENABLED && !env.BOOTSTRAP_SUPER_ADMIN_EMAIL) {
    errors.push('BOOTSTRAP_SUPER_ADMIN_EMAIL je obavezan kad je bootstrap uključen.');
  }

  return errors;
}

/** Parsira ENV i odmah validira profil → baca grešku s jasnom porukom. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  const env = parseEnv(source);
  const errors = validateEnvProfile(env);
  if (errors.length > 0) {
    throw new Error(
      `Konfiguracija nije kompletna za profil "${env.ENV_PROFILE}":\n` +
        errors.map((error) => `  - ${error}`).join('\n'),
    );
  }
  return env;
}

// -----------------------------------------------------------------------------
//  Izvedene vrijednosti (koriste ih API, worker i alati)
// -----------------------------------------------------------------------------

/** ACL korisnik i lozinka za datu ulogu (api | worker | readonly). */
export type RedisRole = 'api' | 'worker' | 'readonly';

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string;
  readonly db: number;
  readonly tls: boolean;
}

/**
 * Redis konekcija za ulogu — **least privilege** (docs/05, `REDIS_ACL.md`).
 * Svaki proces koristi svog ACL korisnika; nikad `default`.
 */
export function redisConfig(env: BaseEnv, role: RedisRole): RedisConnectionConfig {
  const map: Record<RedisRole, { user: string; password?: string }> = {
    api: { user: env.REDIS_USER_API, ...(env.REDIS_PASSWORD_API ? { password: env.REDIS_PASSWORD_API } : {}) },
    worker: {
      user: env.REDIS_USER_WORKER,
      ...(env.REDIS_PASSWORD_WORKER ? { password: env.REDIS_PASSWORD_WORKER } : {}),
    },
    readonly: {
      user: env.REDIS_USER_READONLY,
      ...(env.REDIS_PASSWORD_READONLY ? { password: env.REDIS_PASSWORD_READONLY } : {}),
    },
  };

  return {
    host: env.REDIS_HOST ?? 'redis',
    port: env.REDIS_PORT,
    username: map[role].user,
    ...(map[role].password ? { password: map[role].password } : {}),
    db: env.REDIS_DB,
    tls: env.REDIS_TLS,
  };
}

/** Imena BullMQ redova iz ENV-a (default `vfm-queue-*`). */
export function queueNames(env: BaseEnv): {
  readonly outbox: string;
  readonly notifications: string;
  readonly reminders: string;
  readonly reports: string;
  readonly maintenance: string;
} {
  return {
    outbox: env.QUEUE_OUTBOX || queueName('outbox'),
    notifications: env.QUEUE_NOTIFICATIONS || queueName('notifications'),
    reminders: env.QUEUE_REMINDERS || queueName('reminders'),
    reports: env.QUEUE_REPORTS || queueName('reports'),
    maintenance: env.QUEUE_MAINTENANCE || queueName('maintenance'),
  };
}

/**
 * Normalizuje root prefiks Redis ključeva (`VFM_REDIS_KEY_PREFIX`): prazno →
 * `vfm:`, bez dvotačke → dodaje dvotačku. Rezultat je uvijek `xxx:`.
 */
export function normalizeRedisKeyPrefix(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return REDIS_KEY_PREFIX;
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

/**
 * BullMQ opcija `prefix` — **jedini izvor istine** za prefiks ključeva redova.
 *
 * BullMQ gradi ključeve kao `<prefix>:<nazivReda>:<suffix>` (npr.
 * `vfm:queue:vfm-queue-outbox:wait`), pa prefiks MORA biti unutar ACL opsega
 * `~vfm:*` (`REDIS_ACL.md` §1 i §4). Ako bi bio BullMQ default `'bull'`, ključevi
 * bi bili `bull:vfm-queue-outbox:wait` i Redis bi odbio svaku operaciju s
 * `NOPERM ... no permissions to access a key` → worker ne obrađuje nijedan red.
 *
 * ⚠️ Promjena ove vrijednosti = promjena Redis ključeva → obavezno ažurirati
 * `REDIS_ACL.md` (§4 + changelog) **i** ACL fajl na serveru (`ACL LOAD`).
 */
export function queueKeyPrefix(env: BaseEnv): string {
  const root = normalizeRedisKeyPrefix(env.VFM_REDIS_KEY_PREFIX);
  return root === REDIS_KEY_PREFIX ? QUEUE_KEY_PREFIX : `${root}queue`;
}

/**
 * Provjera da su **svi** Redis ključevi/prefiksi koje aplikacija gradi unutar ACL
 * opsega `~vfm:*`. Prazna lista = konfiguracija je usklađena s `REDIS_ACL.md`.
 *
 * Poziva se pri pokretanju worker-a (fail-fast) i u `QueueService` (upozorenje),
 * tako da se ACL greška vidi u logu **prije** nego što Redis počne vraćati
 * `NOPERM` na svaku komandu.
 */
export function validateRedisAclScope(env: BaseEnv): readonly string[] {
  const problems: string[] = [];
  const prefix = queueKeyPrefix(env);

  if (!isInsideRedisAclScope(`${prefix}:`)) {
    problems.push(
      `BullMQ prefiks "${prefix}" je izvan ACL opsega ${REDIS_ACL_KEY_PATTERN} — ` +
        `VFM_REDIS_KEY_PREFIX mora počinjati s "${REDIS_KEY_PREFIX}" (REDIS_ACL.md §1 i §4.1).`,
    );
  }

  const names = queueNames(env);
  for (const logicalName of QUEUE_NAMES) {
    const queue = names[logicalName as QueueName];
    const key = bullQueueKey(prefix, queue);
    if (!isInsideRedisAclScope(key)) {
      problems.push(
        `Ključ reda "${logicalName}" (${key}) je izvan ACL opsega ${REDIS_ACL_KEY_PATTERN} ` +
          '(REDIS_ACL.md §4).',
      );
    }
  }

  for (const [namespace, value] of Object.entries(REDIS_NS)) {
    if (!isInsideRedisAclScope(value)) {
      problems.push(
        `Redis namespace "${namespace}" (${value}) je izvan ACL opsega ${REDIS_ACL_KEY_PATTERN} ` +
          '(REDIS_ACL.md §4).',
      );
    }
  }

  return problems;
}

/**
 * Trajanje u obliku `10m` / `30d` / `900s` / `24h` / `2w` → sekunde.
 *
 * Koristi se za `expiresIn` u odgovoru `/auth/login` i za `maxAge` refresh
 * cookie-ja (docs/05 §5). Format je već validiran Zod šemom (`duration()`), pa
 * neispravan ulaz baca grešku umjesto da tiho vrati 0.
 */
export function durationToSeconds(value: string): number {
  const match = /^\s*(\d+)\s*([smhdw])\s*$/u.exec(value ?? '');
  if (!match) {
    throw new Error(`Neispravan format trajanja: "${value}" (očekivano npr. 900s, 10m, 24h, 30d).`);
  }
  const amount = Number(match[1] ?? '0');
  const unit = match[2] ?? 's';
  const perUnit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };
  return amount * (perUnit[unit] ?? 1);
}

/** Maksimalna veličina fajla u bajtovima (iz `ATTACHMENT_MAX_SIZE_MB`). */
export function maxFileSizeBytes(env: BaseEnv): number {
  return Math.min(env.ATTACHMENT_MAX_SIZE_MB * 1024 * 1024, MAX_FILE_SIZE_BYTES * 5);
}

/** Broj hopova koje `trust proxy` prihvata (Express). */
export function trustProxyHops(env: BaseEnv): number | boolean {
  if (env.TRUST_PROXY === 'loopback') return 1;
  if (env.TRUST_PROXY === 'all' || env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1') return true;
  return false;
}

// -----------------------------------------------------------------------------
//  Zajedničke šeme za API ugovor (koriste ih i klijenti)
// -----------------------------------------------------------------------------
// Fizički žive u `./schemas.ts` (ulaz `@vfm/shared/schemas`, bez ENV šeme — da
// zod šeme API ugovora mogu koristiti i web/mobilna bez server-only konteksta).
// Ovaj re-export postoji zbog kompatibilnosti s `@vfm/shared/env` potrošačima.

export {
  SORT_ORDERS,
  emailSchema,
  locationSchema,
  paginationQuerySchema,
  passwordSchema,
  plateSchema,
  requestIdSchema,
  uuidSchema,
} from './schemas.js';
export type { PaginationQuery, SortOrder } from './schemas.js';

/** Pomoćno: gradnja `DATABASE_URL` iz dijelova (alat `scripts/db-url.mjs`). */
export function buildDatabaseUrl(env: BaseEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DATABASE_HOST || !env.DATABASE_PASSWORD) return undefined;
  const params = new URLSearchParams({
    schema: 'public',
    connection_limit: String(env.DATABASE_CONNECTION_LIMIT),
    pool_timeout: String(env.DATABASE_POOL_TIMEOUT),
    ...(env.DATABASE_SSL ? { sslmode: 'require' } : {}),
  });
  return `postgresql://${encodeURIComponent(env.DATABASE_USER)}:${encodeURIComponent(env.DATABASE_PASSWORD)}@${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}?${params.toString()}`;
}

/** Osnovni URL API-ja za datu okolinu (bez trailing slash). */
export function apiBaseUrl(env: BaseEnv): string {
  return env.PUBLIC_API_URL.replace(/\/$/u, '') || `${DEFAULT_API_ORIGIN}${API_PREFIX}`;
}
