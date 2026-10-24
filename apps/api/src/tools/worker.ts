/**
 * `node dist/tools/worker.js` — BullMQ worker proces (compose servis `worker`,
 * **replicas: 1** po odluci iz `docs/08-DOCKER_COOLIFY.md`).
 *
 * Odgovornosti:
 * - pokreće po jedan worker za svaki red (`QUEUE_*` iz ENV-a),
 * - koristi BullMQ prefiks `vfm:queue` → ključevi `vfm:queue:<red>:*` su unutar
 *   ACL opsega `~vfm:*` (`REDIS_ACL.md` §4); pri pokretanju **fail-fast** provjerava
 *   da nijedan ključ nije izvan tog opsega (inače bi Redis vraćao `NOPERM`),
 * - jednokratno proba ACL na stvarnom Redisu (`vfm:queue:_acl-probe`) da odmah
 *   razlikuje pogrešan prefiks u kodu od ACL-a bez `~vfm:*` na serveru,
 * - emituje **heartbeat** ključ `vfm:metrics:worker:heartbeat` (TTL 90 s) koji
 *   čita `tools/healthcheck-worker.ts` (compose healthcheck),
 * - obrađuje `SIGTERM`/`SIGINT` → graceful drain,
 * - Faza 0: registruje generički handler koji loguje posao. Domena logika
 *   (outbox → FCM, podsjetnici, izvoz) dolazi u Fazama 5 i 7.
 *
 * 🔴 Ako Redis nije dostupan, worker ostaje živ i pokušava ponovo — ne izlazi,
 * jer bi compose healthcheck onda stalno restartovao kontejner.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, REDIS_ACL_KEY_PATTERN } from '@vfm/shared';
import type { QueueName } from '@vfm/shared';
import type { BaseEnv } from '@vfm/shared/env';
import { queueKeyPrefix, redisConfig, validateRedisAclScope } from '@vfm/shared/env';
import { inspectEnv } from '../config/env.js';
import { setupLogger } from '../config/logger.js';
import type { PinoLoggerService } from '../config/logger.js';
import { queueConcurrency, queueFullName } from '../infra/queue/queue.service.js';
import { redisTlsOptions } from '../infra/redis/redis-tls.js';
import { REMINDER_SCAN_JOB, scheduleReminderScan } from '../infra/queue/reminder-scheduler.js';
import { runReminderScanJob } from '../infra/queue/reminder-job.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildPrismaAdapter, prismaConnectionOptions } from '../prisma/prisma.service.js';

const HEARTBEAT_KEY = 'vfm:metrics:worker:heartbeat';
const HEARTBEAT_TTL_SECONDS = 90;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Startna ACL proba: `<BullMQ prefiks>:_acl-probe` (REDIS_ACL.md §4). */
const ACL_PROBE_SUFFIX = '_acl-probe';
const ACL_PROBE_TTL_SECONDS = 30;

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

  // ACL opseg (REDIS_ACL.md §1 i §4): BullMQ gradi ključeve `<prefix>:<red>:<suffix>`,
  // pa prefiks MORA biti unutar `~vfm:*`. Fail-fast — inače Redis na svaku komandu
  // vraća `NOPERM ... no permissions to access a key` i log se preplavi greškama.
  const aclProblems = validateRedisAclScope(env);
  if (aclProblems.length > 0) {
    for (const problem of aclProblems) logger.error(problem);
    logger.error(
      `Worker se ne može pokrenuti: Redis ključevi nisu unutar ACL opsega ${REDIS_ACL_KEY_PATTERN}. ` +
        'Ispravite VFM_REDIS_KEY_PREFIX / QUEUE_* u Coolify ENV-u ili ažurirajte ACL fajl ' +
        'na globalnom Redisu (REDIS_ACL.md §1, pa ACL LOAD).',
    );
    return 1;
  }

  const config = redisConfig(env, 'worker');
  const prefix = queueKeyPrefix(env);
  logger.log(
    `Pokretanje "${workerName}" (Redis ${config.host}:${config.port}, ACL korisnik ${config.username}, ` +
      `prefiks ključeva "${prefix}" → ${prefix}:<red>:* unutar ${REDIS_ACL_KEY_PATTERN})`,
  );

  const tls = redisTlsOptions(config);
  const connection = {
    host: config.host,
    port: config.port,
    username: config.username,
    ...(config.password ? { password: config.password } : {}),
    db: config.db,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(tls ? { tls } : {}),
  };

  const context: WorkerContext = { workers: [], logger };

  // Startna provjera na stvarnom Redisu: razlikuje naš (pogrešan) prefiks od
  // ACL-a koji na serveru nema `~vfm:*` — oba daju isti `NOPERM` u logu.
  // Nije fatalna: ako Redis trenutno nije dostupan, worker ostaje živ i pokušava
  // ponovo (compose healthcheck ne smije upasti u restart petlju).
  await probeRedisAcl(connection, prefix, config.username, logger);

  for (const name of QUEUE_NAMES) {
    context.workers.push(createWorker(env, name, connection, prefix, logger));
  }

  // Dnevni skener podsjetnika (06:00 Europe/Sarajevo). `upsertJobScheduler` je
  // idempotentan — restart ne pravi novi raspored. Ako Redis nije dostupan,
  // worker ostaje živ (kao i za redove) i pokušava ponovo pri sljedećem startu.
  const reminderQueue = new Queue(queueFullName(env, 'reminders'), { connection, prefix });
  try {
    await scheduleReminderScan(reminderQueue);
    logger.log('Podsjetnici: skener zakazan za 06:00 Europe/Sarajevo.');
  } catch (error) {
    logger.warn(
      `Podsjetnici: zakazivanje skenera nije uspjelo (${
        error instanceof Error ? error.message : String(error)
      }) — red radi, cron se dodaje pri sljedećem startu.`,
    );
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
    await reminderQueue.close().catch(() => undefined);
    logger.log('Worker zaustavljen.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
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
  prefix: string,
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
      await handleJob(name, job, logger, env);

      logger.log(
        `Posao "${job.name}" završen za ${Date.now() - startedAt} ms (red=${full}, id=${job.id ?? 'n/a'})`,
      );
    },
    {
      connection,
      concurrency: queueConcurrency(env, name),
      lockDuration: 30_000,
      stalledInterval: 30_000,
      // 🔴 ACL (REDIS_ACL.md §1 i §4): BullMQ gradi ključeve `<prefix>:<red>:<suffix>`,
      //    pa prefiks mora biti `vfm:queue` → ključevi `vfm:queue:vfm-queue-outbox:wait`.
      //    BullMQ default `'bull'` bi dao `bull:vfm-queue-outbox:wait`, što je IZVAN
      //    ACL opsega `~vfm:*` → Redis vraća NOPERM i red ne radi.
      prefix,
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
        `Redis ACL greška za korisnika "${String(connection.username)}" (red "${full}", ` +
          `prefiks ključeva "${prefix}" → npr. ${prefix}:${full}:wait): ${error.message}. ` +
          `Svi ključevi moraju biti unutar ${REDIS_ACL_KEY_PATTERN} — provjerite REDIS_ACL.md §1/§4 ` +
          'i učitajte ACL na globalnom Redisu (ACL LOAD).',
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
  env: BaseEnv,
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
      // P-07: dnevni skener u 06:00 Europe/Sarajevo; idempotentan kroz dedupeKey.
      if (job.name === REMINDER_SCAN_JOB) {
        await runReminderScanJob(
          logger,
          () => new PrismaClient({ adapter: buildPrismaAdapter(prismaConnectionOptions(env)) }),
        );
        return;
      }
      logger.debug(`[reminders] Nepoznat posao "${job.name}" — preskočen.`);
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

/**
 * Jednokratna provjera ACL opsega na stvarnom Redisu.
 *
 * Upisuje i odmah briše ključ `<prefiks>:_acl-probe` (npr. `vfm:queue:_acl-probe`,
 * TTL 30 s) koristeći **iste** kredencijale kao BullMQ. Rezultat razlikuje dva
 * uzroka iste `NOPERM` greške (REDIS_ACL.md §6):
 * 1. naš ključ je izvan `~vfm:*` (pogrešan BullMQ `prefix`), ili
 * 2. ACL user `vfm-worker` na serveru uopšte nema pattern `~vfm:*`
 *    (`ACL SETUSER … ~vfm:* …` + `ACL SAVE`).
 */
async function probeRedisAcl(
  connection: RedisConnectionConfig,
  prefix: string,
  username: string,
  logger: PinoLoggerService,
): Promise<boolean> {
  const probeKey = `${prefix}:${ACL_PROBE_SUFFIX}`;
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis({
      ...(connection as object),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy: () => null,
    });
    await client.connect();
    await client.set(probeKey, 'acl-probe', 'EX', ACL_PROBE_TTL_SECONDS);
    await client.del(probeKey);
    await client.quit().catch(() => client.disconnect());
    logger.log(
      `ACL provjera prošla: korisnik "${username}" smije pisati na "${probeKey}" ` +
        `(opseg ${REDIS_ACL_KEY_PATTERN}).`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/NOPERM|WRONGPASS|no permission/iu.test(message)) {
      logger.error(
        `ACL provjera NIJE prošla: korisnik "${username}" ne smije pisati na "${probeKey}" — ${message}. ` +
          `Ključ JE unutar ${REDIS_ACL_KEY_PATTERN}, pa problem nije u kodu: ACL user na globalnom Redisu ` +
          `nema pattern \`~vfm:*\` (ili je lozinka pogrešna). Provjerite \`ACL LIST\` / \`ACL GETUSER ${username}\` ` +
          'i popravite ACL fajl (REDIS_ACL.md §1 i §6, pa `ACL LOAD` + `ACL SAVE`).',
      );
      return false;
    }
    logger.warn(
      `ACL provjera nije izvršena (Redis nedostupan ili sporo odgovara): ${message}. ` +
        'Worker nastavlja s radom i pokušava ponovo.',
    );
    return false;
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
    const message = error instanceof Error ? error.message : String(error);
    if (/NOPERM|WRONGPASS|no permission/iu.test(message)) {
      logger.error(
        `Heartbeat nije upisan (${HEARTBEAT_KEY}) zbog Redis ACL greške: ${message}. ` +
          `Ključ je unutar ${REDIS_ACL_KEY_PATTERN} → provjerite ACL usera na globalnom Redisu ` +
          '(REDIS_ACL.md §1 i §6: `ACL GETUSER vfm-worker`, pa `ACL LOAD` + `ACL SAVE`).',
      );
      return;
    }
    logger.warn(
      `Heartbeat nije upisan (${message}) — ` + 'compose healthcheck će prijaviti worker kao nedostupan.',
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
