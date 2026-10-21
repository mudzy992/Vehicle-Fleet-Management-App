/**
 * Idempotencija zahtjeva (P-06, docs/05 §9).
 *
 * Klijent šalje `Idempotency-Key: <uuid>` uz mutacijske zahtjeve.
 * Server pamti:
 *   `vfm:idem:<userId>:<key>` → `{ requestHash, status, body, completedAt }`
 *
 * Pravila:
 * - **Isti ključ + isti payload** → vraća se sačuvani odgovor (bez ponovnog
 *   izvršavanja operacije).
 * - **Isti ključ + drugi payload** → `422 IDEMPOTENCY_KEY_REUSED` (P-06).
 * - **Zahtjev u toku** → pozivalac dobija posebnu `in-progress` odluku i ne
 *   smije izvršiti handler drugi put.
 * - Završeni odgovor se čuva 24 h (`IDEMPOTENCY_RETENTION_HOURS`, docs/03 §6).
 *   Sama rezervacija ima kraći TTL da pad procesa ne zaključa ključ cijeli dan.
 *
 * ⚠️ Bez Redis-a idempotencija ne radi (503 za mutacije koje je zahtijevaju) —
 *    zato je Redis obavezan od Faze 1 (odluka vlasnika: Redis full stack).
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_RETENTION_HOURS, REDIS_NS } from '@vfm/shared';
import { RedisService } from './redis.service.js';
import { VfmException } from '../../common/errors/vfm-error.js';

/** Stanje idempotency zapisa. */
export type IdempotencyState = 'in-progress' | 'completed';

export interface IdempotencyRecord {
  readonly state: IdempotencyState;
  readonly requestHash: string;
  /** Token vlasnika rezervacije; samo on smije završiti ili osloboditi ključ. */
  readonly reservationToken?: string;
  readonly status?: number;
  readonly body?: unknown;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface IdempotencyDecision {
  /**
   * `execute` → nastavi s handlerom; `replay` → vrati sačuvani odgovor;
   * `conflict` → isti ključ nosi drugi zahtjev; `in-progress` → prvi zahtjev
   * s istim otiskom još nije završen.
   */
  readonly action: 'execute' | 'replay' | 'conflict' | 'in-progress';
  readonly requestHash: string;
  readonly record?: IdempotencyRecord;
  readonly reservationToken?: string;
}

/** Maksimalna veličina sačuvanog odgovora (veće se ne keširaju). */
const MAX_CACHED_BODY_BYTES = 64 * 1024;

/** Koliko dugo nezavršena rezervacija smije blokirati isti ključ. */
const IN_PROGRESS_TTL_SECONDS = 5 * 60;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds: number;

  constructor(private readonly redis: RedisService) {
    this.ttlSeconds = IDEMPOTENCY_RETENTION_HOURS * 3600;
  }

  /**
   * Provjerava ključ i rezerviše ga ako je nov.
   *
   * @param scope  korisnički/opseg ključ (npr. `userId` ili `userId:taskId`)
   * @param key    vrijednost `Idempotency-Key` zaglavlja
   * @param payload otisak zahtjeva (metoda, putanja i tijelo)
   */
  async reserve(scope: string, key: string, payload: unknown): Promise<IdempotencyDecision> {
    try {
      return await this.reserveInternal(scope, key, payload);
    } catch (error) {
      if (error instanceof VfmException) throw error;
      this.logger.warn(
        `Redis idempotency rezervacija nije uspjela: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new VfmException(
        'DEPENDENCY_UNAVAILABLE',
        'Idempotencija zahtijeva Redis. Servis je privremeno nedostupan.',
      );
    }
  }

  private async reserveInternal(scope: string, key: string, payload: unknown): Promise<IdempotencyDecision> {
    if (!this.redis.isEnabled) {
      throw new VfmException(
        'DEPENDENCY_UNAVAILABLE',
        'Idempotencija zahtijeva Redis. Servis je privremeno nedostupan.',
      );
    }

    const client = this.redis.requireConnection('api');
    const redisKey = this.buildKey(scope, key);
    const requestHash = hashPayload(payload);

    // Dva prolaza pokrivaju utrku u kojoj drugi proces rezerviše ključ između
    // našeg GET i SET NX: drugi prolaz pročita njegov zapis i vrati odluku.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existingRaw = await client.get(redisKey);

      if (existingRaw) {
        const existing = safeParse(existingRaw);
        if (!existing) {
          // Oštećen zapis ne smije trajno blokirati korisnika.
          this.logger.warn(`Neispravan idempotency zapis za "${redisKey}" — prepisujem.`);
          await client.del(redisKey);
        } else if (existing.requestHash !== requestHash) {
          return { action: 'conflict', requestHash, record: existing };
        } else if (existing.state === 'completed') {
          if (typeof existing.status === 'number' && Object.hasOwn(existing, 'body')) {
            return { action: 'replay', requestHash, record: existing };
          }
          this.logger.warn(`Nepotpun završeni idempotency zapis za "${redisKey}" — prepisujem.`);
          await client.del(redisKey);
        } else {
          return { action: 'in-progress', requestHash, record: existing };
        }
      }

      const reservationToken = randomUUID();
      const reserved: IdempotencyRecord = {
        state: 'in-progress',
        requestHash,
        reservationToken,
        createdAt: new Date().toISOString(),
      };

      const ok = await client.set(redisKey, JSON.stringify(reserved), 'EX', IN_PROGRESS_TTL_SECONDS, 'NX');
      if (ok === 'OK') {
        return { action: 'execute', requestHash, reservationToken };
      }
    }

    return { action: 'in-progress', requestHash };
  }

  /**
   * Uspješan završetak: sačuva odgovor za replikaciju.
   *
   * `requestHash` mora biti onaj iz rezervacije. Ranija implementacija ga je
   * pogrešno računala iz **odgovora**, pa bi svaki legitimni retry izgledao
   * kao ponovna upotreba ključa s drugim payloadom.
   *
   * @returns `true` samo ako je odgovor stvarno sačuvan i može se replayati.
   */
  async complete(
    scope: string,
    key: string,
    reservationToken: string,
    requestHash: string,
    status: number,
    body: unknown,
  ): Promise<boolean> {
    if (!this.redis.isEnabled) return false;
    const client = this.redis.getConnection('api');
    if (!client) return false;

    const serialized = trySerialize(body ?? null);
    if (serialized === undefined) return false;

    const redisKey = this.buildKey(scope, key);
    const existing = safeParse((await client.get(redisKey)) ?? '');
    if (
      !existing ||
      existing.state !== 'in-progress' ||
      existing.reservationToken !== reservationToken ||
      existing.requestHash !== requestHash
    ) {
      return false;
    }

    const completedAt = new Date().toISOString();
    const record: IdempotencyRecord = {
      state: 'completed',
      requestHash,
      reservationToken,
      status,
      body: JSON.parse(serialized) as unknown,
      createdAt: existing.createdAt,
      completedAt,
    };

    await client.set(redisKey, JSON.stringify(record), 'EX', this.ttlSeconds);
    return true;
  }

  /** Neuspješan završetak: oslobađa samo vlastitu rezervaciju. */
  async release(scope: string, key: string, reservationToken: string): Promise<boolean> {
    if (!this.redis.isEnabled) return false;
    const client = this.redis.getConnection('api');
    if (!client) return false;

    const redisKey = this.buildKey(scope, key);
    const existing = safeParse((await client.get(redisKey)) ?? '');
    if (!existing || existing.state !== 'in-progress' || existing.reservationToken !== reservationToken) {
      return false;
    }

    return (await client.del(redisKey)) > 0;
  }

  /** Čita postojeći zapis (dijagnostika/testovi). */
  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    if (!this.redis.isEnabled) return null;
    const client = this.redis.getConnection('readonly') ?? this.redis.getConnection('api');
    if (!client) return null;
    const raw = await client.get(this.buildKey(scope, key));
    return raw ? safeParse(raw) : null;
  }

  /** Ključ mora biti unutar ACL opsega `~vfm:*`. */
  private buildKey(scope: string, key: string): string {
    return `${REDIS_NS.idempotency}:${scope}:${key}`;
  }
}

/** Deterministički hash payloada (stabilan po JSON strukturi). */
export function hashPayload(payload: unknown): string {
  const canonical = canonicalize(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

function safeParse(raw: string): IdempotencyRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<IdempotencyRecord>;
    if (parsed.state !== 'in-progress' && parsed.state !== 'completed') return null;
    if (typeof parsed.requestHash !== 'string' || typeof parsed.createdAt !== 'string') return null;
    if (parsed.reservationToken !== undefined && typeof parsed.reservationToken !== 'string') return null;
    if (
      parsed.status !== undefined &&
      (typeof parsed.status !== 'number' || !Number.isFinite(parsed.status))
    ) {
      return null;
    }
    return parsed as IdempotencyRecord;
  } catch {
    return null;
  }
}

function trySerialize(body: unknown): string | undefined {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array || isStreamLike(body)) return undefined;
  try {
    const serialized = JSON.stringify(body);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_CACHED_BODY_BYTES) {
      return undefined;
    }
    return serialized;
  } catch {
    return undefined;
  }
}

function isStreamLike(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && typeof (value as { pipe?: unknown }).pipe === 'function'
  );
}
