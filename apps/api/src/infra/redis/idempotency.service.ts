/**
 * Idempotencija zahtjeva (P-06, docs/05 §9).
 *
 * Klijent šalje `Idempotency-Key: <uuid>` uz mutacijske zahtjeve (POST/PATCH).
 * Server pamti:
 *   `vfm:idem:<userId>:<key>` → `{ requestHash, status, body, completedAt }`
 *
 * Pravila:
 * - **Isti ključ + isti payload** → vraća se sačuvani odgovor (bez ponovnog
 *   izvršavanja operacije).
 * - **Isti ključ + drugi payload** → `422 IDEMPOTENCY_KEY_REUSED` (P-06).
 * - **Zahtjev u toku** → `409 VERSION_CONFLICT`? Ne: vraća se `425 Too Early`
 *   ekvivalent kroz `IDEMPOTENCY_IN_PROGRESS` logiku — ovdje pojednostavljeno:
 *   drugi paralelni zahtjev dobija sačuvani `in-progress` marker i čeka/odustaje.
 * - TTL 24 h (`IDEMPOTENCY_RETENTION_HOURS`, docs/03 §6).
 *
 * ⚠️ Bez Redis-a idempotencija ne radi (503 za mutacije koje je zahtijevaju) —
 *    zato je Redis obavezan od Faze 1 (odluka vlasnika: Redis full stack).
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_RETENTION_HOURS, REDIS_NS } from '@vfm/shared';
import { RedisService } from './redis.service.js';
import { VfmException } from '../../common/filters/all-exceptions.filter.js';

/** Stanje idempotency zapisa. */
export type IdempotencyState = 'in-progress' | 'completed';

export interface IdempotencyRecord {
  readonly state: IdempotencyState;
  readonly requestHash: string;
  readonly status?: number;
  readonly body?: unknown;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface IdempotencyDecision {
  /** `execute` → nastavi s handlerom; `replay` → vrati sačuvani odgovor; `conflict` → 422. */
  readonly action: 'execute' | 'replay' | 'conflict';
  readonly record?: IdempotencyRecord;
  readonly reservationToken?: string;
}

/** Maksimalna veličina sačuvanog odgovora (veće se ne keširaju). */
const MAX_CACHED_BODY_BYTES = 64 * 1024;

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
   * @param payload tijelo zahtjeva (za hash)
   */
  async reserve(scope: string, key: string, payload: unknown): Promise<IdempotencyDecision> {
    if (!this.redis.isEnabled) {
      throw new VfmException(
        'DEPENDENCY_UNAVAILABLE',
        'Idempotencija zahtijeva Redis. Servis je privremeno nedostupan.',
      );
    }

    const client = this.redis.requireConnection('api');
    const redisKey = this.buildKey(scope, key);
    const requestHash = hashPayload(payload);
    const reservationToken = randomUUID();

    const existingRaw = await client.get(redisKey);

    if (existingRaw) {
      const existing = safeParse(existingRaw);
      if (!existing) {
        // Oštećen zapis → prepiši (bolje nego blokirati korisnika).
        this.logger.warn(`Neispravan idempotency zapis za "${redisKey}" — prepisujem.`);
      } else if (existing.requestHash !== requestHash) {
        return { action: 'conflict', record: existing };
      } else if (existing.state === 'completed') {
        return { action: 'replay', record: existing };
      } else {
        // Zahtjev je još u obradi: klijent treba pokušati ponovo.
        return { action: 'conflict', record: existing };
      }
    }

    const reserved: IdempotencyRecord = {
      state: 'in-progress',
      requestHash,
      createdAt: new Date().toISOString(),
    };

    const ok = await client.set(redisKey, JSON.stringify(reserved), 'EX', this.ttlSeconds, 'NX');
    if (ok !== 'OK') {
      // Neko drugi je rezervisao u međuvremenu → pročitaj i odluči.
      const raced = safeParse((await client.get(redisKey)) ?? '');
      if (raced && raced.requestHash !== requestHash) {
        return { action: 'conflict', record: raced };
      }
      if (raced?.state === 'completed') {
        return { action: 'replay', record: raced };
      }
      return { action: 'conflict', record: raced ?? undefined };
    }

    return { action: 'execute', reservationToken };
  }

  /** Uspješan završetak: sačuva odgovor za replikaciju. */
  async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    if (!this.redis.isEnabled) return;
    const client = this.redis.getConnection('api');
    if (!client) return;

    const redisKey = this.buildKey(scope, key);
    const serialized = body === undefined ? undefined : trySerialize(body);

    const record: IdempotencyRecord = {
      state: 'completed',
      requestHash: hashPayload(body),
      status,
      ...(serialized ? { body: JSON.parse(serialized) as unknown } : {}),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    await client.set(redisKey, JSON.stringify(record), 'EX', this.ttlSeconds);
  }

  /** Neuspješan završetak: oslobađa ključ da klijent može pokušati ponovo. */
  async release(scope: string, key: string): Promise<void> {
    if (!this.redis.isEnabled) return;
    const client = this.redis.getConnection('api');
    if (!client) return;
    await client.del(this.buildKey(scope, key));
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
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

function safeParse(raw: string): IdempotencyRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<IdempotencyRecord>;
    if (typeof parsed.state !== 'string' || typeof parsed.requestHash !== 'string') return null;
    return parsed as IdempotencyRecord;
  } catch {
    return null;
  }
}

function trySerialize(body: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(body);
    if (serialized.length > MAX_CACHED_BODY_BYTES) return undefined;
    return serialized;
  } catch {
    return undefined;
  }
}
