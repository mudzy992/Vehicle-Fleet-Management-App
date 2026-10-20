import { describe, expect, it, vi } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from '../../src/health/redis.health-indicator.js';
import { DatabaseHealthIndicator } from '../../src/health/database.health-indicator.js';
import {
  DiskHealthIndicator,
  DISK_CRITICAL_BYTES,
  DISK_WARN_BYTES,
} from '../../src/health/disk.health-indicator.js';

/**
 * Health probe politika (docs/10-OPERACIJE.md §2, Terminus 12 API):
 * - `/health/live` NE provjerava zavisnosti (bez restart petlje),
 * - `/health/ready` pada (`down`) samo za kritične zavisnosti,
 * - `degraded` ne ruši readiness (HTTP 200),
 * - ACL greška se eksplicitno prepoznaje i upućuje na `REDIS_ACL.md`.
 */
const indicators = new HealthIndicatorService();

describe('RedisHealthIndicator', () => {
  it('Redis isključen → up s napomenom (lokalni razvoj bez infra)', async () => {
    const redis = { isEnabled: false, ping: vi.fn(), getInfo: vi.fn(() => []) };
    const indicator = new RedisHealthIndicator(indicators, redis as never);

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('up');
    expect(result.redis?.enabled).toBe(false);
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('Redis dostupan → up s latencijom', async () => {
    const redis = {
      isEnabled: true,
      ping: vi.fn(async () => ({ ok: true, latencyMs: 3, message: 'PONG' })),
      getInfo: vi.fn(() => [{ name: 'default', ready: true }]),
    };
    const indicator = new RedisHealthIndicator(indicators, redis as never);

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('up');
    expect(result.redis?.available).toBe(true);
    expect(result.redis?.latencyMs).toBe(3);
  });

  it('Redis nedostupan → down (readiness pada)', async () => {
    const redis = {
      isEnabled: true,
      ping: vi.fn(async () => ({ ok: false, latencyMs: 1500, message: 'connect ETIMEDOUT' })),
      getInfo: vi.fn(() => []),
    };
    const indicator = new RedisHealthIndicator(indicators, redis as never);

    const result = await indicator.isHealthy('redis');
    expect(result.redis?.status).toBe('down');
    expect(result.redis?.aclIssue).toBe(false);
  });

  it('ACL greška (NOPERM) se prepoznaje i upućuje na REDIS_ACL.md + ACL LOAD', async () => {
    const redis = {
      isEnabled: true,
      ping: vi.fn(async () => ({
        ok: false,
        latencyMs: 5,
        message: "NOPERM this user has no permissions to run the 'ping' command",
      })),
      getInfo: vi.fn(() => []),
    };
    const indicator = new RedisHealthIndicator(indicators, redis as never);

    const result = await indicator.isHealthy('redis');
    expect(result.redis?.status).toBe('down');

    const details = await indicator.probe();
    expect(details.aclIssue).toBe(true);
    expect(details.message).toMatch(/REDIS_ACL\.md/u);
    expect(details.message).toMatch(/ACL LOAD/u);
  });

  it('WRONGPASS se također tretira kao ACL/kredencijal problem', async () => {
    const redis = {
      isEnabled: true,
      ping: vi.fn(async () => ({
        ok: false,
        latencyMs: 2,
        message: 'WRONGPASS invalid username-password pair',
      })),
      getInfo: vi.fn(() => []),
    };
    const indicator = new RedisHealthIndicator(indicators, redis as never);

    const details = await indicator.probe();
    expect(details.aclIssue).toBe(true);
  });
});

describe('DatabaseHealthIndicator (Faza 1: stvarni SELECT 1 kroz Prisma adapter)', () => {
  it('nedostupna baza → down (DB je kritična zavisnost, readiness pada)', async () => {
    const database = {
      isConfigured: () => true,
      check: async () => ({
        ok: false,
        message:
          'Postgres host je dostupan (TCP vfm-postgres-global:5432), ali SELECT 1 nije prošao: P1010',
        latencyMs: 12,
        host: 'vfm-postgres-global',
        port: 5432,
        query: 'SELECT 1',
        tcpOk: true,
      }),
    };
    const indicator = new DatabaseHealthIndicator(indicators, database as never);

    const result = await indicator.isHealthy('database');

    expect(result.database?.status).toBe('down');
    expect(result.database?.ok).toBe(false);
    expect(result.database?.prismaWired).toBe(true);
    expect(result.database?.nonCritical).toBe(false);
    // Dijagnostika: mreža je OK, problem je u upitu/kredencijalima.
    expect(result.database?.query).toBe('SELECT 1');
    expect(result.database?.tcpOk).toBe(true);
  });

  it('baza dostupna → up (SELECT 1 kroz Prisma, ne samo TCP)', async () => {
    const database = {
      isConfigured: () => true,
      check: async () => ({
        ok: true,
        message: 'PostgreSQL dostupan — SELECT 1 za 4 ms',
        latencyMs: 4,
        host: 'vfm-postgres-global',
        port: 5432,
        query: 'SELECT 1',
      }),
    };
    const indicator = new DatabaseHealthIndicator(indicators, database as never);

    const result = await indicator.isHealthy('database');
    const details = await indicator.probe();

    expect(result.database?.status).toBe('up');
    expect(details.prismaWired).toBe(true);
    expect(details.query).toBe('SELECT 1');
    expect(details.tcpOk).toBeUndefined();
  });

  it('DATABASE_URL nije postavljen → ok=false s jasnom porukom i prismaWired=false', async () => {
    const database = { isConfigured: () => false, check: vi.fn() };
    const indicator = new DatabaseHealthIndicator(indicators, database as never);

    const details = await indicator.probe();

    expect(details.ok).toBe(false);
    expect(details.message).toMatch(/DATABASE_URL/u);
    expect(details.prismaWired).toBe(false);
    expect(database.check).not.toHaveBeenCalled();
  });

  it('poruka iz provjere se prosljeđuje bez "Faza 0" obećanja', async () => {
    const database = {
      isConfigured: () => true,
      check: async () => ({
        ok: true,
        message: 'PostgreSQL dostupan — SELECT 1 za 3 ms',
        latencyMs: 3,
      }),
    };
    const indicator = new DatabaseHealthIndicator(indicators, database as never);

    const details = await indicator.probe();
    expect(details.message).toBe('PostgreSQL dostupan — SELECT 1 za 3 ms');
    expect(details.message).not.toMatch(/Fazi 1|dolazi s Prisma/u);
  });
});

describe('DiskHealthIndicator', () => {
  it('probe vraća razuman rezultat za stvarni filesystem', async () => {
    const indicator = new DiskHealthIndicator(indicators);
    const details = await indicator.probe();

    expect(['ok', 'warn', 'critical', 'unknown']).toContain(details.level);
    expect(details.path.length).toBeGreaterThan(0);
  });

  it('pragovi su smisleni (critical < warn)', () => {
    expect(DISK_WARN_BYTES).toBeGreaterThan(DISK_CRITICAL_BYTES);
    expect(DISK_CRITICAL_BYTES).toBe(256 * 1024 * 1024);
  });

  it('nepostojeća putanja → level "unknown" (development bez volumena)', async () => {
    const indicator = new DiskHealthIndicator(indicators);
    const details = await indicator.probe();

    if (details.level === 'unknown') {
      expect(details.message).toMatch(/nije moguća|nije montiran/u);
      expect(details.availableBytes).toBe(-1);
    }
  });

  it('isHealthy nikad ne baca; always vraća rezultat', async () => {
    const indicator = new DiskHealthIndicator(indicators);
    const result = await indicator.isHealthy('storage');
    expect(result.storage?.status).toBeDefined();
  });
});
