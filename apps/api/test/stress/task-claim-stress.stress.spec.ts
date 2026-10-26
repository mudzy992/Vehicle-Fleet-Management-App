import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { TasksService as TasksServiceType } from '../../src/modules/tasks/tasks.service.js';

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

const contenderCount = 200;

describe.skipIf(!isIsolatedCiDatabase)('Faza 5 — P6 stress atomskog claim-a', () => {
  let pool: Pool | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let tasks: TasksServiceType | undefined;
  const taskId = randomUUID();
  const actorId = randomUUID();
  const userEmail = `p6-${randomUUID()}@vfm.test`;
  const taskCode = `P6-${randomUUID()}`;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    pool = new Pool({ connectionString: databaseUrl, max: 32 });
    const user = await pool.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'P6', 'Test', 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING "id"`,
      [actorId, userEmail],
    );
    if (!user.rows[0]) throw new Error('P6 stress testni korisnik nije kreiran.');

    const form = await pool.query<{ formSchemaId: string; versionId: string; taskTypeId: string }>(
      `SELECT tt."id" AS "taskTypeId", fs."id" AS "formSchemaId",
              fs."currentPublishedVersionId" AS "versionId"
         FROM "TaskType" tt
         JOIN "FormSchema" fs ON fs."id" = tt."formSchemaId"
        WHERE tt."code" = 'WASH' AND tt."active" = TRUE AND tt."deletedAt" IS NULL
          AND fs."currentPublishedVersionId" IS NOT NULL
        LIMIT 1`,
    );
    const publishedForm = form.rows[0];
    if (!publishedForm) throw new Error('Seedovana WASH vrsta i objavljena forma su obavezni za P6 test.');

    await pool.query(
      `INSERT INTO "Task" (
         "id", "code", "title", "taskTypeId", "priority", "status", "assignMode",
         "createdById", "formSchemaId", "formSchemaVersionId", "formData", "updatedAt"
       ) VALUES ($1::uuid, $2, 'P6 konkurentno preuzimanje', $3::uuid, 'NORMAL', 'OPEN', 'OPEN_CLAIM',
                $4::uuid, $5::uuid, $6::uuid, '{}'::jsonb, CURRENT_TIMESTAMP)`,
      [
        taskId,
        taskCode,
        publishedForm.taskTypeId,
        actorId,
        publishedForm.formSchemaId,
        publishedForm.versionId,
      ],
    );
    await pool.query(
      `INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'INVITED', CURRENT_TIMESTAMP)`,
      [randomUUID(), taskId, actorId],
    );

    const [{ PrismaPg }, { PrismaClient }, { TasksService }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
      import('../../src/modules/tasks/tasks.service.js'),
    ]);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    prisma = client;
    const permissions = {
      effective: async () => ({
        isSuperAdmin: false,
        permissions: new Map([['task:claim', 'OWN']]),
        grants: [],
        list: ['task:claim'],
      }),
    };
    tasks = new TasksService(client as unknown as PrismaService, permissions as never);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    // TaskEvent je append-only; fixture ostaje samo u disposable CI bazi koja se gasi nakon joba.
    await pool?.end();
  });

  it('200 stvarnih claim poziva daju jednog pobjednika i tačno jedan event/outbox zapis', async () => {
    const service = tasks;
    const db = pool;
    if (!service || !db) throw new Error('P6 servis ili testna baza nije inicijalizovana.');
    const actor = { id: actorId, roles: ['OBICNI_KORISNIK'], clientType: 'WEB' as const };

    const outcomes = await Promise.allSettled(
      Array.from({ length: contenderCount }, () =>
        service.claim(taskId, { formData: { washType: 'INTERNAL' } }, actor),
      ),
    );
    const succeeded = outcomes.filter((result) => result.status === 'fulfilled');
    const rejected = outcomes.filter((result) => result.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(contenderCount - 1);
    const rejectionKinds = rejected.reduce<Record<string, number>>((counts, result) => {
      const reason = result.status === 'rejected' ? result.reason : undefined;
      const kind =
        typeof reason?.code === 'string'
          ? reason.code
          : typeof reason?.name === 'string'
            ? reason.name
            : typeof reason;
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {});
    expect(
      rejected.every(
        (result) => result.status === 'rejected' && result.reason?.code === 'TASK_ALREADY_CLAIMED',
      ),
      `P6 rejected-call kinds: ${JSON.stringify(rejectionKinds)}`,
    ).toBe(true);

    const [task, events, outbox, assignees] = await Promise.all([
      db.query<{ status: string; version: number; assigneeUserId: string }>(
        `SELECT "status", "version", "assigneeUserId" FROM "Task" WHERE "id" = $1::uuid`,
        [taskId],
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "TaskEvent" WHERE "taskId" = $1::uuid AND "action" = 'CLAIMED'`,
        [taskId],
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "OutboxEvent" WHERE "aggregateId" = $1::uuid AND "eventType" = 'TASK_CLAIMED'`,
        [taskId],
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "TaskAssignment" WHERE "taskId" = $1::uuid AND "role" = 'ASSIGNEE' AND "revokedAt" IS NULL`,
        [taskId],
      ),
    ]);

    expect(task.rows[0]).toMatchObject({ status: 'IN_PROGRESS', version: 1, assigneeUserId: actorId });
    expect(events.rows[0]?.count).toBe('1');
    expect(outbox.rows[0]?.count).toBe('1');
    expect(assignees.rows[0]?.count).toBe('1');
  }, 60_000);
});
