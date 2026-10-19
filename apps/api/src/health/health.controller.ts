/**
 * Health kontroler (Terminus 12).
 *
 * Endpointi su IZVAN globalnog prefiksa `/api/v1` (vidi `main.ts`
 * → `setGlobalPrefix(..., { exclude: [...] })`) jer ih zovu Docker/Coolify:
 *
 * | Putanja           | Namjena                                     | HTTP |
 * |-------------------|---------------------------------------------|------|
 * | `/health/live`    | liveness — proces radi                      | 200  |
 * | `/health/ready`   | readiness — Redis (kritičan), DB, disk      | 200/503 |
 * | `/health/startup` | startup — boot završen                      | 200  |
 * | `/health/diagnostics` | dijagnostika (od Faze 1 iza `system:view`) | 200 |
 *
 * ⚠️ `/health/live` **ne smije** provjeravati zavisnosti: inače Coolify
 * restartuje kontejner pri svakom mrežnom treptaju (restart petlja).
 *
 * Odgovori su bez API envelope-a (`ApiEnvelopeInterceptor` preskače `/health`).
 */
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health-indicator.js';
import { DatabaseHealthIndicator } from './database.health-indicator.js';
import { DiskHealthIndicator } from './disk.health-indicator.js';
import { getEnv } from '../config/env.js';
import { QueueService } from '../infra/queue/queue.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { OutboxService } from '../infra/queue/outbox.service.js';

/** Vrijeme pokretanja procesa (uptime + startup). */
const STARTED_AT = Date.now();

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly databaseHealth: DatabaseHealthIndicator,
    private readonly diskHealth: DiskHealthIndicator,
    private readonly queues: QueueService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Liveness: proces je živ. **Bez** provjere zavisnosti.
   * Compose: `wget -q -S --spider http://localhost:3000/health/live`
   */
  @Get('live')
  liveness(): { status: 'ok'; uptimeSeconds: number; at: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      at: new Date().toISOString(),
    };
  }

  /**
   * Readiness: zavisnosti potrebne za obradu zahtjeva.
   *
   * Politika (Faza 0):
   * - **Redis** → kritičan od Faze 1 (cache, locks, rate limit, redovi).
   * - **Postgres** → u Fazi 0 `degraded` jer Prisma client još nije povezan
   *   (vidi `infra/database/database.module.ts`). Od Faze 1 postaje kritičan.
   * - **Disk (prilozi)** → `degraded` < 1 GB, `down` < 256 MB slobodno.
   */
  @Get('ready')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.redisHealth.isHealthy('redis'),
      (): Promise<HealthIndicatorResult> => this.databaseHealth.isHealthy('database'),
      (): Promise<HealthIndicatorResult> => this.diskHealth.isHealthy('storage'),
    ]);
  }

  /** Startup: boot je završen (compose `start_period` provjera). */
  @Get('startup')
  startup(): {
    status: 'ok';
    startedAt: string;
    uptimeSeconds: number;
    env: { node: string; app: string; profile: string };
  } {
    const env = getEnv();
    return {
      status: 'ok',
      startedAt: new Date(STARTED_AT).toISOString(),
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      env: { node: env.NODE_ENV, app: env.APP_ENV, profile: env.ENV_PROFILE },
    };
  }

  /**
   * Dijagnostika (od Faze 1 iza `system:view_*` permisije): konekcije, redovi,
   * outbox buffer i baza.
   */
  @Get('diagnostics')
  async diagnostics(): Promise<Record<string, unknown>> {
    const env = getEnv();
    return {
      service: env.APP_NAME,
      profile: env.ENV_PROFILE,
      env: `${env.NODE_ENV}/${env.APP_ENV}`,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      redis: {
        enabled: this.redis.isEnabled,
        available: this.redis.isAvailable(),
        connections: this.redis.getInfo(),
      },
      queues: {
        enabled: this.queues.isEnabled,
        names: this.queues.registeredQueues,
        metrics: await this.queues.getMetrics(),
      },
      outbox: {
        bufferedEvents: this.outbox.bufferedCount,
        droppedEvents: this.outbox.droppedEventCount,
      },
      database: await this.databaseHealth.probe(),
    };
  }
}
