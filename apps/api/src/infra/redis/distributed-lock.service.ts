/**
 * Distribuirani lock (Redlock-lite na jednom Redisu).
 *
 * Koristi se za:
 * - `vfm:lock:migrate`  → samo jedan `migrate` kontejner pokreće migracije
 *   (compose `migrate` servis + eventualni paralelni deploy);
 * - `vfm:lock:reminder:<…>` → idempotentno generisanje podsjetnika (P-07);
 * - `vfm:lock:task:<id>` → dodatni pojas sigurnosti uz atomski SQL claim (P-04).
 *
 * Implementacija: `SET key token NX PX ttl` + oslobađanje **LUA skriptom** koja
 * provjerava vlasništvo tokena (nikad `DEL` tuđeg locka).
 *
 * ⚠️ Zahtijeva Redis. Ako Redis nije dostupan, `acquire()` baca
 * `DEPENDENCY_UNAVAILABLE` — pozivalac mora odlučiti da li je lock obavezan.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service.js';
import { VfmErrors } from '../../common/filters/all-exceptions.filter.js';

/** LUA: oslobađa lock samo ako token pripada pozivaocu. */
const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
` as const;

/** LUA: produžava lock samo ako token pripada pozivaocu. */
const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
` as const;

export interface AcquiredLock {
  readonly key: string;
  readonly token: string;
  readonly ttlMs: number;
  readonly acquiredAt: number;
}

export interface AcquireOptions {
  /** Vrijeme držanja locka u ms (default 30 000). */
  readonly ttlMs?: number;
  /** Koliko dano čekati na lock u ms (default 0 = bez čekanja). */
  readonly waitMs?: number;
  /** Interval ponovnog pokušaja u ms (default 100). */
  readonly retryDelayMs?: number;
}

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Pokušava uzeti lock. Vraća `AcquiredLock` ili `null` ako je zauzet.
   * Baca 503 ako Redis nije dostupan.
   */
  async acquire(resource: string, options: AcquireOptions = {}): Promise<AcquiredLock | null> {
    const { ttlMs = 30_000, waitMs = 0, retryDelayMs = 100 } = options;

    if (!this.redis.isEnabled) {
      throw VfmErrors.dependencyUnavailable('redis-lock');
    }

    const client = this.redis.requireConnection('api');
    const key = this.redis.key('lock', resource);
    const token = randomUUID();
    const deadline = Date.now() + waitMs;

    do {
      const result = await client.set(key, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return { key, token, ttlMs, acquiredAt: Date.now() };
      }
      if (Date.now() + retryDelayMs > deadline) break;
      await sleep(retryDelayMs);
    } while (Date.now() < deadline);

    this.logger.debug(`Lock "${key}" nije dostupan (zauzet)`);
    return null;
  }

  /** Oslobađa lock. Vraća `true` ako je zaista naš lock oslobođen. */
  async release(lock: AcquiredLock): Promise<boolean> {
    if (!this.redis.isEnabled) return false;
    const client = this.redis.getConnection('api');
    if (!client) return false;

    try {
      const result = await client.eval(UNLOCK_SCRIPT, 1, lock.key, lock.token);
      return Number(result) === 1;
    } catch (error) {
      this.logger.warn(
        `Oslobađanje locka "${lock.key}" nije uspjelo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Produžava lock (za duže operacije, npr. generisanje izvještaja). */
  async extend(lock: AcquiredLock, ttlMs: number): Promise<boolean> {
    if (!this.redis.isEnabled) return false;
    const client = this.redis.getConnection('api');
    if (!client) return false;

    const result = await client.eval(EXTEND_SCRIPT, 1, lock.key, lock.token, String(ttlMs));
    return Number(result) === 1;
  }

  /**
   * Izvršava funkciju pod lockom. Ako lock nije dostupan, vraća
   * `{ acquired: false }` bez pozivanja funkcije.
   */
  async withLock<T>(
    resource: string,
    fn: (lock: AcquiredLock) => Promise<T>,
    options: AcquireOptions = {},
  ): Promise<{ acquired: true; result: T } | { acquired: false }> {
    const lock = await this.acquire(resource, options);
    if (!lock) return { acquired: false };

    try {
      const result = await fn(lock);
      return { acquired: true, result };
    } finally {
      await this.release(lock);
    }
  }

  /** Da li je lock trenutno zauzet (dijagnostika). */
  async isLocked(resource: string): Promise<boolean> {
    if (!this.redis.isEnabled) return false;
    const client = this.redis.getConnection('readonly');
    if (!client) return false;
    const value = await client.exists(this.redis.key('lock', resource));
    return value === 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
