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
 * Prisma CLI (7.10.1) je produkcijska dependencija `apps/api`, a nativni
 * `schema-engine` se peče u image pri buildu (`apps/api/Dockerfile`, korak 1b) —
 * `pnpm-workspace.yaml` inače ignoriše postinstall skripte, pa runtime kontejner
 * ne bi imao šta pokrenuti. Ako engine ipak nedostaje, alat to javi PRIJE
 * poziva CLI-ja, a ne tek kroz kriptičan `exit 1`.
 *
 * Izlaz prisme se **prepisuje u naš strukturirani logger** (ne samo na stdout),
 * jer Coolify prikazuje logove po servisima i sirovi stdout zna ostati izvan
 * prikaza; uz to se pri neuspjehu ispisuje dijagnostika (`diagnosePrismaFailure`)
 * i naknadni `prisma migrate status`.
 *
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
import {
  findSchemaEngineBinary,
  listMigrationNames,
  parsePendingMigrations,
  reportFailure,
  type PrismaRun,
  type ToolLogger,
} from './migrate-diagnostics.js';

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
        'Prisma CLI nije pronađen, pa migracije nisu pokrenute.',
        '',
        'Prisma 7.10.1 JESTE deklarirana u apps/api/package.json (`prisma`,',
        '`@prisma/client`, `dotenv`). Ako ovaj tool ipak ne vidi CLI, uzrok je',
        'najvjerovatnije pakovanje: runtime image nastaje iz `pnpm deploy --prod`,',
        'pa `prisma` mora biti u `dependencies` (ne devDependencies), a',
        '`prisma.config.ts` i `prisma/migrations/` moraju biti kopirani u /prod/api',
        '(vidi apps/api/Dockerfile).',
        '',
        'Provjera: ls node_modules/prisma/build/index.js && cat prisma.config.ts',
        '',
        'Migracije se primjenjuju ISKLJUČIVO sa `prisma migrate deploy` (pravilo 1',
        'u apps/api/prisma/README.md) — connection URL čita se iz prisma.config.ts,',
        'jer Prisma 7 više ne podržava `url` u schema.prisma ni flag --url.',
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

    // 3b) Nativni `schema-engine`: ako je zapečen u image (Dockerfile korak 1b),
    //     postavljamo PRISMA_SCHEMA_ENGINE_BINARY da CLI ne pokušava preuzimanje.
    const engineBinary = findSchemaEngineBinary();
    if (engineBinary) {
      logger.log(`schema-engine pronađen: ${engineBinary}`);
    } else {
      logger.warn(
        'Nativni `schema-engine` NIJE pronađen u paketu — `prisma migrate deploy` ' +
          'će ga pokušati preuzeti s binaries.prisma.sh, za šta runtime kontejner ' +
          'treba izlaz ka internetu. Ispravka je u apps/api/Dockerfile (korak 1b).',
      );
    }

    // 3c) Oporavak historije migracija (P3005 / pali red) — ISKLJUČIVO na izričit
    //     zahtjev operatora kroz ENV (MIGRATIONS_BASELINE / MIGRATIONS_ROLLED_BACK),
    //     nikad automatski: baseline označi migraciju primijenjenom BEZ izvršavanja
    //     DDL-a, pa bi pogrešna upotreba tiho preskočila stvarne izmjene šeme.
    const repairCode = await repairMigrationHistory(
      env.MIGRATIONS_BASELINE,
      env.MIGRATIONS_ROLLED_BACK,
      env.DATABASE_URL,
      logger,
      engineBinary,
    );
    if (repairCode !== null) return repairCode;

    // 4) migrate deploy
    logger.log('Pokrećem `prisma migrate deploy`…');
    const deploy = await runPrisma(['migrate', 'deploy'], env.DATABASE_URL, logger, engineBinary);
    if (deploy.code !== 0) {
      reportFailure('Migracije nisu uspjele', deploy, logger);
      // Stanje `_prisma_migrations` nakon pada je ključno za oporavak
      // (`migrate resolve --rolled-back <name>`), pa ga odmah ispisujemo.
      const status = await runPrisma(['migrate', 'status'], env.DATABASE_URL, logger, engineBinary);
      if (status.code !== 0 && status.output.trim().length === 0) {
        logger.error('`prisma migrate status` nije dao izlaz — vidi poruke iznad.');
      }
      return deploy.code;
    }
    logger.log('Migracije primijenjene.');

    // 5) Seed (opciono)
    if (options.seed) {
      logger.log('Pokrećem seed…');
      const seed = await runPrisma(['db', 'seed'], env.DATABASE_URL, logger, engineBinary);
      if (seed.code !== 0) {
        reportFailure('Seed nije uspio', seed, logger);
        return seed.code;
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

/**
 * Pokreće prisma CLI kao child proces.
 *
 * Izlaz se PIPIJE (a ne nasljeđuje) da bi svaka linija prošla kroz naš
 * strukturirani logger — Coolify prikazuje logove po servisima, pa sirovi stdout
 * djeteta zna ostati izvan prikaza, a upravo on nosi stvarni razlog pada.
 */
function runPrisma(
  args: readonly string[],
  databaseUrl: string | undefined,
  logger: ToolLogger,
  engineBinary: string | null,
): Promise<PrismaRun> {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['--no-install', 'prisma', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        ...(engineBinary ? { PRISMA_SCHEMA_ENGINE_BINARY: engineBinary } : {}),
        PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
      },
    });

    let output = '';
    const tee = (stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      output += text;
      for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        if (line.length === 0) continue;
        // stderr kod prisme nosi i progres i greške → sve ide na `log` (info),
        // a stvarni problem se prepoznaje i prijavljuje u `reportFailure`.
        logger.log(`prisma(${stream}): ${line}`);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => tee('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => tee('stderr', chunk));

    child.on('error', (error: Error) => {
      const message = `Pokretanje prisma CLI nije uspjelo: ${error.message}`;
      logger.error(message);
      resolvePromise({ code: 127, output: `${output}\n${message}` });
    });
    child.on('exit', (code: number | null) => {
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

/**
 * Oporavak `_prisma_migrations` bez diranja podataka. Vraća `null` kada nema
 * ničega za raditi ILI kada je oporavak uspio (tada main() nastavlja s deploy);
 * vraća exit code samo pri grešci.
 *
 * - `MIGRATIONS_BASELINE=0_extensions,1_init` → `prisma migrate resolve --applied`
 *   za svaku navedenu migraciju koja JE na Prisma-inoj listi neprimijenjenih.
 *   Rješava **P3005** ("database schema is not empty"): objekti su u bazi, a
 *   historija je obrisana (npr. ručni `DROP TABLE _prisma_migrations`).
 * - `MIGRATIONS_ROLLED_BACK=1_init` → `prisma migrate resolve --rolled-back`,
 *   rješava red s `finished_at IS NULL` nakon palog pokušaja.
 *
 * Nazivi se provjeravaju i protiv stvarnih direktorija u `prisma/migrations`, pa
 * greška u kucanju ne prolazi tiho.
 */
async function repairMigrationHistory(
  baseline: readonly string[],
  rolledBack: readonly string[],
  databaseUrl: string | undefined,
  logger: ToolLogger,
  engineBinary: string | null,
): Promise<number | null> {
  const baselineNames = baseline.map((name) => name.trim()).filter((name) => name.length > 0);
  const rolledBackNames = rolledBack.map((name) => name.trim()).filter((name) => name.length > 0);
  if (baselineNames.length === 0 && rolledBackNames.length === 0) return null;

  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  const known = listMigrationNames(migrationsDir);
  const knownSet = new Set(known);
  const unknown = [...baselineNames, ...rolledBackNames].filter((name) => !knownSet.has(name));
  if (unknown.length > 0) {
    logger.error(
      `Nepoznate migracije u MIGRATIONS_BASELINE/MIGRATIONS_ROLLED_BACK: ${unknown.join(', ')}. ` +
        `Postojeće migracije: ${known.join(', ') || '(nijedna)'}`,
    );
    return 1;
  }

  const status = await runPrisma(['migrate', 'status'], databaseUrl, logger, engineBinary);
  const pending = parsePendingMigrations(status.output);
  logger.log(`Neprimijenjene migracije prema 'migrate status': ${pending.join(', ') || '(nijedna)'}`);

  for (const name of rolledBackNames) {
    logger.warn(
      `MIGRATIONS_ROLLED_BACK: '${name}' označavam kao vraćenu — može se ponovo primijeniti.`,
    );
    const run = await runPrisma(
      ['migrate', 'resolve', '--rolled-back', name],
      databaseUrl,
      logger,
      engineBinary,
    );
    if (run.code !== 0) {
      reportFailure(`'migrate resolve --rolled-back ${name}' nije uspio`, run, logger);
      return run.code;
    }
  }

  for (const name of baselineNames) {
    if (!pending.includes(name)) {
      logger.warn(`MIGRATIONS_BASELINE: '${name}' nije na listi neprimijenjenih — preskačem.`);
      continue;
    }
    logger.warn(
      `MIGRATIONS_BASELINE: '${name}' označavam kao PRIMIJENJENU bez izvršavanja DDL-a. ` +
        'Ispravno je SAMO ako objekti te migracije zaista postoje u bazi — provjera: ' +
        'apps/api/prisma/sql/9000_dijagnostika_stanja_baze.sql',
    );
    const run = await runPrisma(
      ['migrate', 'resolve', '--applied', name],
      databaseUrl,
      logger,
      engineBinary,
    );
    if (run.code !== 0) {
      reportFailure(`'migrate resolve --applied ${name}' nije uspio`, run, logger);
      return run.code;
    }
  }

  logger.log('Historija migracija usklađena — nastavljam s `migrate deploy`.');
  return null;
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
