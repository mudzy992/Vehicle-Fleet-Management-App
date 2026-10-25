import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processFcmDeliveryBatch, type FcmGateway } from '../../src/infra/queue/fcm-delivery-processor.js';
import { processOutboxBatch } from '../../src/infra/queue/outbox-processor.js';
import type { OutboxPrisma } from '../../src/infra/queue/outbox-processor.js';

const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
const isIsolatedCiDatabase = (() => {
  if (!databaseUrl || process.env.CI !== 'true') return false;
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === 'localhost' && decodeURIComponent(parsed.pathname.slice(1)) === 'vfm_test';
  } catch {
    return false;
  }
})();

describe.skipIf(!isIsolatedCiDatabase)(
  'P8 — FCM retry ne mijenja task i ne duplira obavijest (isolated CI DB)',
  () => {
    let sql: Client | undefined;
    let prisma: { $disconnect(): Promise<void> } | undefined;

    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const taskId = randomUUID();
    const taskAssignmentId = randomUUID();
    const tokenId = randomUUID();
    const outboxEventId = randomUUID();
    const taskCode = `P8-${randomUUID()}`;
    const token = `p8-test-token-${tokenId}`;

    beforeAll(async () => {
      if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
      sql = new Client({ connectionString: databaseUrl });
      await sql.connect();
      await sql.query(
        `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'P8', 'Creator', 'ACTIVE', CURRENT_TIMESTAMP),
              ($3::uuid, $4, 'test-only-not-a-login-hash', 'P8', 'Assignee', 'ACTIVE', CURRENT_TIMESTAMP)`,
        [creatorId, `p8-creator-${creatorId}@vfm.test`, assigneeId, `p8-assignee-${assigneeId}@vfm.test`],
      );

      const formResult = await sql.query<{ taskTypeId: string; formSchemaId: string; versionId: string }>(
        `SELECT tt."id" AS "taskTypeId", fs."id" AS "formSchemaId",
              fs."currentPublishedVersionId" AS "versionId"
         FROM "TaskType" tt
         JOIN "FormSchema" fs ON fs."id" = tt."formSchemaId"
        WHERE tt."code" = 'WASH' AND tt."active" = TRUE AND tt."deletedAt" IS NULL
          AND fs."currentPublishedVersionId" IS NOT NULL
        LIMIT 1`,
      );
      const form = formResult.rows[0];
      if (!form) throw new Error('Seedovana WASH vrsta i objavljena forma su obavezni za P8 test.');

      await sql.query(
        `INSERT INTO "Task" (
         "id", "code", "title", "taskTypeId", "priority", "status", "assignMode",
         "createdById", "assigneeUserId", "claimedAt", "formSchemaId", "formSchemaVersionId",
         "formData", "version", "updatedAt"
       ) VALUES ($1::uuid, $2, 'P8 FCM retry fixture', $3::uuid, 'NORMAL', 'IN_PROGRESS', 'OPEN_CLAIM',
                $4::uuid, $5::uuid, CURRENT_TIMESTAMP, $6::uuid, $7::uuid,
                '{"washType":"INTERNAL"}'::jsonb, 1, CURRENT_TIMESTAMP)`,
        [taskId, taskCode, form.taskTypeId, creatorId, assigneeId, form.formSchemaId, form.versionId],
      );
      await sql.query(
        `INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedById", "assignedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'ASSIGNEE', $4::uuid, CURRENT_TIMESTAMP)`,
        [taskAssignmentId, taskId, assigneeId, creatorId],
      );
      await sql.query(
        `INSERT INTO "NotificationPreference" ("id", "userId", "type", "channelInApp", "channelFcm", "updatedAt")
       VALUES ($1::uuid, $2::uuid, 'TASK_CLAIMED', TRUE, TRUE, CURRENT_TIMESTAMP)`,
        [randomUUID(), assigneeId],
      );
      await sql.query(
        `INSERT INTO "DeviceToken" ("id", "userId", "token", "tokenHash", "platform")
       VALUES ($1::uuid, $2::uuid, $3, $4, 'android')`,
        [tokenId, assigneeId, token, `sha256-${tokenId}`],
      );
      await sql.query(
        `INSERT INTO "OutboxEvent" ("id", "aggregateType", "aggregateId", "eventType", "payload", "idempotencyKey")
       VALUES ($1::uuid, 'TASK', $2::uuid, 'TASK_CLAIMED', $3::jsonb, $4)`,
        [
          outboxEventId,
          taskId,
          JSON.stringify({
            taskId,
            code: taskCode,
            status: 'IN_PROGRESS',
            version: 1,
            recipientUserIds: [assigneeId],
          }),
          `p8-task-claimed:${outboxEventId}`,
        ],
      );

      const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
        import('@prisma/adapter-pg'),
        import('../../src/generated/prisma/client.js'),
      ]);
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
      // Fixtura se zadržava samo u disposable CI PostgreSQL-u koji se gasi nakon joba.
      await sql?.end();
    });

    it('zadržava IN_PROGRESS task i tačno jednu Notification/Delivery kroz FCM grešku pa uspješan retry', async () => {
      if (!sql || !prisma) throw new Error('P8 test nije inicijalizovan.');

      const before = await sql.query<{
        status: string;
        assigneeUserId: string;
        version: number;
        updatedAt: string;
      }>(
        `SELECT "status", "assigneeUserId", "version",
              to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "updatedAt"
         FROM "Task" WHERE "id" = $1::uuid`,
        [taskId],
      );
      expect(before.rows).toHaveLength(1);
      expect(before.rows[0]).toMatchObject({ status: 'IN_PROGRESS', assigneeUserId: assigneeId, version: 1 });

      const outbox = await processOutboxBatch(prisma as never as OutboxPrisma, {
        batchSize: 10,
        maxAttempts: 2,
        workerId: randomUUID(),
        eventIds: [outboxEventId],
      });
      expect(outbox).toEqual({ claimed: 1, processed: 1, failed: 0, dead: 0 });

      const createdRows = await sql.query<{ notificationCount: string; deliveryCount: string }>(
        `SELECT COUNT(DISTINCT notification."id")::text AS "notificationCount",
              COUNT(DISTINCT delivery."id")::text AS "deliveryCount"
         FROM "Notification" notification
         LEFT JOIN "NotificationDelivery" delivery ON delivery."notificationId" = notification."id"
        WHERE notification."outboxEventId" = $1::uuid AND notification."userId" = $2::uuid`,
        [outboxEventId, assigneeId],
      );
      expect(createdRows.rows[0]).toEqual({ notificationCount: '1', deliveryCount: '1' });
      const deliveryRows = await sql.query<{ id: string }>(
        `SELECT delivery."id"
         FROM "NotificationDelivery" delivery
         JOIN "Notification" notice ON notice."id" = delivery."notificationId"
        WHERE notice."outboxEventId" = $1::uuid AND notice."userId" = $2::uuid
          AND delivery."channel" = 'FCM'`,
        [outboxEventId, assigneeId],
      );
      expect(deliveryRows.rows).toHaveLength(1);
      const deliveryIds = deliveryRows.rows.map((row) => row.id);

      const firstAttemptAt = new Date();
      const failingGateway: FcmGateway = {
        send: async () => {
          throw new Error('isolated FCM timeout');
        },
      };
      const firstDelivery = await processFcmDeliveryBatch(prisma as never, failingGateway, {
        batchSize: 10,
        maxAttempts: 3,
        now: () => firstAttemptAt,
        workerId: randomUUID(),
        deliveryIds,
      });
      expect(firstDelivery).toEqual({ claimed: 1, sent: 0, retried: 1, invalid: 0, dead: 0 });

      const afterFailure = await sql.query<{
        status: string;
        assigneeUserId: string;
        version: number;
        updatedAt: string;
        notificationCount: string;
        deliveryStatus: string;
        attempts: number;
      }>(
        `SELECT task."status", task."assigneeUserId", task."version",
              to_char(task."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "updatedAt",
              (SELECT COUNT(*)::text FROM "Notification" notice WHERE notice."outboxEventId" = $2::uuid) AS "notificationCount",
              delivery."status" AS "deliveryStatus", delivery."attempts"
         FROM "Task" task
         JOIN "Notification" notice ON notice."outboxEventId" = $2::uuid AND notice."userId" = $3::uuid
         JOIN "NotificationDelivery" delivery ON delivery."notificationId" = notice."id"
        WHERE task."id" = $1::uuid`,
        [taskId, outboxEventId, assigneeId],
      );
      expect(afterFailure.rows).toHaveLength(1);
      expect(afterFailure.rows[0]).toMatchObject({
        ...before.rows[0],
        notificationCount: '1',
        deliveryStatus: 'FAILED',
        attempts: 1,
      });

      const succeedingGateway: FcmGateway = { send: async () => 'p8-mock-provider-message' };
      const retry = await processFcmDeliveryBatch(prisma as never, succeedingGateway, {
        batchSize: 10,
        maxAttempts: 3,
        now: () => new Date(firstAttemptAt.getTime() + 2_000),
        workerId: randomUUID(),
        deliveryIds,
      });
      expect(retry).toEqual({ claimed: 1, sent: 1, retried: 0, invalid: 0, dead: 0 });

      const final = await sql.query<{
        status: string;
        assigneeUserId: string;
        version: number;
        updatedAt: string;
        notificationCount: string;
        deliveryCount: string;
        deliveryStatus: string;
        attempts: number;
      }>(
        `SELECT task."status", task."assigneeUserId", task."version",
              to_char(task."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "updatedAt",
              COUNT(DISTINCT notice."id")::text AS "notificationCount",
              COUNT(DISTINCT delivery."id")::text AS "deliveryCount",
              MIN(delivery."status") AS "deliveryStatus", MAX(delivery."attempts") AS "attempts"
         FROM "Task" task
         JOIN "Notification" notice ON notice."outboxEventId" = $2::uuid AND notice."userId" = $3::uuid
         JOIN "NotificationDelivery" delivery ON delivery."notificationId" = notice."id"
        WHERE task."id" = $1::uuid
        GROUP BY task."id"`,
        [taskId, outboxEventId, assigneeId],
      );
      expect(final.rows).toHaveLength(1);
      expect(final.rows[0]).toMatchObject({
        ...before.rows[0],
        notificationCount: '1',
        deliveryCount: '1',
        deliveryStatus: 'SENT',
        attempts: 2,
      });

      const processedEvent = await sql.query<{ status: string }>(
        `SELECT "status" FROM "OutboxEvent" WHERE "id" = $1::uuid`,
        [outboxEventId],
      );
      expect(processedEvent.rows[0]?.status).toBe('PROCESSED');
    }, 60_000);
  },
);
