import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../../src/infra/queue/outbox-processor.js';
import type { OutboxPrisma } from '../../src/infra/queue/outbox-processor.js';

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

describe.skipIf(!isolatedCiDatabase)('Outbox → in-app notifications (isolated CI DB)', () => {
  let sql: Client | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let processBatch: typeof processOutboxBatch | undefined;
  const userId = randomUUID();
  const aggregateId = randomUUID();
  const successEventId = randomUUID();
  const mutedEventId = randomUUID();
  const retryEventId = randomUUID();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'Outbox', 'Test', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [userId, `outbox-${userId}@vfm.test`],
    );
    await sql.query(
      `INSERT INTO "NotificationPreference" ("id", "userId", "type", "channelInApp", "updatedAt")
       VALUES ($1::uuid, $2::uuid, 'TASK_CANCELLED', FALSE, CURRENT_TIMESTAMP)`,
      [randomUUID(), userId],
    );

    const payload = (eventType: string, recipients: string[]) =>
      JSON.stringify({
        taskId: aggregateId,
        code: 'T-OUTBOX-CI',
        status: 'OPEN',
        version: 1,
        recipientUserIds: recipients,
      });
    for (const [id, eventType, recipients] of [
      [successEventId, 'TASK_CLAIMED', [userId]],
      [mutedEventId, 'TASK_CANCELLED', [userId]],
      [retryEventId, 'TASK_COMPLETED', ['not-a-uuid']],
    ] as const) {
      await sql.query(
        `INSERT INTO "OutboxEvent" ("id", "aggregateType", "aggregateId", "eventType", "payload", "idempotencyKey")
         VALUES ($1::uuid, 'TASK', $2::uuid, $3, $4::jsonb, $5)`,
        [id, aggregateId, eventType, payload(eventType, [...recipients]), `outbox-test:${id}`],
      );
    }

    const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
    ]);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    prisma = client;
    processBatch = processOutboxBatch;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (!sql) return;
    await sql.query('DELETE FROM "OutboxEvent" WHERE "id" = ANY($1::uuid[])', [
      [successEventId, mutedEventId, retryEventId],
    ]);
    await sql.query('DELETE FROM "User" WHERE "id" = $1::uuid', [userId]);
    await sql.end();
  });

  it('kreira deduplicirane in-app obavijesti, poštuje preference i šalje greške na retry pa DEAD', async () => {
    const client = prisma;
    const process = processBatch;
    if (!client || !process || !sql) throw new Error('Outbox test nije inicijalizovan.');
    const options = { batchSize: 10, maxAttempts: 2, workerId: randomUUID() };
    const first = await process(client as never as OutboxPrisma, options);
    expect(first).toEqual({ claimed: 3, processed: 2, failed: 1, dead: 0 });

    const active = await sql.query<{ count: string; title: string; eventType: string }>(
      `SELECT COUNT(*)::text AS "count", MIN("title") AS "title", MIN("type") AS "eventType"
         FROM "Notification" WHERE "outboxEventId" = $1::uuid`,
      [successEventId],
    );
    expect(active.rows[0]).toMatchObject({ count: '1', title: 'Zadatak preuzet', eventType: 'TASK_CLAIMED' });

    const muted = await sql.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "Notification" WHERE "outboxEventId" = $1::uuid`,
      [mutedEventId],
    );
    expect(muted.rows[0]?.count).toBe('0');

    const retryAt = new Date(Date.now() + 60_000);
    const second = await process(client as never as OutboxPrisma, {
      ...options,
      now: () => retryAt,
    });
    expect(second).toEqual({ claimed: 1, processed: 0, failed: 0, dead: 1 });

    const statuses = await sql.query<{ status: string; attempts: number }>(
      `SELECT "status", "attempts" FROM "OutboxEvent" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"`,
      [[successEventId, mutedEventId, retryEventId]],
    );
    expect(statuses.rows.filter((row) => row.status === 'PROCESSED')).toHaveLength(2);
    expect(statuses.rows.find((row) => row.status === 'DEAD')).toMatchObject({ status: 'DEAD', attempts: 2 });

    const third = await process(client as never as OutboxPrisma, {
      ...options,
      now: () => new Date(retryAt.getTime() + 120_000),
    });
    expect(third.claimed).toBe(0);
    const notificationsAfterReplay = await sql.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "Notification" WHERE "outboxEventId" = $1::uuid`,
      [successEventId],
    );
    expect(notificationsAfterReplay.rows[0]?.count).toBe('1');
  }, 60_000);
});
