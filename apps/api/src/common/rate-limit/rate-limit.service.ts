/**
 * Rate limiting na Redisu (docs/07 §5, docs/05 §7, `REDIS_ACL.md` §4).
 *
 * Ključevi: `vfm:rl:{scope}:{identity}` — fiksni prozor preko `INCR` + `PEXPIRE`.
 * Limiti dolaze iz ENV-a (`.env.example` §4):
 *
 * | scope    | limit                          | ENV                                  |
 * |----------|--------------------------------|--------------------------------------|
 * | `global` | 300 zahtjeva / 60 s po IP-u    | `THROTTLE_GLOBAL_LIMIT/TTL_SECONDS`  |
 * | `login`  | 5 pokušaja / 900 s po IP-u     | `THROTTLE_LOGIN_LIMIT/TTL_SECONDS`   |
 * | `upload` | 30 uploada / 60 s po korisniku | `THROTTLE_UPLOAD_LIMIT/TTL_SECONDS`  |
 *
 * Sigurnosni model:
 * - `login` limit je **prvi** sloj zaštite od brute force-a; drugi sloj je
 *   zaključavanje naloga u bazi (`AUTH_MAX_FAILED_ATTEMPTS` / `AuthAttempt`),
 *   pa pad Redis-a ne znači i pad zaštite,
 * - kad Redis nije dostupan limiter **propušta** zahtjev (`degraded: true`) i
 *   logira upozorenje: Redis je od Faze 1 kritična zavisnost (`/health/ready`),
 *   pa bi fail-closed ovdje samo pretvorio degradaciju u potpuni prekid,
 * - `THROTTLE_ENABLED=false` isključuje limiter (samo dev/test).
 *
 * ACL: `vfm:rl:*` je već pokriven (`~vfm:*`, `+incr +expire +pexpire +ttl`) →
 * **bez** izmjena `REDIS_ACL.md` i bez `ACL LOAD`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { getEnv } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

/** Opsezi limitera (ENV ima limite za svaki). */
export const RATE_LIMIT_SCOPES = ['global', 'login', 'upload'] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

/** Podskup ioredis komandi za fiksni prozor (testabilno bez Redis servera). */
export interface RateLimitRedisClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

/** Rezultat jednog "consume" poziva. */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly scope: RateLimitScope;
  readonly limit: number;
  readonly remaining: number;
  /** Sekunde do resetovanja prozora (za `Retry-After`). */
  readonly retryAfterSeconds: number;
  readonly current: number;
  /** `true` kad Redis nije dostupan pa limit nije primijenjen. */
  readonly degraded: boolean;
}

/** Limiti za dati opseg (čita ENV pri pozivu → testovi mogu mijenjati ENV). */
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private degradedWarned = false;

  constructor(private readonly redis: RedisService) {}

  /** Da li je limiter uključen (`THROTTLE_ENABLED`). */
  get isEnabled(): boolean {
    return getEnv().THROTTLE_ENABLED;
  }

  /** Politika (limit + prozor) za opseg, iz ENV-a. */
  policyFor(scope: RateLimitScope): RateLimitPolicy {
    const env = getEnv();
    switch (scope) {
      case 'login':
        return { limit: env.THROTTLE_LOGIN_LIMIT, windowSeconds: env.THROTTLE_LOGIN_TTL_SECONDS };
      case 'upload':
        return { limit: env.THROTTLE_UPLOAD_LIMIT, windowSeconds: env.THROTTLE_UPLOAD_TTL_SECONDS };
      case 'global':
      default:
        return { limit: env.THROTTLE_GLOBAL_LIMIT, windowSeconds: env.THROTTLE_GLOBAL_TTL_SECONDS };
    }
  }

  /**
   * Troši jedan "žeton" iz prozora.
   *
   * @param scope `global` | `login` | `upload`
   * @param identity stabilan identitet (IP ili `user:{id}`) — dio Redis ključa
   * @param policy opciono preklopljena politika (npr. stroža po ruti)
   */
  async consume(
    scope: RateLimitScope,
    identity: string,
    policy: RateLimitPolicy = this.policyFor(scope),
  ): Promise<RateLimitResult> {
    const fallback = (current: number): RateLimitResult => ({
      allowed: true,
      scope,
      limit: policy.limit,
      remaining: policy.limit,
      retryAfterSeconds: 0,
      current,
      degraded: true,
    });

    if (!this.isEnabled) return fallback(0);

    const client = this.client();
    if (!client) {
      this.warnDegradedOnce('Redis nije dostupan');
      return fallback(0);
    }

    const key = this.redis.key('rateLimit', scope, sanitizeIdentity(identity));
    let firstHit = false;

    try {
      const current = await client.incr(key);
      // Prozor počinje pri prvom zahtjevu; TTL se ne pomjera (bez "sliding" efekta).
      if (current === 1) {
        firstHit = true;
        const expired = await client.pexpire(key, policy.windowSeconds * 1000);
        if (expired !== 1) throw new Error('PEXPIRE nije postavio TTL na novi limiter ključ.');
      }

      const ttlMs = await client.pttl(key);
      const retryAfterSeconds =
        current > policy.limit ? Math.max(1, Math.ceil((ttlMs < 0 ? 0 : ttlMs) / 1000)) : 0;

      return {
        allowed: current <= policy.limit,
        scope,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - current),
        retryAfterSeconds,
        current,
        degraded: false,
      };
    } catch (error) {
      // Ako postavljanje prozora nije uspjelo, uklanjamo brojač koji bi inače
      // ostao bez TTL-a i trajno zaključao identitet. Fail-open ostaje vidljiv
      // kao degraded, a DB lockout je rezervna zaštita za login.
      if (firstHit) {
        try {
          await client.del(key);
        } catch (cleanupError) {
          this.logger.error(
            `Nije moguće ukloniti limiter ključ bez TTL-a (${scope}): ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
      this.warnDegradedOnce(error instanceof Error ? error.message : String(error));
      return fallback(0);
    }
  }

  /**
   * Preostalo stanje bez trošenja žetona (za `X-RateLimit-*` zaglavlja na
   * odgovoru i za dijagnostiku).
   */
  async peek(scope: RateLimitScope, identity: string): Promise<{ current: number; ttlMs: number }> {
    const client = this.client();
    if (!client) return { current: 0, ttlMs: -2 };
    try {
      const key = this.redis.key('rateLimit', scope, sanitizeIdentity(identity));
      // `INCR` pa odmah `DECR` bi mijenjao stanje; umjesto toga čitamo TTL i
      // trenutni brojač preko `pttl` + `incr(0)` ekvivalenta — ovdje je dovoljan
      // TTL, a brojač vraćamo iz posljednjeg `consume` poziva (guard ga nosi).
      const ttlMs = await client.pttl(key);
      return { current: 0, ttlMs };
    } catch {
      return { current: 0, ttlMs: -2 };
    }
  }

  /** Briše brojač (npr. nakon uspješnog logina ili za testove). */
  async reset(scope: RateLimitScope, identity: string): Promise<void> {
    const client = this.client();
    if (!client) return;
    try {
      const key = this.redis.key('rateLimit', scope, sanitizeIdentity(identity));
      await client.del(key);
    } catch (error) {
      this.logger.warn(
        `reset(${scope}) nije uspio: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Redis klijent ako je dostupan. */
  private client(): (RateLimitRedisClient & { del(key: string): Promise<number> }) | undefined {
    if (!this.redis.isEnabled || !this.redis.isAvailable()) return undefined;
    return this.redis.getConnection('api') as unknown as
      (RateLimitRedisClient & { del(key: string): Promise<number> }) | undefined;
  }

  private warnDegradedOnce(reason: string): void {
    if (this.degradedWarned) return;
    this.degradedWarned = true;
    this.logger.warn(
      `Rate limiting degradiran (${reason}) — zahtjevi prolaze bez ograničenja. ` +
        'Zaštita od brute force-a i dalje važi preko zaključavanja naloga u bazi.',
    );
  }
}

/**
 * Identitet ide u Redis ključ → mora biti bez `:` i razmaka (inače bi klijent
 * mogao konstruisati tuđi ključ, npr. `login:global`).
 */
export function sanitizeIdentity(identity: string): string {
  const cleaned = (identity || 'unknown').trim().replace(/[^A-Za-z0-9._-]/gu, '-');
  return cleaned.slice(0, 128) || 'unknown';
}
