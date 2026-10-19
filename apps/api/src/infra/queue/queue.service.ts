/**
 * BullMQ redovi (Faza 0 infrastruktura; poslovi dolaze u Fazama 5–7).
 *
 * Redovi (nazivi iz `.env.example` §7, ključevi `vfm:queue:<naziv>:*`):
 *   `QUEUE_OUTBOX`         → transakcijski outbox (P-05)
 *   `QUEUE_NOTIFICATIONS`  → in-app + FCM push (P-06/P-07)
 *   `QUEUE_REMINDERS`      → idempotentni podsjetnici (P-07)
 *   `QUEUE_REPORTS`        → PDF/Excel izvoz (P-13)
 *   `QUEUE_MAINTENANCE`    → čišćenje, retencija, reindex
 *
 * ⚠️ **Graceful degradation**: ako Redis nije dostupan, `enqueue()` vraća
 * `{ ok: false }` i loguje upozorenje — API ne pada. Trajno rješenje je
 * transakcijski outbox u bazi (Faza 5): zapis se upiše u istoj transakciji kao
 * i domenska promjena, pa ga worker kasnije prenese u Redis.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES } from '@vfm/shared';
import type { QueueName } from '@vfm/shared';
import type { BaseEnv } from '@vfm/shared/env';
import { redisConfig } from '@vfm/shared/env';
import { RedisService } from '../redis/redis.service.js';
import { getEnv } from '../../config/env.js';

export interface EnqueueResult {
  readonly ok: boolean;
  readonly jobId?: string;
  readonly reason?: string;
}

export interface EnqueueOptions {
  /** BullMQ `jobId` — idempotentnost (npr. `reminder:<entity>:<type>:<threshold>`). */
  readonly jobId?: string;
  readonly delayMs?: number;
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly priority?: number;
}

/** Logičko ime reda → puno ime iz ENV-a (npr. `vfm-queue-outbox`). */
export function queueFullName(env: BaseEnv, name: QueueName): string {
  const map: Record<QueueName, string> = {
    outbox: env.QUEUE_OUTBOX,
    notifications: env.QUEUE_NOTIFICATIONS,
    reminders: env.QUEUE_REMINDERS,
    reports: env.QUEUE_REPORTS,
    maintenance: env.QUEUE_MAINTENANCE,
  };
  return map[name];
}

/** Konkurentnost po redu (iz ENV-a). */
export function queueConcurrency(env: BaseEnv, name: QueueName): number {
  const map: Record<QueueName, number> = {
    outbox: env.WORKER_CONCURRENCY_OUTBOX,
    notifications: env.WORKER_CONCURRENCY_NOTIFICATIONS,
    reminders: env.WORKER_CONCURRENCY_REMINDERS,
    reports: env.WORKER_CONCURRENCY_REPORTS,
    maintenance: 1,
  };
  return map[name];
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly env: BaseEnv = getEnv();
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly redis: RedisService) {}

  /** Da li su redovi dostupni (Redis konfigurisan). */
  get isEnabled(): boolean {
    return this.redis.isEnabled;
  }

  /** Vraća (ili kreira) BullMQ red. */
  getQueue(name: QueueName): Queue | undefined {
    if (!this.isEnabled) return undefined;

    const existing = this.queues.get(name);
    if (existing) return existing;

    const connection = this.buildConnection();
    if (!connection) return undefined;

    const queue = new Queue(queueFullName(this.env, name), {
      connection,
      prefix: 'bull',
      defaultJobOptions: this.defaultJobOptions(),
    });

    queue.on('error', (error: Error) => {
      this.logger.error(`BullMQ greška na redu "${queueFullName(this.env, name)}": ${error.message}`);
    });

    this.queues.set(name, queue);
    this.logger.log(`Red "${queueFullName(this.env, name)}" registrovan`);
    return queue;
  }

  /** Logička imena svih redova. */
  get registeredQueues(): readonly QueueName[] {
    return QUEUE_NAMES;
  }

  /** Dodaje posao u red. Nikad ne baca grešku — vraća `{ ok, jobId?, reason? }`. */
  async enqueue<T>(
    name: QueueName,
    jobName: string,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    if (!this.isEnabled) {
      const reason = 'Redis nije konfigurisan — posao ostaje u outbox tabeli (Faza 5)';
      this.logger.warn(`Enqueue "${name}/${jobName}" preskočen: ${reason}`);
      return { ok: false, reason };
    }

    const queue = this.getQueue(name);
    if (!queue) {
      return { ok: false, reason: 'Red nije mogao biti kreiran' };
    }

    try {
      const jobOptions: JobsOptions = {
        ...(options.jobId ? { jobId: options.jobId } : {}),
        ...(options.delayMs ? { delay: options.delayMs } : {}),
        ...(options.priority ? { priority: options.priority } : {}),
        attempts: options.attempts ?? this.env.QUEUE_MAX_ATTEMPTS,
        backoff: {
          type: this.env.QUEUE_BACKOFF_TYPE,
          delay: options.backoffMs ?? this.env.QUEUE_BACKOFF_DELAY_MS,
        },
        removeOnComplete: { age: this.env.QUEUE_REMOVE_ON_COMPLETE_MS / 1000 },
        removeOnFail: { age: this.env.QUEUE_REMOVE_ON_FAIL_MS / 1000 },
      };

      const job = await queue.add(jobName, data, jobOptions);
      this.logger.debug(`Enqueue "${name}/${jobName}" → job ${job.id ?? 'n/a'}`);
      return { ok: true, jobId: job.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // BullMQ vraća grešku ako job s istim jobId već postoji → to je OK
      // (idempotentnost), pa se ne tretira kao kvar.
      if (/job id .* already exists/iu.test(message)) {
        this.logger.debug(`Job "${name}/${jobName}" već postoji (idempotentno preskočeno)`);
        return { ok: true, jobId: options.jobId, reason: 'duplicate-skipped' };
      }
      this.logger.error(`Enqueue "${name}/${jobName}" nije uspio: ${message}`);
      return { ok: false, reason: message };
    }
  }

  /** Broj poslova po stanju (za `/health/ready` i ops dashboard). */
  async getMetrics(): Promise<
    Record<string, { waiting: number; active: number; delayed: number; failed: number }>
  > {
    const metrics: Record<string, { waiting: number; active: number; delayed: number; failed: number }> = {};
    for (const name of QUEUE_NAMES) {
      const queue = this.queues.get(name);
      if (!queue) continue;
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        metrics[queueFullName(this.env, name)] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        };
      } catch {
        metrics[queueFullName(this.env, name)] = { waiting: -1, active: -1, delayed: -1, failed: -1 };
      }
    }
    return metrics;
  }

  async onModuleDestroy(): Promise<void> {
    const closing = [...this.queues.entries()].map(async ([name, queue]) => {
      try {
        await queue.close();
        this.logger.debug(`Red "${queueFullName(this.env, name)}" zatvoren`);
      } catch (error) {
        this.logger.warn(
          `Zatvaranje reda "${queueFullName(this.env, name)}" nije uspjelo: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
    await Promise.allSettled(closing);
    this.queues.clear();
  }

  /** BullMQ upravlja vlastitim konekcijama (traži `maxRetriesPerRequest: null`). */
  private buildConnection(): ConnectionOptions | undefined {
    if (!this.redis.isEnabled) return undefined;
    const config = redisConfig(this.env, 'worker');
    return {
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.password ? { password: config.password } : {}),
      db: config.db,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      ...(config.tls ? { tls: {} } : {}),
    };
  }

  private defaultJobOptions(): JobsOptions {
    return {
      attempts: this.env.QUEUE_MAX_ATTEMPTS,
      backoff: { type: this.env.QUEUE_BACKOFF_TYPE, delay: this.env.QUEUE_BACKOFF_DELAY_MS },
      removeOnComplete: { age: this.env.QUEUE_REMOVE_ON_COMPLETE_MS / 1000 },
      removeOnFail: { age: this.env.QUEUE_REMOVE_ON_FAIL_MS / 1000 },
    };
  }
}
