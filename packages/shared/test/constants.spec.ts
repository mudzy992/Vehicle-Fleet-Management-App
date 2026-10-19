import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  API_PREFIX,
  API_VERSION,
  APP_PREFIX,
  AUDIT_RETENTION_DAYS,
  CLIENT_TYPE_HEADER,
  CURRENCY,
  CURRENCY_LABEL,
  DATE_FORMAT,
  DATETIME_FORMAT,
  DB_NETWORK,
  DEFAULT_API_ORIGIN,
  DEFAULT_COOKIE_DOMAIN,
  DEFAULT_PUBLIC_API_URL,
  DEFAULT_WEB_ORIGIN,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_RETENTION_HOURS,
  LOCALE,
  MAX_FILE_SIZE_BYTES,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BODY_BYTES,
  MINOR_UNITS_PER_MAJOR,
  QUEUE_KEY_PREFIX,
  QUEUE_NAMES,
  REDIS_ACL_KEY_PATTERN,
  REDIS_ACL_USERS,
  REDIS_KEY_PREFIX,
  REDIS_NETWORK,
  REDIS_NS,
  REFRESH_COOKIE_NAME,
  REPORT_EXPORT_PATH_DEFAULT,
  REQUEST_ID_HEADER,
  STORAGE_PATH_DEFAULT,
  STORAGE_TMP_PATH_DEFAULT,
  TIMEZONE,
  bullQueueKey,
  isInsideRedisAclScope,
  queueName,
} from '../dist/index.js';

/**
 * Ovi testovi čuvaju **ugovor s infrastrukturom**: nazivi mreža, Redis
 * namespace-ovi, ACL korisnici i putanje moraju ostati usklađeni s
 * `docker-compose.yml`, `REDIS_ACL.md` i `.env.example`.
 *
 * Ako test padne → promjena zahtijeva ažuriranje ACL-a (`ACL LOAD` na globalnom
 * Redisu) i obavještenje vlasnika.
 */
describe('infrastrukturni ugovori', () => {
  it('prefiks aplikacije je "vfm"', () => {
    expect(APP_PREFIX).toBe('vfm');
  });

  it('mreže su db_net (Postgres) i redis_net (Redis) — obje external', () => {
    expect(DB_NETWORK).toBe('db_net');
    expect(REDIS_NETWORK).toBe('redis_net');
  });

  it('svi Redis namespace-ovi počinju s vfm: (ACL ~vfm:*)', () => {
    for (const [name, prefix] of Object.entries(REDIS_NS)) {
      expect(prefix.startsWith('vfm:'), `${name} → ${prefix}`).toBe(true);
    }
  });

  it('ACL korisnici su vfm-api / vfm-worker / vfm-readonly', () => {
    expect(REDIS_ACL_USERS).toEqual({
      api: 'vfm-api',
      worker: 'vfm-worker',
      readonly: 'vfm-readonly',
    });
  });

  it('namespace-ovi pokrivaju sve potrebe iz REDIS_ACL.md §4', () => {
    expect(REDIS_NS.permissions).toBe('vfm:perm');
    expect(REDIS_NS.permissionsVersion).toBe('vfm:permver');
    expect(REDIS_NS.tokenVersion).toBe('vfm:tokenver');
    expect(REDIS_NS.session).toBe('vfm:session');
    expect(REDIS_NS.rateLimit).toBe('vfm:rl');
    expect(REDIS_NS.lock).toBe('vfm:lock');
    expect(REDIS_NS.idempotency).toBe('vfm:idem');
    expect(REDIS_NS.cache).toBe('vfm:cache');
    expect(REDIS_NS.queue).toBe('vfm:queue');
    expect(REDIS_NS.auditStream).toBe('vfm:stream:audit');
    expect(REDIS_NS.metrics).toBe('vfm:metrics');
    expect(REDIS_NS.sse).toBe('vfm:sse');
  });

  it('prefix redova je vfm:queue', () => {
    expect(QUEUE_KEY_PREFIX).toBe('vfm:queue');
  });
});

describe('API i lokalizacija', () => {
  it('API prefiks je /api/v1', () => {
    expect(API_PREFIX).toBe('/api/v1');
    expect(API_VERSION).toBe('v1');
  });

  it('R-03: domene vlasnika', () => {
    expect(DEFAULT_WEB_ORIGIN).toBe('https://vehicle.ba101.top');
    expect(DEFAULT_API_ORIGIN).toBe('https://api.vehicle.ba101.top');
    expect(DEFAULT_PUBLIC_API_URL).toBe('https://api.vehicle.ba101.top/api/v1');
    expect(DEFAULT_COOKIE_DOMAIN).toBe('.ba101.top');
  });

  it('jezik, valuta i vremenska zona', () => {
    expect(LOCALE).toBe('bs');
    expect(CURRENCY).toBe('BAM');
    expect(CURRENCY_LABEL).toBe('KM');
    expect(TIMEZONE).toBe('Europe/Sarajevo');
    expect(MINOR_UNITS_PER_MAJOR).toBe(100);
  });

  it('formati datuma (docs/06 §6)', () => {
    expect(DATE_FORMAT).toBe('dd.MM.yyyy');
    expect(DATETIME_FORMAT).toBe('dd.MM.yyyy HH:mm');
  });

  it('zaglavlja i cookie', () => {
    expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key');
    expect(CLIENT_TYPE_HEADER).toBe('X-Client-Type');
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
    expect(REFRESH_COOKIE_NAME).toBe('vfm_refresh');
  });
});

describe('pohrana i limiti', () => {
  it('putanje priloga: host path == container path', () => {
    expect(STORAGE_PATH_DEFAULT).toBe('/data/vfm/attachments');
    expect(STORAGE_TMP_PATH_DEFAULT).toBe('/data/vfm/tmp');
    expect(REPORT_EXPORT_PATH_DEFAULT).toBe('/data/vfm/attachments/exports');
  });

  it('limiti uploada: 20 MB po datoteci, 50 MB po zahtjevu', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_REQUEST_BODY_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_FILE_SIZE_BYTES).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);
  });

  it('dozvoljeni MIME tipovi: slike i PDF, bez izvršnih datoteka', () => {
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).toContain('image/heic');
    for (const forbidden of [
      'application/x-msdownload',
      'application/x-sh',
      'text/javascript',
      'application/x-php',
      'application/x-executable',
    ]) {
      expect(ALLOWED_MIME_TYPES).not.toContain(forbidden);
    }
  });

  it('retencija: audit 3 godine, idempotencija 24 h', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(1095);
    expect(IDEMPOTENCY_RETENTION_HOURS).toBe(24);
  });

  it('pagination limiti', () => {
    expect(MAX_PAGE_SIZE).toBe(200);
    expect(MAX_PAGE_SIZE).toBeGreaterThan(25);
  });
});

/**
 * ACL opseg ključeva (`REDIS_ACL.md` §1: `user vfm-* … ~vfm:*`).
 *
 * Regresija: BullMQ je bio pokrenut s default prefiksom `'bull'`, pa su ključevi
 * bili `bull:vfm-queue-*` → Redis je vraćao
 * `NOPERM … no permissions to access a key` i worker nije mogao raditi.
 */
describe('Redis ACL opseg (~vfm:*)', () => {
  it('root prefiks i ACL pattern su usklađeni s REDIS_ACL.md §1', () => {
    expect(REDIS_KEY_PREFIX).toBe('vfm:');
    expect(REDIS_ACL_KEY_PATTERN).toBe('~vfm:*');
    expect(QUEUE_KEY_PREFIX).toBe('vfm:queue');
  });

  it('isInsideRedisAclScope prihvata samo ključeve unutar vfm:', () => {
    expect(isInsideRedisAclScope('vfm:queue:vfm-queue-outbox:wait')).toBe(true);
    expect(isInsideRedisAclScope('vfm:metrics:worker:heartbeat')).toBe(true);
    expect(isInsideRedisAclScope('vfm:lock:migrate')).toBe(true);

    // BullMQ default prefiks — upravo ovaj slučaj je padao s NOPERM.
    expect(isInsideRedisAclScope('bull:vfm-queue-outbox:wait')).toBe(false);
    expect(isInsideRedisAclScope('bull')).toBe(false);
    // Tuđi namespace na dijeljenom globalnom Redisu.
    expect(isInsideRedisAclScope('coolify:cache')).toBe(false);
    // Hash-tag na početku ključa ne odgovara globu `vfm:*`.
    expect(isInsideRedisAclScope('{vfm:queue:outbox}:wait')).toBe(false);
    expect(isInsideRedisAclScope('')).toBe(false);
  });

  it('bullQueueKey gradi ključ onako kako ga gradi BullMQ QueueKeys', () => {
    expect(bullQueueKey(QUEUE_KEY_PREFIX, queueName('outbox'))).toBe('vfm:queue:vfm-queue-outbox:wait');
    expect(bullQueueKey(QUEUE_KEY_PREFIX, queueName('reports'), 'id')).toBe('vfm:queue:vfm-queue-reports:id');
    expect(bullQueueKey(QUEUE_KEY_PREFIX, queueName('maintenance'), '')).toBe(
      'vfm:queue:vfm-queue-maintenance',
    );
    // BullMQ default prefiks → ključ izvan ACL opsega (NOPERM).
    expect(isInsideRedisAclScope(bullQueueKey('bull', queueName('outbox')))).toBe(false);
  });

  it('svaki naziv reda iz QUEUE_NAMES daje ključ unutar ACL opsega', () => {
    for (const name of QUEUE_NAMES) {
      const key = bullQueueKey(QUEUE_KEY_PREFIX, queueName(name));
      expect(isInsideRedisAclScope(key), `${name} → ${key}`).toBe(true);
    }
  });
});
