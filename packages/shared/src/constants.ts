/**
 * VFM — globalne konstante sistema.
 *
 * Jedinstven izvor istine za prefikse, mreže, redove, ključeve i formate.
 * Sinhronizovano s `.env.example` (v1.0.3), `REDIS_ACL.md` (v1.0.1) i
 * `docker-compose.yml`. Ako se bilo šta ovdje promijeni → obavezno ažurirati
 * te fajlove (i upozoriti vlasnika da učita Redis ACL: `ACL LOAD`).
 */

/** Prefiks aplikacije: koristi se za nazive servisa, ključeve, foldere. */
export const APP_PREFIX = 'vfm' as const;

/**Naziv proizvoda (bs) — koristi se u UI-u i dokumentima. */
export const APP_NAME = 'Vozni park' as const;

/** Osnovni API prefiks (bez verzije). */
export const API_BASE_PATH = '/api' as const;

/** Verzija API-ja. */
export const API_VERSION = 'v1' as const;

/** Pun API prefiks: `/api/v1`. */
export const API_PREFIX = `${API_BASE_PATH}/${API_VERSION}` as const;

/**
 * ✅ R-03 (odluka vlasnika, 19.10.2026.): domene kreira vlasnik ručno u
 * Coolify-u, Coolify izdaje HTTPS/Let's Encrypt certifikate.
 */
export const DEFAULT_WEB_ORIGIN = 'https://vehicle.ba101.top' as const;
export const DEFAULT_API_ORIGIN = 'https://api.vehicle.ba101.top' as const;
export const DEFAULT_PUBLIC_API_URL = `${DEFAULT_API_ORIGIN}${API_PREFIX}` as const;

/** Domena za httpOnly refresh cookie (web i api dijele registrabilni domen). */
export const DEFAULT_COOKIE_DOMAIN = '.ba101.top' as const;

/** Vremenska zona prikaza. Baza čuva isključivo UTC (`timestamptz`). */
export const TIMEZONE = 'Europe/Sarajevo' as const;

/** Jezik korisničkog interfejsa i validacijskih poruka. */
export const LOCALE = 'bs' as const;

/** Valuta iznosa. Iznosi se čuvaju kao cijeli brojevi feninga (integer). */
export const CURRENCY = 'BAM' as const;
export const CURRENCY_LABEL = 'KM' as const;

/** 1 KM = 100 feninga. */
export const MINOR_UNITS_PER_MAJOR = 100 as const;

/** Format datuma i datuma+vremena za `bs` lokal. */
export const DATE_FORMAT = 'dd.MM.yyyy' as const;
export const DATETIME_FORMAT = 'dd.MM.yyyy HH:mm' as const;

/**
 * Vanjske Docker mreže na hostu (globalni Postgres i globalni Redis).
 * U `docker-compose.yml` su deklarisane kao `external: true`.
 */
export const DB_NETWORK = 'db_net' as const;
export const REDIS_NETWORK = 'redis_net' as const;

/** Default porta API kontejnera unutar compose mreže. */
export const API_PORT = 3000 as const;

/** Nazivi BullMQ redova (bez prefiksa). Pun naziv: `vfm-queue-<name>`. */
export const QUEUE_NAMES = [
  'outbox',
  'notifications',
  'reminders',
  'reports',
  'maintenance',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Root prefiks **svih** Redis ključeva aplikacije.
 *
 * Odgovara ACL patternu `~vfm:*` iz `REDIS_ACL.md` §1 i defaultu ENV varijable
 * `VFM_REDIS_KEY_PREFIX`. Ništa izvan ovog prefiksa aplikacija ne smije dirati —
 * Redis to odbija s `NOPERM ... no permissions to access a key`.
 */
export const REDIS_KEY_PREFIX = `${APP_PREFIX}:` as const;

/** ACL pattern ključeva kako je definisan u `REDIS_ACL.md` §1 (`~vfm:*`). */
export const REDIS_ACL_KEY_PATTERN = `~${REDIS_KEY_PREFIX}*` as const;

/**
 * Prefiks BullMQ redova u Redisu: ključevi su `vfm:queue:<nazivReda>:*`.
 *
 * 🔴 Ovo je BullMQ opcija `prefix` — NE smije biti `'bull'` (default), jer tada
 * ključevi postaju `bull:vfm-queue-*` i ACL `~vfm:*` ih blokira (`NOPERM`).
 * Vidi `REDIS_ACL.md` §4 i `env-schema.queueKeyPrefix()`.
 */
export const QUEUE_KEY_PREFIX = `${REDIS_KEY_PREFIX}queue` as const;

/** Pun naziv reda (koristi se kao `Queue` ime u BullMQ). */
export function queueName(name: QueueName): string {
  return `${APP_PREFIX}-queue-${name}`;
}

/**
 * Da li je ključ (ili prefiks) unutar ACL opsega `~vfm:*`.
 *
 * Provjera je namjerno stroga i po prefixu: ključ koji počinje s `{` (hash-tag)
 * ili s tuđim namespace-om ne odgovara globu `vfm:*` i Redis ga odbija.
 */
export function isInsideRedisAclScope(keyOrPrefix: string): boolean {
  return typeof keyOrPrefix === 'string' && keyOrPrefix.startsWith(REDIS_KEY_PREFIX);
}

/**
 * Redis ključ koji BullMQ gradi za red: `<prefix>:<nazivReda>:<suffix>`.
 *
 * Služi za provjeru ACL opsega **prije** pokretanja (worker/api) i za jasne
 * poruke u logovima. Format je definisan u BullMQ-ovoj klasi `QueueKeys`.
 */
export function bullQueueKey(prefix: string, queue: string, suffix = 'wait'): string {
  return suffix.length > 0 ? `${prefix}:${queue}:${suffix}` : `${prefix}:${queue}`;
}

/**
 * Parametri hash-ovanja lozinke — **argon2id** (docs/05 §7, zaključano):
 * `memoryCost = 64 MB`, `timeCost = 3`, `parallelism = 1`.
 *
 * Koriste ih `PasswordService` (API) i `scripts/bootstrap-super-admin.mjs`, pa
 * hash zapisan u bazi i provjera moraju biti isti. Vrijednost `m` u PHC stringu
 * je u KiB → 64 MB = 65536.
 */
export const ARGON2_MEMORY_COST_KIB = 65536;
export const ARGON2_TIME_COST = 3;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_HASH_LENGTH = 32;
export const ARGON2_SALT_LENGTH = 16;

/** Dužina generisane slučajne lozinke (bootstrap / reset / demo seed). */
export const GENERATED_PASSWORD_LENGTH = 20;

/** Jednokratni token za reset lozinke: 30 min, jednokratno korištenje (docs/05 §7). */
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

/** Refresh token: 256 bita entropije → base64url bez paddinga (docs/05 §5.2). */
export const REFRESH_TOKEN_BYTES = 32;

/**
 * Nazivi claim-ova access tokena (docs/05 §5.1): `roles`, `tv` (tokenVersion),
 * `pv` (permissionsVersion), `ct` (clientType), `sid` (RefreshSession.id).
 * Permisije NIKAD nisu u tokenu.
 */
export const JWT_CLAIMS = {
  tokenVersion: 'tv',
  permissionsVersion: 'pv',
  clientType: 'ct',
  sessionId: 'sid',
  roles: 'roles',
} as const;

/** Redis ACL korisnici (definirani u `REDIS_ACL.md` / `infra/redis/users.acl.example`). */
export const REDIS_ACL_USERS = {
  api: 'vfm-api',
  worker: 'vfm-worker',
  readonly: 'vfm-readonly',
} as const;
export type RedisAclUser = (typeof REDIS_ACL_USERS)[keyof typeof REDIS_ACL_USERS];

/**
 * Redis namespace-ovi. Svi ključevi MORaju počinjati s `vfm:` jer je ACL
 * ograničen na `~vfm:*` (vidi `REDIS_ACL.md` §4).
 */
export const REDIS_NS = {
  permissions: 'vfm:perm',
  permissionsVersion: 'vfm:permver',
  tokenVersion: 'vfm:tokenver',
  session: 'vfm:session',
  rateLimit: 'vfm:rl',
  lock: 'vfm:lock',
  idempotency: 'vfm:idem',
  cache: 'vfm:cache',
  queue: 'vfm:queue',
  auditStream: 'vfm:stream:audit',
  metrics: 'vfm:metrics',
  sse: 'vfm:sse',
} as const;

/** Ime httpOnly cookie-a za refresh token. */
export const REFRESH_COOKIE_NAME = 'vfm_refresh' as const;

/** Ime zaglavlja za idempotenciju (P-06). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key' as const;

/**
 * Ime zaglavlja za tip klijenta (web/mobile) — server-side provjera (N-05).
 * Dozvoljene vrijednosti su u `enums.ts` → `CLIENT_TYPES`
 * (`WEB`, `MOBILE_ANDROID`, `MOBILE_IOS`, `SERVICE`).
 */
export const CLIENT_TYPE_HEADER = 'X-Client-Type' as const;

/** Ime zaglavlja za korelaciju logova. */
export const REQUEST_ID_HEADER = 'X-Request-Id' as const;

/** Putanje pohrane priloga (host path == container path). */
export const STORAGE_PATH_DEFAULT = '/data/vfm/attachments' as const;
export const STORAGE_TMP_PATH_DEFAULT = '/data/vfm/tmp' as const;
export const REPORT_EXPORT_PATH_DEFAULT = '/data/vfm/attachments/exports' as const;

/**
 * Maksimalna veličina uploada.
 * - 20 MB po datoteci (slika/PDF)
 * - 50 MB po zahtjevu (više datoteka)
 * Usklađeno s `client_max_body_size` u `apps/web/nginx/nginx.conf.template`.
 */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;

/** Dozvoljene MIME vrste priloga. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

/** Zadržavanje podataka (gdpr/audit) u danima. */
export const AUDIT_RETENTION_DAYS = 1095 as const; // 3 godine
export const IDEMPOTENCY_RETENTION_HOURS = 24 as const;

/** Pagination defaulti i limiti. */
export const DEFAULT_PAGE_SIZE = 25 as const;
export const MAX_PAGE_SIZE = 200 as const;

/** Optimističko zaključavanje: početna verzija zapisa. */
export const INITIAL_VERSION = 1 as const;
