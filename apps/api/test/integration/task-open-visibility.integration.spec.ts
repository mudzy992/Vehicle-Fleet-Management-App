import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { processOutboxBatch } from '../../src/infra/queue/outbox-processor.js';
import type { OutboxPrisma } from '../../src/infra/queue/outbox-processor.js';
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

describe.skipIf(!isIsolatedCiDatabase)('P5 — vidljivost otvorenog zadatka i obavijesti (isolated CI DB)', () => {
  let sql: Client | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let tasks: TasksServiceType | undefined;
  let app: INestApplication | undefined;
  let baseUrl = '';
  const creatorId = randomUUID();
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const taskId = randomUUID();
  const outboxEventId = randomUUID();
  const taskCode = `P5-${randomUUID()}`;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'P5', 'Creator', 'ACTIVE', CURRENT_TIMESTAMP),
              ($3::uuid, $4, 'test-only-not-a-login-hash', 'P5', 'First', 'ACTIVE', CURRENT_TIMESTAMP),
              ($5::uuid, $6, 'test-only-not-a-login-hash', 'P5', 'Second', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [
        creatorId,
        `p5-creator-${creatorId}@vfm.test`,
        firstUserId,
        `p5-first-${firstUserId}@vfm.test`,
        secondUserId,
        `p5-second-${secondUserId}@vfm.test`,
      ],
    );

    const form = await sql.query<{ formSchemaId: string; versionId: string; taskTypeId: string }>(
      `SELECT tt."id" AS "taskTypeId", fs."id" AS "formSchemaId",
              fs."currentPublishedVersionId" AS "versionId"
         FROM "TaskType" tt
         JOIN "FormSchema" fs ON fs."id" = tt."formSchemaId"
        WHERE tt."code" = 'WASH' AND tt."active" = TRUE AND tt."deletedAt" IS NULL
          AND fs."currentPublishedVersionId" IS NOT NULL
        LIMIT 1`,
    );
    const publishedForm = form.rows[0];
    if (!publishedForm) throw new Error('Seedovana WASH vrsta i objavljena forma su obavezni za P5 test.');

    await sql.query(
      `INSERT INTO "Task" (
         "id", "code", "title", "taskTypeId", "priority", "status", "assignMode",
         "createdById", "formSchemaId", "formSchemaVersionId", "formData", "version", "updatedAt"
       ) VALUES ($1::uuid, $2, 'P5 otvoreni zadatak', $3::uuid, 'NORMAL', 'OPEN', 'OPEN_CLAIM',
                $4::uuid, $5::uuid, $6::uuid, '{}'::jsonb, 0, CURRENT_TIMESTAMP)`,
      [taskId, taskCode, publishedForm.taskTypeId, creatorId, publishedForm.formSchemaId, publishedForm.versionId],
    );
    await sql.query(
      `INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'INVITED', CURRENT_TIMESTAMP),
              ($4::uuid, $2::uuid, $5::uuid, 'INVITED', CURRENT_TIMESTAMP)`,
      [randomUUID(), taskId, firstUserId, randomUUID(), secondUserId],
    );
    await sql.query(
      `INSERT INTO "OutboxEvent" ("id", "aggregateType", "aggregateId", "eventType", "payload", "idempotencyKey")
       VALUES ($1::uuid, 'TASK', $2::uuid, 'TASK_CREATED', $3::jsonb, $4)`,
      [
        outboxEventId,
        taskId,
        JSON.stringify({
          code: taskCode,
          status: 'OPEN',
          version: 0,
          recipientUserIds: [firstUserId, secondUserId],
        }),
        `p5-task-created:${outboxEventId}`,
      ],
    );

    const [{ PrismaPg }, { PrismaClient }, { TasksService }, { TasksController }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
      import('../../src/modules/tasks/tasks.service.js'),
      import('../../src/modules/tasks/tasks.controller.js'),
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

    const taskService = tasks;
    const grants: readonly PermissionGrant[] = [
      { permission: 'task:claim', scope: 'OWN', scopeVehicleIds: [] },
      { permission: 'task:view', scope: 'OWN', scopeVehicleIds: [] },
    ];
    const guardPermissions = {
      snapshot: async () => ({ permissionsVersion: 0 }),
      currentPermissionsVersion: async () => 0,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        PermissionsGuard,
        { provide: TasksService, useValue: taskService },
        { provide: PermissionsService, useValue: guardPermissions },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: Request & { user?: AuthenticatedUser; id?: string }, _response: Response, next: NextFunction) => {
      const rawUserId = request.headers['x-p5-user'];
      const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
      if (userId === firstUserId || userId === secondUserId) {
        request.user = {
          id: userId,
          roles: ['OBICNI_KORISNIK'],
          roleIds: [],
          clientType: 'WEB',
          sessionId: 'p5-integration-session',
          jti: 'p5-integration-token',
          tokenVersion: 1,
          permissionsVersion: 0,
          isSuperAdmin: false,
          mustChangePassword: false,
          status: 'ACTIVE',
          allowedClientTypes: ['WEB'],
          permissions: evaluateEffectivePermissions({ roles: ['OBICNI_KORISNIK'], grants, clientType: 'WEB' }),
        };
        request.id = `p5-${userId}`;
      }
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    // TaskEvent je append-only; fixture se zadržava samo u disposable CI bazi koja se gasi nakon joba.
    await sql?.end();
  });

  it('oba pozvana korisnika vide zadatak i dobiju obavijest; nakon claim-a drugi vidi ime izvršioca', async () => {
    if (!tasks || !sql || !prisma || !app) throw new Error('P5 test nije inicijalizovan.');
    const availableUrl = `${baseUrl}/tasks/available?page=1&pageSize=20&sortOrder=asc&overdueOnly=false`;
    const [firstAvailableResponse, secondAvailableResponse] = await Promise.all([
      fetch(availableUrl, { headers: { 'x-p5-user': firstUserId } }),
      fetch(availableUrl, { headers: { 'x-p5-user': secondUserId } }),
    ]);
    expect(firstAvailableResponse.status).toBe(200);
    expect(secondAvailableResponse.status).toBe(200);
    const firstAvailable = (await firstAvailableResponse.json()) as { items: Array<{ id: string }> };
    const secondAvailable = (await secondAvailableResponse.json()) as { items: Array<{ id: string }> };
    expect(firstAvailable.items.map((task) => task.id)).toContain(taskId);
    expect(secondAvailable.items.map((task) => task.id)).toContain(taskId);

    const createdBatch = await processOutboxBatch(prisma as never as OutboxPrisma, {
      batchSize: 10,
      maxAttempts: 2,
      workerId: randomUUID(),
    });
    expect(createdBatch).toEqual({ claimed: 1, processed: 1, failed: 0, dead: 0 });
    const initialNotifications = await sql.query<{ userId: string; count: string }>(
      `SELECT "userId", COUNT(*)::text AS "count"
         FROM "Notification"
        WHERE "outboxEventId" = $1::uuid
        GROUP BY "userId"`,
      [outboxEventId],
    );
    expect(initialNotifications.rows).toEqual(
      expect.arrayContaining([
        { userId: firstUserId, count: '1' },
        { userId: secondUserId, count: '1' },
      ]),
    );

    const claimResponse = await fetch(`${baseUrl}/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'x-p5-user': firstUserId, 'content-type': 'application/json' },
      body: JSON.stringify({ formData: { washType: 'INTERNAL' } }),
    });
    expect(claimResponse.status).toBe(200);
    const secondUserResponse = await fetch(`${baseUrl}/tasks/${taskId}`, {
      headers: { 'x-p5-user': secondUserId },
    });
    expect(secondUserResponse.status).toBe(200);
    const secondUserView = (await secondUserResponse.json()) as {
      status: string;
      assigneeUserId: string | null;
      assigneeName: string | null;
    };
    expect(secondUserView.status).toBe('IN_PROGRESS');
    expect(secondUserView.assigneeUserId).toBe(firstUserId);
    expect(secondUserView.assigneeName).toBe('P5 First');

    const claimedOutbox = await sql.query<{ id: string }>(
      `SELECT "id" FROM "OutboxEvent" WHERE "aggregateId" = $1::uuid AND "eventType" = 'TASK_CLAIMED'`,
      [taskId],
    );
    expect(claimedOutbox.rows).toHaveLength(1);
    const claimBatch = await processOutboxBatch(prisma as never as OutboxPrisma, {
      batchSize: 10,
      maxAttempts: 2,
      workerId: randomUUID(),
    });
    expect(claimBatch).toEqual({ claimed: 1, processed: 1, failed: 0, dead: 0 });
    const secondUserClaimNotification = await sql.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "Notification"
        WHERE "outboxEventId" = $1::uuid AND "userId" = $2::uuid AND "type" = 'TASK_CLAIMED'`,
      [claimedOutbox.rows[0]?.id, secondUserId],
    );
    expect(secondUserClaimNotification.rows[0]?.count).toBe('1');
  }, 60_000);
});
