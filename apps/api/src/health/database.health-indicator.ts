/**
 * Postgres health indikator (Terminus) — Faza 1: baza je KRITIČNA zavisnost.
 *
 * Provjera ide kroz `PrismaService.ping()` (stvarni `SELECT 1` kroz driver
 * adapter), pa `/health/ready` pada kad pool, kredencijali ili šema ne rade —
 * ne samo kad TCP handshake ne prođe.
 *
 * `/health/live` namjerno NE provjerava bazu: Docker HEALTHCHECK (i Coolify
 * restart) koriste live, pa prolazni prekid baze ne izaziva crash-loop.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { type HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseAvailabilityService } from '../infra/database/database-availability.service.js';

/** Dok Prisma nije povezana, DB provjera ne ruši readiness. */
const DATABASE_CHECK_NON_CRITICAL = false;

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
        // Bez DATABASE_URL Prisma pool uopšte ne postoji (defenzivna grana:
        // `PrismaService` bi pri bootu bacio, pa ovo služi samo za jasnu poruku).
        prismaWired: false,
        nonCritical: DATABASE_CHECK_NON_CRITICAL,
      };
    }

    const result = await this.database.check();
    return {
      ok: result.ok,
      message: result.message,
      latencyMs: result.latencyMs,
      host: result.host,
      port: result.port,
      ...(result.query ? { query: result.query } : {}),
      ...(result.tcpOk === undefined ? {} : { tcpOk: result.tcpOk }),
      prismaWired: true,
      nonCritical: DATABASE_CHECK_NON_CRITICAL,
    };
  }
}
