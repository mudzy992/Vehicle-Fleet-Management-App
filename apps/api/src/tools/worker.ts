/**
 * `node dist/tools/worker.js` — BullMQ worker proces (compose servis `worker`,
 * **replicas: 1** po odluci iz `docs/08-DOCKER_COOLIFY.md`).
 *
 * Odgovornosti:
 * - pokreće po jedan worker za svaki red (`QUEUE_*` iz ENV-a),
 * - emituje **heartbeat** ključ `vfm:metrics:worker:heartbeat` (TTL 90 s) koji
 *   čita `tools/healthcheck-worker.ts` (compose healthcheck),
 * - obrađuje `SIGTERM`/`SIGINT` → graceful drain,
 * - Faza 0: registruje generički handler koji loguje posao. Domena logika
 *   (outbox → FCM, podsjetnici, izvoz) dolazi u Fazama 5 i 7.
 *
 * 🔴 Ako Redis nije dostupan, worker ostaje živ i pokušava ponovo — ne izlazi,
 * jer bi compose healthcheck onda stalno restartovao kontejner.
 */
import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES } from '@vfm/shared';
import type { QueueName } from '@vfm/shared';
import type { BaseEnv } from '@vfm/shared/env';
import { redisConfig } from '@vfm/shared/env';
import { inspectEnv } from '../config/env.js';
import { setupLogger } from '../config/logger.js';
import type { PinoLoggerService } from '../config/logger.js';
import { queueConcurrency, queueFullName } from '../infra/queue/queue.service.js';

const HEARTBEAT_KEY = 'vfm:metrics:worker:heartbeat';
const HEARTBEAT_TTL_SECONDS = 90;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface WorkerContext {
  readonly workers: Worker[];
  logger: PinoLoggerService;
}

async function main(): Promise<number> {
  const { env, errors } = inspectEnv();
  const workerName = `${env.APP_NAME} — worker`;
  const logger = setupLogger({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    serviceName: 'vfm-worker',
    bindings: { tool: 'worker' },
  });

  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    logger.error('Worker se ne može pokrenuti bez ispravne konfiguracije.');
    return 1;
  }

  if (!env.WORKER_ENABLED) {
    logger.warn('WORKER_ENABLED=false — worker neće obrađivati redove. Izlazim.');
    return 0;
  }

  if (!env.REDIS_HOST) {
    logger.error('REDIS_HOST nije postavljen — worker ne može raditi. Provjeri .env.example §6.');
    return 1;
  }

  const config = redisConfig(env, 'worker');
  logger.log(
    `Pokretanje "${workerName}" (Redis ${config.host}:${config.port}, ACL korisnik ${config.username})`,
  );

  const connection = {
    host: config.host,
    port: config.port,
    username: config.username,
    ...(config.password ? { password: config.password } : {}),
    db: config.db,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(config.tls ? { tls: {} } : {}),
  };

  const context: WorkerContext = { workers: [], logger };

  for (const name of QUEUE_NAMES) {
    context.workers.push(createWorker(env, name, connection, logger));
  }

  // Heartbeat (compose healthcheck čita ovaj ključ).
  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat(connection, context.workers.length, logger);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  await writeHeartbeat(connection, context.workers.length, logger);

  // Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Primljen ${signal} — zaustavljam workere (drain)…`);
    clearInterval(heartbeatTimer);

    const closing = context.workers.map(async (worker) => {
      try {
        await worker.close();
      } catch (error) {
        logger.warn(
          `Zatvaranje workera nije uspjelo: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    await Promise.allSettled(closing);
    logger.log('Worker zaustavljen.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      `Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`,
    );
  });
  process.on('uncaughtException', (error: Error) => {
    logger.error(`Uncaught exception: ${error.stack ?? error.message}`);
    process.exit(1);
  });

  logger.log(`Worker spreman — osluškujem ${QUEUE_NAMES.length} redova.`);
  // Proces ostaje živ dok god postoje aktivni workeri.
  return new Promise<number>(() => {
    /* namjerno: drži event loop živim */
  });
}

type RedisConnectionConfig = Record<string, unknown>;

function createWorker(
  env: BaseEnv,
  name: QueueName,
  connection: RedisConnectionConfig,
  logger: PinoLoggerService,
): Worker {
  const full = queueFullName(env, name);

  const worker = new Worker<Record<string, unknown>>(
    full,
    async (job: Job<Record<string, unknown>>) => {
      const startedAt = Date.now();
      logger.log(
        `Obrada posla "${job.name}" (id=${job.id ?? 'n/a'}, red=${full}, pokušaj=${job.attemptsMade + 1})`,
      );

      // Faza 0: generički handler. Domena logika se dodaje po fazama:
      //   Faza 5 → outbox (FCM/in-app), Faza 5 → reminders, Faza 7 → reports.
      await handleJob(name, job, logger);

      logger.log(
        `Posao "${job.name}" završen za ${Date.now() - startedAt} ms (red=${full}, id=${job.id ?? 'n/a'})`,
      );
    },
    {
      connection,
      concurrency: queueConcurrency(env, name),
      lockDuration: 30_000,
      stalledInterval: 30_000,
      prefix: 'bull',
    },
  );

  worker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error(
      `Posao nije uspio (red=${full}, id=${job?.id ?? 'n/a'}, pokušaj=${(job?.attemptsMade ?? 0) + 1}): ${error.message}`,
    );
  });

  worker.on('stalled', (jobId: string) => {
    logger.warn(`Posao ${jobId} u redu ${full} je stalled — biće ponovljen.`);
  });

  worker.on('error', (error: Error) => {
    // ACL/WRONGPASS greške su najčešći uzrok nakon izmjene Redis konfiguracije.
    if (/NOPERM|WRONGPASS|no permission/iu.test(error.message)) {
      logger.error(
        `Redis ACL greška za korisnika "${String(connection.username)}": ${error.message}. ` +
          'Provjerite REDIS_ACL.md i učitajte ACL na globalnom Redisu (ACL LOAD).',
      );
      return;
    }
    logger.error(`Worker greška (${full}): ${error.message}`);
  });

  worker.on('closed', () => {
    logger.log(`Worker za red "${full}" zatvoren.`);
  });

  return worker;
}

/**
 * Faza 0: placeholder obrada po redu.
 *
 * Svaka grana će u odgovarajućoj fazi dobiti stvarnu implementaciju;
 * potpisi i nazivi poslova su već definisani da se izbjegne lomljenje ugovora.
 */
async function handleJob(
  queue: QueueName,
  job: Job<Record<string, unknown>>,
  logger: PinoLoggerService,
): Promise<void> {
  switch (queue) {
    case 'outbox':
      // Faza 5: upis u Notification/FCM + retry + DEAD nakon N pokušaja.
      logger.debug(`[outbox] Faza 0: događaj "${job.name}" primljen, obrada dolazi u Fazi 5.`);
      return;
    case 'notifications':
      // Faza 5: in-app + SSE + FCM.
      logger.debug(`[notifications] Faza 0: "${job.name}" primljen.`);
      return;
    case 'reminders':
      // Faza 5: idempotentni podsjetnici (entity, type, threshold).
      logger.debug(`[reminders] Faza 0: "${job.name}" primljen.`);
      return;
    case 'reports':
      // Faza 7: PDF/Excel generisanje + Download centar.
      logger.debug(`[reports] Faza 0: "${job.name}" primljen.`);
      return;
    case 'maintenance':
      // Faza 8: retencija, čišćenje temp fajlova, reindex.
      logger.debug(`[maintenance] Faza 0: "${job.name}" primljen.`);
      return;
    default: {
      const exhaustive: never = queue;
      logger.warn(`Nepoznat red: ${String(exhaustive)}`);
    }
  }
}

/** Upisuje heartbeat ključ (unutar ACL opsega `~vfm:*`). */
async function writeHeartbeat(
  connection: RedisConnectionConfig,
  queueCount: number,
  logger: PinoLoggerService,
): Promise<void> {
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis({ ...(connection as object), lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    await client.set(
      HEARTBEAT_KEY,
      JSON.stringify({
        worker: 'vfm-worker',
        pid: process.pid,
        queues: queueCount,
        uptimeSeconds: Math.round(process.uptime()),
        at: new Date().toISOString(),
      }),
      'EX',
      HEARTBEAT_TTL_SECONDS,
    );
    await client.quit();
  } catch (error) {
    logger.warn(
      `Heartbeat nije upisan (${error instanceof Error ? error.message : String(error)}) — ` +
        'compose healthcheck će prijaviti worker kao nedostupan.',
    );
  }
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((error: unknown) => {
     
    console.error('Neočekivana greška u worker alatu:', error);
    process.exit(1);
  });
