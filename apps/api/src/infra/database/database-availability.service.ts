/**
 * Provjera dostupnosti baze (Faza 1: stvarni `SELECT 1` kroz Prisma adapter).
 *
 * - validira prisustvo i oblik `DATABASE_URL`,
 * - izvršava `SELECT 1` kroz `PrismaService.ping()` → dokazuje da pool,
 *   kredencijali i šema rade (sam TCP connect to NE dokazuje),
 * - TCP probe ostaje kao **dijagnostika**: kad upit padne, javlja da li je
 *   problem mreža (host nedostupan) ili autentifikacija/šema (host dostupan).
 *
 * U porukama nema kredencijala (`safeConnectionInfo` vraća samo host/port/db).
 */
import { Injectable, Logger } from '@nestjs/common';
import { connect } from 'node:net';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { BaseEnv } from '@vfm/shared/env';

export interface DatabaseCheckResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs: number;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  /** Upit kojim je provjera izvršena (Faza 1: `SELECT 1`). */
  readonly query?: string;
  /** TCP dostupnost hosta — ispunjeno samo kad upit padne (dijagnostika). */
  readonly tcpOk?: boolean;
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

  constructor(private readonly prisma: PrismaService) {}

  /** Da li je `DATABASE_URL` postavljen i parsiv. */
  isConfigured(): boolean {
    const info = safeConnectionInfo(this.env.DATABASE_URL);
    return Boolean(this.env.DATABASE_URL && info.host);
  }

  /**
   * Provjera dostupnosti baze: `SELECT 1` kroz Prisma, uz TCP dijagnostiku.
   *
   * Napomena: uspješan TCP connect NE znači da su kredencijali ispravni — zato je
   * od Faze 1 izvor istine upit. TCP dio ostaje samo da razlikuje "kontejner nije
   * na `db_net`/hostname je pogrešan" od "šema ili kredencijali ne valjaju"
   * (vidi `docs/08-DOCKER_COOLIFY_DEPLOYMENT.md` §3).
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

    // 1) Stvarni upit kroz Prisma adapter (dokazuje pool + kredencijale + šemu).
    const ping = await this.prisma.ping(timeoutMs);
    if (ping.ok) {
      return {
        ok: true,
        message: `PostgreSQL dostupan — SELECT 1 za ${ping.latencyMs} ms`,
        latencyMs: Date.now() - started,
        host,
        port,
        database: info.database,
        query: 'SELECT 1',
      };
    }

    // 2) Upit je pao → TCP probe razlikuje mrežni problem od kredencijala/šeme.
    const tcpOk = await tcpProbe(host, port, timeoutMs).then(
      () => true,
      () => false,
    );
    const message = tcpOk
      ? `Postgres host je dostupan (TCP ${host}:${port}), ali SELECT 1 nije prošao: ${ping.error}`
      : `Postgres nije dostupan na ${host}:${port}: ${ping.error}`;

    this.logger.warn(
      `${message}. Provjerite da je kontejner spojen na mrežu "${this.env.DB_NETWORK}" ` +
        '(Coolify: Advanced → Connect To Predefined Network), da je hostname tačan i da ' +
        'DATABASE_URL odgovara korisniku baze (Prisma 7: SSL greške se javljaju kao P1010).',
    );

    return {
      ok: false,
      message,
      latencyMs: Date.now() - started,
      host,
      port,
      database: info.database,
      query: 'SELECT 1',
      tcpOk,
    };
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
