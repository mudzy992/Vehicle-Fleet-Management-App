/**
 * Redis health indikator (Terminus 12 API).
 *
 * Terminus 12 je uklonio `HealthIndicator` baznu klasu i `HealthCheckError`;
 * sada se koristi `HealthIndicatorService`:
 *   `check(key).up(data)` / `.degraded(data)` / `.down(data)`
 * Rezultat `down` ruši readiness; `degraded` ga ne ruši (status 200, overall
 * `degraded`).
 *
 * Politika:
 * - `REDIS_HOST` nije postavljen → `up` s napomenom (lokalni razvoj bez infra).
 * - Redis dostupan (PING < 1.5 s) → `up` s latencijom.
 * - ACL greška (`NOPERM`/`WRONGPASS`) → `down` s eksplicitnom uputom na
 *   `REDIS_ACL.md` i `ACL LOAD` (najčešći uzrok nakon izmjene globalnog ACL-a).
 * - Nedostupan bez ACL greške → `down`.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { type HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../infra/redis/redis.service.js';

export interface RedisHealthDetails {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly latencyMs: number;
  readonly message: string;
  readonly connections: number;
  readonly aclIssue: boolean;
  /** Dozvoljava prosljeđivanje Terminusu (traži index signature). */
  readonly [key: string]: unknown;
}

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const details = await this.probe();

    if (!details.enabled) {
      // Namjerno isključen → ne ruši readiness, ali je jasno označeno.
      return indicator.up({ ...details, note: 'Redis je isključen konfiguracijom' });
    }

    if (details.available) {
      return indicator.up(details);
    }

    return indicator.down(details);
  }

  async probe(): Promise<RedisHealthDetails> {
    if (!this.redis.isEnabled) {
      return {
        enabled: false,
        available: false,
        latencyMs: 0,
        message: 'REDIS_HOST nije postavljen (cache/rate limit/redovi isključeni)',
        connections: 0,
        aclIssue: false,
      };
    }

    const ping = await this.redis.ping();
    const info = this.redis.getInfo();
    const aclIssue = /NOPERM|WRONGPASS|no permission/iu.test(ping.message ?? '');

    return {
      enabled: true,
      available: ping.ok,
      latencyMs: ping.latencyMs,
      message: aclIssue
        ? `Redis ACL problem za korisnike vfm-*: ${ping.message ?? ''}. Učitajte ACL (ACL LOAD) — vidi REDIS_ACL.md.`
        : (ping.message ?? (ping.ok ? 'PONG' : 'nedostupan')),
      connections: info.length,
      aclIssue,
    };
  }
}
