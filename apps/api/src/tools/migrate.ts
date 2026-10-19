/**
 * `node dist/tools/migrate.js` — compose servis `migrate`.
 *
 * Šta radi:
 * 1. Validira ENV za profil `tool` (`ENV_PROFILE=tool` postavlja compose).
 * 2. Čeka da Postgres prihvati konekcije (`pg_isready` ekvivalent kroz TCP).
 * 3. Uzima Redis lock `vfm:lock:migrate` (sprječava paralelne deploy-e).
 * 4. Pokreće `prisma migrate deploy` nad `prisma/schema.prisma`.
 * 5. (Opciono) `--seed` pokreće seed skriptu.
 * 6. Oslobađa lock i izlazi s kodom 0/1 → compose `service_completed_successfully`.
 *
 * 🔴 **Faza 0 status:** `prisma` CLI još nije instaliran u `apps/api` (engine
 * binarni fajlovi se preuzimaju s `binaries.prisma.sh`, koji u sandboxu nije
 * dostupan). Alat je **potpuno napisan** i prijavljuje jasnu poruku ako Prisma
 * nedostaje, umjesto da tiho prođe. Aktivacija:
 * ```bash
 * pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1
 * pnpm prisma:generate
 * ```
 * Vidi `apps/api/prisma/README.md`.
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { redisConfig } from '@vfm/shared/env';
import type { BaseEnv } from '@vfm/shared/env';
import { inspectEnv } from '../config/env.js';
import { setupLogger } from '../config/logger.js';

const LOCK_KEY = 'vfm:lock:migrate';
const LOCK_TTL_MS = 5 * 60 * 1000;
const PG_WAIT_TIMEOUT_MS = 60_000;
const PG_WAIT_INTERVAL_MS = 2_000;

interface CliOptions {
  readonly seed: boolean;
  readonly skipLock: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  return {
    seed: argv.includes('--seed'),
    skipLock: argv.includes('--skip-lock'),
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const { env, errors } = inspectEnv();
  const logger = setupLogger({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    serviceName: 'vfm-migrate',
    bindings: { tool: 'migrate', profile: 'tool' },
  });

  logger.log(`Pokretanje migracija (profil=${env.ENV_PROFILE}, env=${env.NODE_ENV})`);

  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    logger.error('Migracije se ne mogu pokrenuti bez ispravne konfiguracije.');
    return 1;
  }

  // 1) Čekaj Postgres (compose diže `migrate` prije `api`, ali globalni DB može
  //    biti sporiji ili se restartovati).
  const dbInfo = parseDatabaseUrl(env.DATABASE_URL);
  if (!dbInfo) {
    logger.error('DATABASE_URL nije ispravan connection string.');
    return 1;
  }

  logger.log(`Čekam PostgreSQL na ${dbInfo.host}:${dbInfo.port}/${dbInfo.database}…`);
  const ready = await waitForPostgres(dbInfo.host, dbInfo.port, PG_WAIT_TIMEOUT_MS, PG_WAIT_INTERVAL_MS);
  if (!ready) {
    logger.error(
      `PostgreSQL nije dostupan unutar ${PG_WAIT_TIMEOUT_MS / 1000} s. ` +
        `Provjerite da je kontejner na mreži "${env.DB_NETWORK}" i da su kredencijali tačni.`,
    );
    return 1;
  }
  logger.log('PostgreSQL prihvata konekcije.');

  // 2) Lock (Redis je opcionalan — ako nije dostupan, nastavljamo uz upozorenje).
  let releaseLock: (() => Promise<void>) | undefined;
  if (!options.skipLock && env.REDIS_HOST) {
    const acquired = await acquireMigrateLock(env, LOCK_KEY, LOCK_TTL_MS, logger);
    if (acquired.kind === 'unavailable') {
      logger.warn(
        'Redis nije dostupan — migracije se pokreću bez locka. ' +
          'Pri paralelnom deploy-u postoji rizik od istovremenih migracija.',
      );
    } else if (acquired.kind === 'busy') {
      logger.log('Drugi proces već izvodi migracije (lock zauzet). Izlazim bez izmjena.');
      return 0;
    } else {
      releaseLock = acquired.release;
      logger.log(`Lock "${LOCK_KEY}" uzet.`);
    }
  }

  try {
    // 3) Provjeri da li je Prisma CLI dostupan.
    const prismaAvailable = await isPrismaAvailable();
    if (!prismaAvailable) {
      const message = [
        'Prisma CLI nije instaliran u apps/api, pa migracije nisu pokrenute.',
        '',
        'Razlog: `prisma generate`/`migrate` preuzimaju engine binarne fajlove s',
        'https://binaries.prisma.sh. U okruženju gdje je ovaj kod nastao taj host',
        'nije dostupan, pa Prisma nije dodata u dependencije (vidi apps/api/prisma/README.md).',
        '',
        'Aktivacija (jednom, na mašini/build serveru s internetom):',
        '  pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1',
        '  pnpm prisma:generate',
        '  pnpm --filter @vfm/api exec prisma migrate dev --name init',
        '',
        'Schema je kompletna i spremna: apps/api/prisma/schema.prisma',
        'Ekstenzije se mogu postaviti ručno: apps/api/prisma/sql/0000_bootstrap_extensions.sql',
        '',
        env.MIGRATIONS_STRICT
          ? 'MIGRATIONS_STRICT=true → deploy se prekida (exit 1).'
          : 'MIGRATIONS_STRICT=false → preskačem migracije i nastavljam (exit 0).',
      ].join('\n');

      if (env.MIGRATIONS_STRICT) {
        logger.error(message);
        return 1;
      }

      logger.warn(message);
      return 0;
    }

    // 4) migrate deploy
    logger.log('Pokrećem `prisma migrate deploy`…');
    const deployCode = await runPrisma(['migrate', 'deploy'], env.DATABASE_URL, logger);
    if (deployCode !== 0) {
      logger.error(`Migracije nisu uspjele (exit ${deployCode}).`);
      return deployCode;
    }
    logger.log('Migracije primijenjene.');

    // 5) Seed (opciono)
    if (options.seed) {
      logger.log('Pokrećem seed…');
      const seedCode = await runPrisma(['db', 'seed'], env.DATABASE_URL, logger);
      if (seedCode !== 0) {
        logger.error(`Seed nije uspio (exit ${seedCode}).`);
        return seedCode;
      }
    }

    return 0;
  } finally {
    if (releaseLock) {
      await releaseLock();
      logger.log(`Lock "${LOCK_KEY}" oslobođen.`);
    }
  }
}

// ---------------------------------------------------------------------------

interface DatabaseUrlInfo {
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

function parseDatabaseUrl(url: string | undefined): DatabaseUrlInfo | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: parsed.pathname.replace(/^\//u, ''),
    };
  } catch {
    return null;
  }
}

async function waitForPostgres(
  host: string,
  port: number,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await tcpProbe(host, port, 2000).catch(() => false);
    if (ok) return true;
    await sleep(intervalMs);
  }
  return false;
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

type MigrateLockOutcome =
  | { kind: 'acquired'; release: () => Promise<void> }
  | { kind: 'busy' }
  | { kind: 'unavailable' };

/** Uzima Redis lock; nikad ne baca (vraća `unavailable` ako Redis nije dostupan). */
async function acquireMigrateLock(
  env: BaseEnv,
  key: string,
  ttlMs: number,
  logger: { warn: (msg: string) => void; error: (msg: string) => void },
): Promise<MigrateLockOutcome> {
  try {
    const { default: Redis } = await import('ioredis');
    const config = redisConfig(env, 'worker');
    const client = new Redis({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.password ? { password: config.password } : {}),
      db: config.db,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      ...(config.tls ? { tls: {} } : {}),
    });

    await client.connect();
    const token = `migrate-${process.pid}-${Date.now()}`;
    const result = await client.set(key, token, 'PX', ttlMs, 'NX');

    if (result !== 'OK') {
      await client.quit().catch(() => client.disconnect());
      return { kind: 'busy' };
    }

    return { kind: 'acquired', release: async () => {
      try {
        const released = await client.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          key,
          token,
        );
        if (Number(released) !== 1) {
          logger.warn(`Lock "${key}" je u međuvremenu istekao ili ga drži drugi proces.`);
        }
      } finally {
        await client.quit().catch(() => client.disconnect());
      }
    } };
  } catch (error) {
    logger.warn(
      `Redis lock nije mogao biti uzet (${error instanceof Error ? error.message : String(error)}).`,
    );
    return { kind: 'unavailable' };
  }
}

/** Provjerava da li je `prisma` CLI instaliran (node_modules/prisma). */
async function isPrismaAvailable(): Promise<boolean> {
  const candidates = [
    resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    resolve(process.cwd(), 'node_modules', '.bin', 'prisma'),
    resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'prisma'),
    resolve(__dirname, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
    resolve(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'prisma'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return true;
  }
  // Dodatna provjera kroz require.resolve (pnpm symlink struktura).
  try {
    // Build target je CommonJS (tsconfig module: commonjs) → __filename postoji.
    const { createRequire } = await import('node:module');
    const localRequire = createRequire(__filename);
    localRequire.resolve('prisma');
    return true;
  } catch {
    return false;
  }
}

/** Pokreće prisma CLI kao child proces (nasljeđuje stdio za Coolify logove). */
function runPrisma(
  args: readonly string[],
  databaseUrl: string | undefined,
  logger: { log: (msg: string) => void; error: (msg: string) => void },
): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['--no-install', 'prisma', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
      },
    });

    child.on('error', (error: Error) => {
      logger.error(`Pokretanje prisma CLI nije uspjelo: ${error.message}`);
      resolvePromise(127);
    });
    child.on('exit', (code: number | null) => {
      resolvePromise(code ?? 1);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main()
  .then((code) => {
    process.exitCode = code;
    // Daj logovima vremena da se ispišu prije izlaska.
    setTimeout(() => process.exit(code), 50);
  })
  .catch((error: unknown) => {
     
    console.error('Neočekivana greška u migrate alatu:', error);
    process.exit(1);
  });
