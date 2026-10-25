import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import Redis from 'ioredis';
import { evaluateEffectivePermissions, REDIS_NS, type PermissionGrant } from '@vfm/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { IdempotencyService } from '../../src/infra/redis/idempotency.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
const redisHost = process.env.REDIS_HOST;
const redisPort = Number(process.env.REDIS_PORT ?? 6379);
const isIsolatedCiStack = (() => {
  if (!databaseUrl || process.env.CI !== 'true' || redisHost !== 'localhost') return false;
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === 'localhost' && decodeURIComponent(parsed.pathname.slice(1)) === 'vfm_test';
  } catch {
    return false;
  }
})();

const contenderCount = 200;

describe.skipIf(!isIsolatedCiStack)('P6 — HTTP/Redis Idempotency-Key stress (isolated CI stack)', () => {
  let sql: Client | undefined;
  let redis: Redis | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let app: INestApplication | undefined;
  let baseUrl = '';

  const participantIds = Array.from({ length: contenderCount - 1 }, () => randomUUID());
  const creatorId = randomUUID();
  const taskId = randomUUID();
  const taskCode = `P6HTTP-${randomUUID()}`;
  const requestKeys = new Map<string, string[]>();
  const grants: readonly PermissionGrant[] = [
    { permission: 'task:claim', scope: 'OWN', scopeVehicleIds: [] },
  ];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    redis = new Redis({ host: redisHost, port: redisPort, lazyConnect: false, maxRetriesPerRequest: 1 });
    expect(await redis.ping()).toBe('PONG');

    const userValues: unknown[] = [];
    const userRows = participantIds.map((id, index) => {
      userValues.push(id, `p6-http-${id}@vfm.test`);
      const userIndex = index * 2 + 1;
      return `($${userIndex}::uuid, $${userIndex + 1}, 'test-only-not-a-login-hash', 'P6', 'HTTP', 'ACTIVE', CURRENT_TIMESTAMP)`;
    });
    userValues.push(creatorId, `p6-http-creator-${creatorId}@vfm.test`);
    const creatorParameterIndex = participantIds.length * 2 + 1;
    userRows.push(
      `($${creatorParameterIndex}::uuid, $${creatorParameterIndex + 1}, 'test-only-not-a-login-hash', 'P6', 'Creator', 'ACTIVE', CURRENT_TIMESTAMP)`,
    );
    await sql.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ${userRows.join(', ')}`,
      userValues,
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
    if (!form) throw new Error('Seedovana WASH vrsta i objavljena forma su obavezni za P6 HTTP test.');

    await sql.query(
      `INSERT INTO "Task" (
         "id", "code", "title", "taskTypeId", "priority", "status", "assignMode",
         "createdById", "formSchemaId", "formSchemaVersionId", "formData", "version", "updatedAt"
       ) VALUES ($1::uuid, $2, 'P6 HTTP konkurentni claim', $3::uuid, 'NORMAL', 'OPEN', 'OPEN_CLAIM',
                $4::uuid, $5::uuid, $6::uuid, '{}'::jsonb, 0, CURRENT_TIMESTAMP)`,
      [taskId, taskCode, form.taskTypeId, creatorId, form.formSchemaId, form.versionId],
    );
    const assignmentValues: unknown[] = [];
    const assignmentRows = participantIds.map((userId, index) => {
      assignmentValues.push(randomUUID(), taskId, userId);
      const parameterIndex = index * 3 + 1;
      return `($${parameterIndex}::uuid, $${parameterIndex + 1}::uuid, $${parameterIndex + 2}::uuid, 'INVITED', CURRENT_TIMESTAMP)`;
    });
    await sql.query(
      `INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedAt")
       VALUES ${assignmentRows.join(', ')}`,
      assignmentValues,
    );

    const [{ PrismaPg }, { PrismaClient }, { TasksService }, { TasksController }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
      import('../../src/modules/tasks/tasks.service.js'),
      import('../../src/modules/tasks/tasks.controller.js'),
    ]);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    prisma = client;
    const effectivePermissions = {
      effective: async () => ({
        isSuperAdmin: false,
        permissions: new Map([['task:claim', 'OWN']]),
        grants,
        list: ['task:claim'],
      }),
    };
    const tasks = new TasksService(client as unknown as PrismaService, effectivePermissions as never);
    const cachePort = {
      isEnabled: true,
      getConnection: () => redis,
      requireConnection: () => redis,
    };
    const idempotency = new IdempotencyService(cachePort as never);
    const permissionSnapshot = {
      snapshot: async () => ({ permissionsVersion: 0 }),
      currentPermissionsVersion: async () => 0,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        PermissionsGuard,
        IdempotencyInterceptor,
        { provide: IdempotencyService, useValue: idempotency },
        { provide: TasksService, useValue: tasks },
        { provide: PermissionsService, useValue: permissionSnapshot },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      (
        request: Request & { user?: AuthenticatedUser; id?: string },
        _response: ExpressResponse,
        next: NextFunction,
      ) => {
        const rawUserId = request.headers['x-p6-user'];
        const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
        if (typeof userId === 'string' && participantIds.includes(userId)) {
          request.user = {
            id: userId,
            email: `p6-http-${userId}@vfm.test`,
            roles: ['OBICNI_KORISNIK'],
            roleIds: [],
            clientType: 'WEB',
            sessionId: `p6-http-session-${userId}`,
            jti: `p6-http-token-${userId}`,
            tokenVersion: 1,
            permissionsVersion: 0,
            isSuperAdmin: false,
            mustChangePassword: false,
            status: 'ACTIVE',
            allowedClientTypes: ['WEB'],
            permissions: evaluateEffectivePermissions({
              roles: ['OBICNI_KORISNIK'],
              grants,
              clientType: 'WEB',
            }),
          };
          request.id = `p6-http-${userId}`;
        }
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalInterceptors(app.get(IdempotencyInterceptor));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (redis) {
      const keys = [...requestKeys.entries()].flatMap(([userId, values]) =>
        values.map((key) => `${REDIS_NS.idempotency}:${userId}:${key}`),
      );
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
    }
    // TaskEvent je append-only; DB fixture je izolovan u disposable CI PostgreSQL-u.
    await sql?.end();
  });

  async function claim(userId: string, idempotencyKey: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: {
        'x-p6-user': userId,
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ formData: { washType: 'INTERNAL' } }),
    });
    return { status: response.status, body: await response.json() };
  }

  it('200 HTTP poziva različitih korisnika daju jedan claim; replay istog Redis ključa ne dodaje zapise', async () => {
    if (!sql || !app || !redis) throw new Error('P6 HTTP stress nije inicijalizovan.');

    const repeatUserId = participantIds[0]!;
    const attempts = participantIds.map((userId) => ({ userId, key: `p6-${randomUUID()}` }));
    attempts.push({ userId: repeatUserId, key: `p6-${randomUUID()}` });
    for (const attempt of attempts) {
      requestKeys.set(attempt.userId, [...(requestKeys.get(attempt.userId) ?? []), attempt.key]);
    }
    expect(attempts).toHaveLength(contenderCount);

    const results = await Promise.all(attempts.map(({ userId, key }) => claim(userId, key)));
    const winners = results.flatMap((result, index) => (result.status === 200 ? [{ result, index }] : []));
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(contenderCount - 1);
    expect(
      results
        .filter((result) => result.status !== 200)
        .every(
          (result) => (result.body as { error?: { code?: string } }).error?.code === 'TASK_ALREADY_CLAIMED',
        ),
    ).toBe(true);

    const winner = winners[0]!;
    const winningAttempt = attempts[winner.index]!;
    const replay = await claim(winningAttempt.userId, winningAttempt.key);
    expect(replay).toEqual(winner.result);

    const [task, events, outbox, assignees] = await Promise.all([
      sql.query<{ status: string; version: number; assigneeUserId: string }>(
        `SELECT "status", "version", "assigneeUserId" FROM "Task" WHERE "id" = $1::uuid`,
        [taskId],
      ),
      sql.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "TaskEvent" WHERE "taskId" = $1::uuid AND "action" = 'CLAIMED'`,
        [taskId],
      ),
      sql.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "OutboxEvent" WHERE "aggregateId" = $1::uuid AND "eventType" = 'TASK_CLAIMED'`,
        [taskId],
      ),
      sql.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "TaskAssignment"
          WHERE "taskId" = $1::uuid AND "role" = 'ASSIGNEE' AND "revokedAt" IS NULL`,
        [taskId],
      ),
    ]);

    expect(task.rows[0]).toMatchObject({
      status: 'IN_PROGRESS',
      version: 1,
      assigneeUserId: (winner.result.body as { assigneeUserId?: string }).assigneeUserId,
    });
    expect(events.rows[0]?.count).toBe('1');
    expect(outbox.rows[0]?.count).toBe('1');
    expect(assignees.rows[0]?.count).toBe('1');
  }, 60_000);
});
