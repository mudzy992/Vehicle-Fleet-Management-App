/**
 * `node dist/tools/healthcheck-worker.js` — compose healthcheck za `worker`.
 *
 * Provjera: čita heartbeat ključ `vfm:metrics:worker:heartbeat` (TTL 90 s,
 * upisuje ga `tools/worker.ts` svakih 30 s).
 *
 * Izlaz:
 * - `0` → worker je živ (heartbeat svjež)
 * - `1` → worker nije živ / Redis nedostupan → compose označava `unhealthy`
 *
 * Compose (`docker-compose.yml`):
 * ```yaml
 * healthcheck:
 *   test: ["CMD", "node", "dist/tools/healthcheck-worker.js"]
 *   interval: 30s
 *   timeout: 10s
 *   retries: 3
 *   start_period: 30s
 * ```
 */
import { inspectEnv } from '../config/env.js';
import { redisConfig } from '@vfm/shared/env';

const HEARTBEAT_KEY = 'vfm:metrics:worker:heartbeat';
/** Heartbeat stariji od ovoga smatra se nevažećim (2× interval upisa + TTL rezerva). */
const MAX_AGE_MS = 120_000;

interface Heartbeat {
  worker?: string;
  pid?: number;
  queues?: number;
  uptimeSeconds?: number;
  at?: string;
}

async function main(): Promise<number> {
  const { env, errors } = inspectEnv();

  if (errors.length > 0) {
    process.stderr.write(`healthcheck: konfiguracija nije ispravna:\n${errors.join('\n')}\n`);
    return 1;
  }

  if (!env.REDIS_HOST) {
    process.stderr.write('healthcheck: REDIS_HOST nije postavljen — worker ne može raditi.\n');
    return 1;
  }

  const config = redisConfig(env, 'worker');

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.password ? { password: config.password } : {}),
      db: config.db,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy: () => null,
      ...(config.tls ? { tls: {} } : {}),
    });

    await client.connect();
    const raw = await client.get(HEARTBEAT_KEY);
    const ttl = await client.ttl(HEARTBEAT_KEY);
    await client.quit().catch(() => client.disconnect());

    if (!raw) {
      process.stderr.write(
        `healthcheck: heartbeat ključ "${HEARTBEAT_KEY}" ne postoji (TTL=${ttl}). ` +
          `Worker se možda nije pokrenuo ili ne može pisati u Redis (ACL ~vfm:*).\n`,
      );
      return 1;
    }

    let heartbeat: Heartbeat;
    try {
      heartbeat = JSON.parse(raw) as Heartbeat;
    } catch {
      process.stderr.write('healthcheck: heartbeat nije ispravan JSON.\n');
      return 1;
    }

    if (heartbeat.at) {
      const age = Date.now() - new Date(heartbeat.at).getTime();
      if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -MAX_AGE_MS) {
        process.stderr.write(`healthcheck: heartbeat je star ${age} ms (max ${MAX_AGE_MS} ms).\n`);
        return 1;
      }
    }

    process.stdout.write(
      `OK worker=${heartbeat.worker ?? 'n/a'} pid=${heartbeat.pid ?? 'n/a'} ` +
        `queues=${heartbeat.queues ?? 'n/a'} uptime=${heartbeat.uptimeSeconds ?? 'n/a'}s\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`healthcheck: Redis nije dostupan — ${message}\n`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 20);
});
