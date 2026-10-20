/**
 * `PrismaService` — jedinstvena tačka pristupa PostgreSQL-u (Prisma 7).
 *
 * Zašto ovako:
 * - Prisma 7 je iz `schema.prisma` uklonila `datasource.url`, a runtime ZAHTIJEVA
 *   driver adapter (`@prisma/adapter-pg`) → klijent se konstruiše s `PrismaPg`
 *   pool-om koji čita `DATABASE_URL` (R-02: globalni Postgres na mreži `db_net`).
 * - `pg` nema defaultni connection timeout (Prisma 6 engine je imao 5 s) →
 *   eksplicitno postavljamo `connectionTimeoutMillis` iz `DATABASE_POOL_TIMEOUT`,
 *   inače bi healthcheck mogao visiti dok OS ne odustane od TCP-a.
 * - Veličina poola dolazi iz `DATABASE_CONNECTION_LIMIT` (default 10), što je
 *   usklađeno s `docs/10-OPERACIJE.md` §3 (metrika `pg_pool_*`).
 *
 * Servis je `@Global()` (vidi `prisma.module.ts`): svaki modul dobija ISTU
 * instancu, pa postoji tačno jedan pool po procesu (api / worker / tool).
 *
 * ⚠️ Ne koristi `prisma.$connect()` kao uslov za boot: adapter povezuje lenjo, a
 * `ping()` (stvarni `SELECT 1`) je izvor istine za `/health/ready`.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { BaseEnv } from '@vfm/shared/env';
import { getEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Defaultni timeout `SELECT 1` provjere (healthcheck mora biti brz). */
export const PING_TIMEOUT_MS = 3_000;

/** Opcije pg pool-a koje se izvode iz ENV šeme (`@vfm/shared/env`). */
export interface PrismaConnectionOptions {
  readonly connectionString: string;
  /** Maksimalan broj konekcija u poolu (`DATABASE_CONNECTION_LIMIT`). */
  readonly max: number;
  /** `DATABASE_POOL_TIMEOUT` (sekunde) → milisekunde. */
  readonly connectionTimeoutMillis: number;
  /** `DATABASE_SSL` — TLS ka bazi (interno: bez provjere CA, vidi dolje). */
  readonly ssl: boolean;
}

/** Rezultat `ping()` provjere — nikad ne baca, da healthcheck ostane jednostavan. */
export type PrismaPingResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly latencyMs: number; readonly error: string };

/**
 * Čita `DATABASE_URL` i pool opcije iz ENV-a.
 *
 * Baca ako `DATABASE_URL` nedostaje: bez njega Prisma 7 ne može raditi, a
 * profil `api`/`tool` ga i ovako zahtijeva (`validateEnvProfile`) — bolje je
 * pasti pri bootu s jasnom porukom nego pri prvom upitu.
 */
export function prismaConnectionOptions(env: BaseEnv): PrismaConnectionOptions {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL nije postavljen — PrismaService se ne može konstruisati. ' +
        'R-02: globalni PostgreSQL na mreži `db_net` (Coolify → Environment Variables).',
    );
  }
  return {
    connectionString: url,
    max: env.DATABASE_CONNECTION_LIMIT,
    connectionTimeoutMillis: env.DATABASE_POOL_TIMEOUT * 1_000,
    ssl: env.DATABASE_SSL,
  };
}

/**
 * Gradi `PrismaPg` adapter (pg.Pool).
 *
 * `DATABASE_SSL=true` znači TLS **bez** provjere CA (`rejectUnauthorized: false`):
 * baza je na istom Docker hostu (`db_net`), a Prisma 7 + node-pg inače vraća
 * `P1010` za samopotpisane certifikate. Za javni TLS s pravim CA-om umjesto ove
 * opcije koristi `NODE_EXTRA_CA_CERTS` i ostavi `DATABASE_SSL=false`.
 */
export function buildPrismaAdapter(options: PrismaConnectionOptions): PrismaPg {
  return new PrismaPg({
    connectionString: options.connectionString,
    max: options.max,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: buildPrismaAdapter(prismaConnectionOptions(getEnv())) });
  }

  /**
   * Pri bootu samo **izvještava** o stanju baze — ne ruši proces.
   *
   * Razlog: `migrate` servis ide prije `api` (compose `service_completed_successfully`),
   * pa je baza u pravilu spremna; ako ipak nije, `/health/ready` postaje `down`
   * (DB je od Faze 1 kritična zavisnost), a Coolify restartuje kontejner preko
   * `/health/live`. Crash-loop pri deploy-u bi sakrio pravi uzrok iz logova.
   */
  async onModuleInit(): Promise<void> {
    const ping = await this.ping();
    if (ping.ok) {
      this.log.log(`PostgreSQL spreman (SELECT 1 za ${ping.latencyMs} ms).`);
      return;
    }
    this.log.error(
      `PostgreSQL NIJE dostupan: ${ping.error}. ` +
        'API je podignut, ali /health/ready vraća 503 dok se veza ne uspostavi.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Stvarna provjera baze (`SELECT 1` kroz adapter) — docs/09 P0 i docs/10 §3.
   *
   * Zamjenjuje Faza-0 TCP probe: uspješan TCP connect ne dokazuje da su
   * kredencijali ispravni ni da pool radi, a upravo je to najčešći uzrok
   * "deploy prošao, API ne radi" u Coolify-u.
   */
  async ping(timeoutMs: number = PING_TIMEOUT_MS): Promise<PrismaPingResult> {
    const started = Date.now();
    try {
      await withTimeout(this.$queryRaw`SELECT 1`, timeoutMs);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Ograničava čekanje na odgovor (pool može biti zauzet ili TCP može visiti).
 * Timer se čisti da ne drži event loop otvorenim.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(`timeout nakon ${timeoutMs} ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
