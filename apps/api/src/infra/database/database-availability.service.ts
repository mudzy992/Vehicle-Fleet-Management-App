/**
 * Provjera dostupnosti baze — verzija za Fazu 0 (bez Prisma clienta).
 *
 * Radi ono što je moguće bez generisanog Prisma clienta:
 * - validira prisustvo i oblik `DATABASE_URL`,
 * - provjerava TCP dostupnost Postgres hosta (socket connect),
 * - izvještava health endpoint (`/health/ready`).
 *
 * Od Faze 1 (nakon `prisma generate`) ovdje se koristi
 * `prisma.$queryRaw\`SELECT 1\`` umjesto TCP provjere — vidi
 * `infra/database/database.module.ts` za tačne korake aktivacije.
 */
import { Injectable, Logger } from '@nestjs/common';
import { connect } from 'node:net';
import { getEnv } from '../../config/env.js';
import type { BaseEnv } from '@vfm/shared/env';

export interface DatabaseCheckResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs: number;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
}

/** Maksimalno dozvoljeni detalji koje smijemo izložiti (bez lozinke!). */
function safeConnectionInfo(url: string | undefined): {
  host?: string;
  port?: number;
  database?: string;
} {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: parsed.pathname.replace(/^\//u, '') || undefined,
    };
  } catch {
    return {};
  }
}

@Injectable()
export class DatabaseAvailabilityService {
  private readonly logger = new Logger(DatabaseAvailabilityService.name);
  private readonly env: BaseEnv = getEnv();

  /** Da li je `DATABASE_URL` postavljen i parsiv. */
  isConfigured(): boolean {
    const info = safeConnectionInfo(this.env.DATABASE_URL);
    return Boolean(this.env.DATABASE_URL && info.host);
  }

  /**
   * TCP provjera dostupnosti Postgresa (bez autentifikacije).
   *
   * Napomena: uspješan TCP connect ne znači da su kredencijali ispravni, ali
   * otkriva najčešći problem u Coolify okruženju — kontejner nije spojen na
   * `db_net` ili je hostname pogrešan (vidi `docs/08-DOCKER_COOLIFY.md` §3).
   */
  async check(timeoutMs = 3000): Promise<DatabaseCheckResult> {
    const started = Date.now();
    const info = safeConnectionInfo(this.env.DATABASE_URL);

    if (!this.env.DATABASE_URL) {
      return {
        ok: false,
        message: 'DATABASE_URL nije postavljen (globalni PostgreSQL na mreži db_net)',
        latencyMs: Date.now() - started,
      };
    }
    if (!info.host) {
      return {
        ok: false,
        message: 'DATABASE_URL nije ispravan connection string',
        latencyMs: Date.now() - started,
      };
    }

    const host = info.host;
    const port = info.port ?? 5432;

    try {
      await tcpProbe(host, port, timeoutMs);
      return {
        ok: true,
        message: 'Postgres host dostupan (TCP)',
        latencyMs: Date.now() - started,
        host,
        port,
        database: info.database,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Postgres nije dostupan na ${host}:${port} — ${reason}. ` +
          `Provjerite da je kontejner spojen na mrežu "${this.env.DB_NETWORK}" ` +
          `(Coolify: Advanced → Connect To Predefined Network) i da je hostname tačan.`,
      );
      return {
        ok: false,
        message: `Postgres nije dostupan: ${reason}`,
        latencyMs: Date.now() - started,
        host,
        port,
        database: info.database,
      };
    }
  }
}

/** Čisti TCP connect s timeoutom (bez dependencija). */
function tcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error(`timeout nakon ${timeoutMs} ms`)));
    socket.once('error', (error: Error) => finish(error));
  });
}
