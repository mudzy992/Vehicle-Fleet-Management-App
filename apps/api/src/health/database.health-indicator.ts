/**
 * Postgres health indikator (Terminus 12 API).
 *
 * 🔴 **Faza 0:** Prisma client nije generisan (sandbox nema pristup
 * `binaries.prisma.sh`), pa se provjera svodi na TCP dostupnost hosta iz
 * `DATABASE_URL`. Zato indikator vraća `degraded` (ne `down`) — Coolify ne
 * smije odbiti deploy ispravne aplikacije zbog toga.
 *
 * **Od Faze 1** (nakon `prisma generate`) ovdje ide `prisma.$queryRaw\`SELECT 1\``
 * i status prelazi u `down` (DB postaje kritična zavisnost).
 * Vidi `infra/database/database.module.ts`.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { type HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseAvailabilityService } from '../infra/database/database-availability.service.js';

/** Dok Prisma nije povezana, DB provjera ne ruši readiness. */
const DATABASE_CHECK_NON_CRITICAL = true;

export interface DatabaseProbeDetails {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs: number;
  readonly host?: string;
  readonly port?: number;
  readonly prismaWired: boolean;
  readonly nonCritical: boolean;
  readonly [key: string]: unknown;
}

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly database: DatabaseAvailabilityService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const details = await this.probe();

    if (details.ok) {
      return indicator.up(details);
    }

    return DATABASE_CHECK_NON_CRITICAL ? indicator.degraded(details) : indicator.down(details);
  }

  async probe(): Promise<DatabaseProbeDetails> {
    const configured = this.database.isConfigured();
    if (!configured) {
      return {
        ok: false,
        message: 'DATABASE_URL nije postavljen ili nije parsiv',
        latencyMs: 0,
        prismaWired: false,
        nonCritical: DATABASE_CHECK_NON_CRITICAL,
      };
    }

    const result = await this.database.check();
    return {
      ok: result.ok,
      message: result.ok
        ? `${result.message} — puna provjera (SELECT 1) dolazi s Prisma klijentom u Fazi 1`
        : result.message,
      latencyMs: result.latencyMs,
      host: result.host,
      port: result.port,
      prismaWired: false,
      nonCritical: DATABASE_CHECK_NON_CRITICAL,
    };
  }
}
