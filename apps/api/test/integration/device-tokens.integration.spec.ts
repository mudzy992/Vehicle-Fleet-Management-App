import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeviceTokensService } from '../../src/modules/notifications/device-tokens.service.js';

const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
const isolatedCiDatabase = (() => {
  if (!databaseUrl || process.env.CI !== 'true') return false;
  try {
    const url = new URL(databaseUrl);
    return url.hostname === 'localhost' && decodeURIComponent(url.pathname.slice(1)) === 'vfm_test';
  } catch {
    return false;
  }
})();

describe.skipIf(!isolatedCiDatabase)('DeviceToken lifecycle (isolated CI DB)', () => {
  let sql: Client | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let service: DeviceTokensService | undefined;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const token = `integration-device-token-${randomUUID()}`;
  const expectedHash = createHash('sha256').update(token).digest('hex');

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'Device', 'Owner', 'ACTIVE', CURRENT_TIMESTAMP),
              ($3::uuid, $4, 'test-only-not-a-login-hash', 'Other', 'Owner', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [ownerId, `device-owner-${ownerId}@vfm.test`, otherOwnerId, `device-other-${otherOwnerId}@vfm.test`],
    );

    const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
    ]);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    prisma = client;
    service = new DeviceTokensService(client as never);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (!sql) return;
    await sql.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [[ownerId, otherOwnerId]]);
    await sql.end();
  });

  it('hashira token, ograničava pristup na ownera, reaktivira INVALID i omogućava opoziv', async () => {
    const deviceService = service;
    if (!deviceService || !sql) throw new Error('DeviceToken integration test nije inicijalizovan.');

    const created = await deviceService.register(ownerId, {
      token,
      platform: 'android',
      appVersion: 'ci-test',
    });
    expect(created).not.toHaveProperty('token');
    expect(created).not.toHaveProperty('tokenHash');
    expect(await deviceService.list(ownerId)).toMatchObject({
      items: [{ id: created.id, status: 'ACTIVE' }],
    });
    expect(await deviceService.list(otherOwnerId)).toEqual({ items: [] });

    const stored = await sql.query<{ tokenHash: string; token: string }>(
      `SELECT "tokenHash", "token" FROM "DeviceToken" WHERE "id" = $1::uuid`,
      [created.id],
    );
    expect(stored.rows[0]).toEqual({ tokenHash: expectedHash, token });

    const repeated = await deviceService.register(ownerId, { token, platform: 'ios' });
    expect(repeated.id).toBe(created.id);
    expect(repeated.platform).toBe('ios');
    const rows = await sql.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "DeviceToken" WHERE "tokenHash" = $1`,
      [expectedHash],
    );
    expect(rows.rows[0]?.count).toBe('1');

    await expect(deviceService.register(otherOwnerId, { token, platform: 'android' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await sql.query(
      `UPDATE "DeviceToken" SET "status" = 'INVALID', "lastError" = 'test invalidation',
             "failureCount" = 1, "revokedAt" = CURRENT_TIMESTAMP WHERE "id" = $1::uuid`,
      [created.id],
    );
    const reactivated = await deviceService.register(ownerId, { token, platform: 'android' });
    expect(reactivated).toMatchObject({ status: 'ACTIVE', failureCount: 0, revokedAt: null });

    await expect(deviceService.revoke(otherOwnerId, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deviceService.revoke(ownerId, created.id);
    const afterRevoke = await sql.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "DeviceToken" WHERE "id" = $1::uuid`,
      [created.id],
    );
    expect(afterRevoke.rows[0]?.count).toBe('0');
  }, 30_000);
});
