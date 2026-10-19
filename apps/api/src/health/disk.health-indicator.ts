/**
 * Disk health indikator (Terminus 12 API) — prostor na bind-mount volumenu za
 * priloge (`VFM_STORAGE_CONTAINER_PATH`, default `/data/vfm/attachments`).
 *
 * Zašto: prilozi (fotografije, PDF-ovi) rastu neograničeno; kad disk dođe na 0,
 * uploadi padaju s nejasnom greškom. Zato readiness javlja `degraded` ispod
 * praga, a `down` ispod kritičnog praga; alarm ide u `docs/10-OPERACIJE.md` §3.
 *
 * Implementacija bez shell-outa: `fs.statfs` (Node ≥ 18.15) vraća
 * `bavail`/`bsize`. Ako putanja ne postoji (lokalni razvoj bez volumena),
 * indikator se preskače (status `up` s napomenom) — ne ruši razvoj.
 */
import { Injectable, Logger } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { HealthIndicatorService } from '@nestjs/terminus';
import { type HealthIndicatorResult } from '@nestjs/terminus';
import { getEnv } from '../config/env.js';

/** Prag upozorenja: 1 GB slobodno. */
export const DISK_WARN_BYTES = 1024 * 1024 * 1024;
/** Prag kritično: 256 MB slobodno. */
export const DISK_CRITICAL_BYTES = 256 * 1024 * 1024;

export interface DiskHealthDetails {
  readonly path: string;
  readonly availableBytes: number;
  readonly totalBytes: number;
  readonly usedPercent: number;
  readonly level: 'ok' | 'warn' | 'critical' | 'unknown';
  readonly message: string;
  readonly [key: string]: unknown;
}

@Injectable()
export class DiskHealthIndicator {
  private readonly logger = new Logger(DiskHealthIndicator.name);
  private readonly path = getEnv().VFM_STORAGE_CONTAINER_PATH;

  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const details = await this.probe();

    if (details.level === 'critical') {
      this.logger.error(`Kritično malo prostora za priloge: ${details.message}`);
      return indicator.down(details);
    }

    if (details.level === 'warn') {
      this.logger.warn(`Malo prostora za priloge: ${details.message}`);
      return indicator.degraded(details);
    }

    return indicator.up(details);
  }

  async probe(): Promise<DiskHealthDetails> {
    try {
      const stats = await statfs(this.path);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const usedPercent =
        totalBytes > 0 ? Math.round(((totalBytes - availableBytes) / totalBytes) * 100) : 0;

      const level: DiskHealthDetails['level'] =
        availableBytes < DISK_CRITICAL_BYTES
          ? 'critical'
          : availableBytes < DISK_WARN_BYTES
            ? 'warn'
            : 'ok';

      return {
        path: this.path,
        availableBytes,
        totalBytes,
        usedPercent,
        level,
        message: `${formatBytes(availableBytes)} slobodno od ${formatBytes(totalBytes)} (${usedPercent}% iskorišteno)`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        path: this.path,
        availableBytes: -1,
        totalBytes: -1,
        usedPercent: 0,
        level: 'unknown',
        message: `Provjera nije moguća (${message}) — volume za priloge nije montiran`,
      };
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
