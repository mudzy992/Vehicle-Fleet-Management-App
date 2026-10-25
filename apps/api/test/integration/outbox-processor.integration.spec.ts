import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../../src/infra/queue/outbox-processor.js';
import type { OutboxPrisma } from '../../src/infra/queue/outbox-processor.js';
import { processFcmDeliveryBatch } from '../../src/infra/queue/fcm-delivery-processor.js';
import type { FcmGateway } from '../../src/infra/queue/fcm-delivery-processor.js';

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

describe.skipIf(!isolatedCiDatabase)('Outbox → notification + FCM queue (isolated CI DB)', () => {
  let sql: Client | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let processBatch: typeof processOutboxBatch | undefined;
  const userId = randomUUID();
  const fcmUserId = randomUUID();
  const invalidFcmUserId = randomUUID();
  const aggregateId = randomUUID();
  const successEventId = randomUUID();
  const mutedEventId = randomUUID();
  const fcmOnlyEventId = randomUUID();
  const retryEventId = randomUUID();
  const invalidTokenEventId = randomUUID();
  const fcmTokenId = randomUUID();
  const invalidFcmTokenId = randomUUID();

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
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'FCM', 'Test', 'ACTIVE', CURRENT_TIMESTAMP),
              ($3::uuid, $4, 'test-only-not-a-login-hash', 'Invalid FCM', 'Test', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [
        fcmUserId,
        `outbox-fcm-${fcmUserId}@vfm.test`,
        invalidFcmUserId,
        `outbox-invalid-${invalidFcmUserId}@vfm.test`,
      ],
    );
    await sql.query(
      `INSERT INTO "NotificationPreference" ("id", "userId", "type", "channelInApp", "channelFcm", "updatedAt")
       VALUES ($1::uuid, $2::uuid, 'TASK_CANCELLED', FALSE, FALSE, CURRENT_TIMESTAMP),
              ($3::uuid, $4::uuid, 'TASK_ASSIGNED', FALSE, TRUE, CURRENT_TIMESTAMP),
              ($5::uuid, $6::uuid, 'TASK_ASSIGNED', FALSE, TRUE, CURRENT_TIMESTAMP)`,
      [randomUUID(), userId, randomUUID(), fcmUserId, randomUUID(), invalidFcmUserId],
    );
    await sql.query(
      `INSERT INTO "DeviceToken" ("id", "userId", "token", "tokenHash", "platform")
       VALUES ($1::uuid, $2::uuid, $3, $4, 'android'), ($5::uuid, $6::uuid, $7, $8, 'android')`,
      [
        fcmTokenId,
        fcmUserId,
        `test-fcm-token-${fcmTokenId}`,
        `test-hash-${fcmTokenId}`,
        invalidFcmTokenId,
        invalidFcmUserId,
        `test-invalid-fcm-token-${invalidFcmTokenId}`,
        `test-invalid-hash-${invalidFcmTokenId}`,
      ],
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
      [fcmOnlyEventId, 'TASK_ASSIGNED', [fcmUserId]],
      [invalidTokenEventId, 'TASK_ASSIGNED', [invalidFcmUserId]],
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
      [successEventId, mutedEventId, fcmOnlyEventId, invalidTokenEventId, retryEventId],
    ]);
    await sql.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [
      [userId, fcmUserId, invalidFcmUserId],
    ]);
    await sql.end();
  });

  it('kreira deduplicirane in-app obavijesti, poštuje preference i šalje greške na retry pa DEAD', async () => {
    const client = prisma;
    const process = processBatch;
    if (!client || !process || !sql) throw new Error('Outbox test nije inicijalizovan.');
    const options = {
      batchSize: 10,
      maxAttempts: 2,
      workerId: randomUUID(),
      eventIds: [successEventId, mutedEventId, fcmOnlyEventId, retryEventId, invalidTokenEventId],
    };
    const first = await process(client as never as OutboxPrisma, options);
    expect(first).toEqual({ claimed: 5, processed: 4, failed: 1, dead: 0 });

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

    const fcmOnly = await sql.query<{ visible: boolean; deliveries: string }>(
      `SELECT notification."inAppVisible" AS "visible",
              (SELECT COUNT(*)::text FROM "NotificationDelivery" delivery
                WHERE delivery."notificationId" = notification."id" AND delivery."channel" = 'FCM') AS "deliveries"
         FROM "Notification" notification WHERE notification."outboxEventId" = $1::uuid`,
      [fcmOnlyEventId],
    );
    expect(fcmOnly.rows[0]).toEqual({ visible: false, deliveries: '1' });

    // Simulate a manual redelivery after an uncertain worker acknowledgement.
    await sql.query(
      `UPDATE "OutboxEvent" SET "status" = 'PENDING', "processedAt" = NULL WHERE "id" = $1::uuid`,
      [fcmOnlyEventId],
    );
    const replay = await process(client as never as OutboxPrisma, options);
    expect(replay).toEqual({ claimed: 1, processed: 1, failed: 0, dead: 0 });
    const replayed = await sql.query<{ notifications: string; deliveries: string }>(
      `SELECT COUNT(DISTINCT notification."id")::text AS "notifications",
              COUNT(DISTINCT delivery."id")::text AS "deliveries"
         FROM "Notification" notification
         LEFT JOIN "NotificationDelivery" delivery ON delivery."notificationId" = notification."id"
        WHERE notification."outboxEventId" = $1::uuid`,
      [fcmOnlyEventId],
    );
    expect(replayed.rows[0]).toEqual({ notifications: '1', deliveries: '1' });

    const fcmNow = new Date(Date.now() + 5_000);
    await sql.query(
      `UPDATE "NotificationPreference" SET "channelFcm" = FALSE WHERE "userId" = ANY($1::uuid[]) AND "type" = 'TASK_ASSIGNED'`,
      [[fcmUserId, invalidFcmUserId]],
    );
    const disabledDelivery = await processFcmDeliveryBatch(
      client as never,
      { send: async () => 'must-not-send' },
      {
        batchSize: 10,
        maxAttempts: 2,
        now: () => fcmNow,
        workerId: randomUUID(),
      },
    );
    expect(disabledDelivery.claimed).toBe(0);
    await sql.query(
      `UPDATE "NotificationPreference" SET "channelFcm" = TRUE WHERE "userId" = ANY($1::uuid[]) AND "type" = 'TASK_ASSIGNED'`,
      [[fcmUserId, invalidFcmUserId]],
    );

    const flakyGateway: FcmGateway = {
      send: async (message) => {
        if (message.token === `test-invalid-fcm-token-${invalidFcmTokenId}`) {
          throw Object.assign(new Error('isolated invalid token'), {
            code: 'messaging/registration-token-not-registered',
          });
        }
        throw new Error('isolated FCM timeout');
      },
    };
    const firstDelivery = await processFcmDeliveryBatch(client as never, flakyGateway, {
      batchSize: 10,
      maxAttempts: 2,
      now: () => fcmNow,
      workerId: randomUUID(),
    });
    expect(firstDelivery).toEqual({ claimed: 2, sent: 0, retried: 1, invalid: 1, dead: 0 });
    const invalidDelivery = await sql.query<{ deliveryStatus: string; tokenStatus: string }>(
      `SELECT delivery."status" AS "deliveryStatus", token."status" AS "tokenStatus"
         FROM "NotificationDelivery" delivery
         JOIN "DeviceToken" token ON token."id" = delivery."deviceTokenId"
        WHERE delivery."deviceTokenId" = $1::uuid`,
      [invalidFcmTokenId],
    );
    expect(invalidDelivery.rows[0]).toEqual({ deliveryStatus: 'TOKEN_INVALID', tokenStatus: 'INVALID' });

    const retryDelivery = await sql.query<{ status: string; attempts: number }>(
      `SELECT "status", "attempts" FROM "NotificationDelivery" WHERE "channel" = 'FCM' AND "notificationId" IN
       (SELECT "id" FROM "Notification" WHERE "outboxEventId" = $1::uuid)`,
      [fcmOnlyEventId],
    );
    expect(retryDelivery.rows[0]).toMatchObject({ status: 'FAILED', attempts: 1 });

    const successGateway: FcmGateway = { send: async () => 'mock-provider-message-id' };
    const secondDelivery = await processFcmDeliveryBatch(client as never, successGateway, {
      batchSize: 10,
      maxAttempts: 2,
      now: () => new Date(fcmNow.getTime() + 2_000),
      workerId: randomUUID(),
    });
    expect(secondDelivery).toEqual({ claimed: 1, sent: 1, retried: 0, invalid: 0, dead: 0 });
    const sentDelivery = await sql.query<{ status: string; attempts: number; messageId: string | null }>(
      `SELECT "status", "attempts", "providerMessageId" AS "messageId"
         FROM "NotificationDelivery" WHERE "channel" = 'FCM' AND "notificationId" IN
         (SELECT "id" FROM "Notification" WHERE "outboxEventId" = $1::uuid)`,
      [fcmOnlyEventId],
    );
    expect(sentDelivery.rows[0]).toEqual({
      status: 'SENT',
      attempts: 2,
      messageId: 'mock-provider-message-id',
    });

    const retryAt = new Date(Date.now() + 60_000);
    const second = await process(client as never as OutboxPrisma, {
      ...options,
      now: () => retryAt,
    });
    expect(second).toEqual({ claimed: 1, processed: 0, failed: 0, dead: 1 });

    const statuses = await sql.query<{ status: string; attempts: number }>(
      `SELECT "status", "attempts" FROM "OutboxEvent" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"`,
      [[successEventId, mutedEventId, fcmOnlyEventId, invalidTokenEventId, retryEventId]],
    );
    expect(statuses.rows.filter((row) => row.status === 'PROCESSED')).toHaveLength(4);
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
