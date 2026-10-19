/**
 * Redis servis — centralna tačka pristupa Redisu (cache, rate limit, locks,
 * idempotencija, SSE, BullMQ konekcije).
 *
 * Ključna svojstva:
 * 1. **ACL-aware, least privilege**: svaka konekcija koristi SVOG ACL korisnika
 *    (`vfm-api`, `vfm-worker`, `vfm-readonly`) s vlastitom lozinkom iz ENV-a
 *    (`REDIS_USER_API`/`REDIS_PASSWORD_API`, …). Nikad `default`.
 *    Vidi `REDIS_ACL.md` — promjena ove mape zahtijeva `ACL LOAD` na Redisu.
 * 2. **Graceful degradation**: ako Redis nije dostupan, API se i dalje podiže —
 *    `isAvailable()` vraća `false`, a operacije koje zahtijevaju Redis bacaju
 *    `DEPENDENCY_UNAVAILABLE` (503). Coolify ne smije upasti u restart petlju.
 * 3. **Bez blokiranja event loopa**: `lazyConnect: true`.
 *
 * ⚠️ Svi ključevi moraju biti unutar `vfm:*` jer je ACL ograničen na `~vfm:*`.
 *    Novi namespace → `REDIS_NS` u `@vfm/shared` **i** `REDIS_ACL.md`.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import { REDIS_NS } from '@vfm/shared';
import type { BaseEnv, RedisConnectionConfig } from '@vfm/shared/env';
import { redisConfig } from '@vfm/shared/env';
import { getEnv } from '../../config/env.js';

/** Imenovane konekcije (mapiraju se na ACL korisnike). */
export type RedisConnectionName = 'api' | 'worker' | 'readonly';

export interface RedisConnectionInfo {
  readonly name: RedisConnectionName;
  readonly user: string;
  readonly ready: boolean;
  readonly status: string;
  readonly errorCount: number;
}

/** Koliko puta pokušavamo reconnect prije nego javimo DOWN. */
const MAX_RECONNECT_ATTEMPTS = 20;

/** BullMQ zahtijeva `maxRetriesPerRequest: null` na svojim konekcijama. */
export function buildRedisOptions(
  config: RedisConnectionConfig,
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    ...(config.password ? { password: config.password } : {}),
    db: config.db,
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > MAX_RECONNECT_ATTEMPTS) return null; // odustani — health javlja DOWN
      return Math.min(times * 200, 5000);
    },
    ...(config.tls ? { tls: { rejectUnauthorized: true } } : {}),
    ...overrides,
  };
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly env: BaseEnv = getEnv();
  private readonly connections = new Map<RedisConnectionName, Redis>();
  private readonly ready = new Map<RedisConnectionName, boolean>();
  private readonly errorCounts = new Map<RedisConnectionName, number>();

  /**
   * Redis je konfigurisan ako je `REDIS_HOST` postavljen.
   * (`ENV_PROFILE=test` ga ne zahtijeva → testovi rade bez Redis-a.)
   */
  get isEnabled(): boolean {
    return Boolean(this.env.REDIS_HOST);
  }

  /** Da li je barem jedna konekcija spremna. */
  isAvailable(): boolean {
    for (const value of this.ready.values()) {
      if (value) return true;
    }
    return false;
  }

  /**
   * Vraća (i po potrebi kreira) konekciju za datu ulogu.
   *
   * - `api`      → `vfm-api`      (cache, locks, idempotencija, SSE)
   * - `worker`   → `vfm-worker`   (BullMQ obrada)
   * - `readonly` → `vfm-readonly` (dijagnostika, health)
   */
  getConnection(name: RedisConnectionName = 'api'): Redis | undefined {
    if (!this.isEnabled) return undefined;

    const existing = this.connections.get(name);
    if (existing) return existing;

    const config = redisConfig(this.env, name);
    const client = new Redis(buildRedisOptions(config));

    client.on('ready', () => {
      this.ready.set(name, true);
      this.logger.log(`Redis konekcija "${name}" spremna (korisnik ${config.username})`);
    });
    client.on('end', () => {
      this.ready.set(name, false);
      this.logger.warn(`Redis konekcija "${name}" zatvorena`);
    });
    client.on('error', (error: Error) => {
      const count = (this.errorCounts.get(name) ?? 0) + 1;
      this.errorCounts.set(name, count);
      this.ready.set(name, false);

      // ACL greška je najčešći uzrok nakon promjene konfiguracije — eksplicitna
      // poruka da vlasnik zna da treba `ACL LOAD` na globalnom Redisu.
      if (/NOPERM|WRONGPASS|invalid password|no permission/iu.test(error.message)) {
        this.logger.error(
          `Redis ACL greška za korisnika "${config.username}": ${error.message}. ` +
            'Provjerite REDIS_ACL.md i učitajte ACL na globalnom Redisu (ACL LOAD).',
        );
      } else if (count <= 3 || count % 50 === 0) {
        this.logger.error(`Redis greška ("${name}", #${count}): ${error.message}`);
      }
    });

    this.connections.set(name, client);
    this.ready.set(name, false);
    this.errorCounts.set(name, 0);

    // Konekcija se uspostavlja asinhrono; ne blokiramo pozivaoca.
    void client.connect().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis "${name}" nije uspostavio konekciju: ${message}`);
    });

    return client;
  }

  /** Vraća konekciju ili baca grešku ako Redis nije konfigurisan. */
  requireConnection(name: RedisConnectionName = 'api'): Redis {
    const client = this.getConnection(name);
    if (!client) {
      throw new Error('Redis nije konfigurisan (REDIS_HOST nije postavljen).');
    }
    return client;
  }

  /** Dijagnostički ping (koristi ga healthcheck). */
  async ping(timeoutMs = 1500): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    if (!this.isEnabled) {
      return { ok: false, latencyMs: 0, message: 'REDIS_HOST nije postavljen' };
    }
    const client = this.getConnection('readonly') ?? this.getConnection('api');
    if (!client) {
      return { ok: false, latencyMs: 0, message: 'Nema Redis konekcije' };
    }

    const started = Date.now();
    try {
      const result = await withTimeout(client.ping(), timeoutMs, 'ping timeout');
      return { ok: result === 'PONG', latencyMs: Date.now() - started, message: result };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Stanje svih konekcija (za `/health/ready` i ops dijagnostiku). */
  getInfo(): readonly RedisConnectionInfo[] {
    return [...this.connections.entries()].map(([name, client]) => ({
      name,
      user: redisConfig(this.env, name).username,
      ready: this.ready.get(name) ?? false,
      status: client.status,
      errorCount: this.errorCounts.get(name) ?? 0,
    }));
  }

  /** Gradi puni Redis ključ s prefiksom: `key('session', jti)` → `vfm:session:<jti>`. */
  key(namespace: keyof typeof REDIS_NS, ...parts: readonly (string | number)[]): string {
    const base = REDIS_NS[namespace];
    return parts.length > 0 ? `${base}:${parts.join(':')}` : base;
  }

  /** TTL u sekundama za cache (s jitterom da se izbjegne "cache stampede"). */
  cacheTtlSeconds(baseSeconds: number, jitterPercent = 10): number {
    const jitter = Math.floor(baseSeconds * (jitterPercent / 100) * Math.random());
    return Math.max(1, baseSeconds + jitter);
  }

  async onModuleDestroy(): Promise<void> {
    const closing = [...this.connections.entries()].map(async ([name, client]) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
      this.logger.debug(`Redis konekcija "${name}" zatvorena`);
    });
    await Promise.allSettled(closing);
    this.connections.clear();
    this.ready.clear();
  }
}

/** Ograničava trajanje async operacije (healthcheck probe). */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
