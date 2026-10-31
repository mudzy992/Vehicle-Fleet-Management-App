import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { evaluateEffectivePermissions, type ClientType, type PermissionGrant } from '@vfm/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_SINK } from '../../src/common/audit/audit.types.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { AuditInterceptor } from '../../src/common/interceptors/audit.interceptor.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

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

describe.skipIf(!isIsolatedCiDatabase)('P7 — završetak zadatka, override i AuditLog (isolated CI DB)', () => {
  let sql: Client | undefined;
  let prisma: { $disconnect(): Promise<void> } | undefined;
  let app: INestApplication | undefined;
  let baseUrl = '';

  const creatorId = randomUUID();
  const assigneeId = randomUUID();
  const otherUserId = randomUUID();
  const overrideUserId = randomUUID();
  const assigneeTaskId = randomUUID();
  const overrideTaskId = randomUUID();
  const rollbackTaskId = randomUUID();
  const taskCodePrefix = `P7-${randomUUID()}`;

  const grantsByUser = new Map<string, readonly PermissionGrant[]>([
    [
      assigneeId,
      [
        { permission: 'task:complete', scope: 'OWN', scopeVehicleIds: [] },
        { permission: 'task:view', scope: 'ALL', scopeVehicleIds: [] },
      ],
    ],
    [
      otherUserId,
      [
        { permission: 'task:complete', scope: 'OWN', scopeVehicleIds: [] },
        { permission: 'task:view', scope: 'ALL', scopeVehicleIds: [] },
      ],
    ],
    [
      overrideUserId,
      [
        { permission: 'task:complete_override', scope: 'ALL', scopeVehicleIds: [] },
        { permission: 'task:view', scope: 'ALL', scopeVehicleIds: [] },
      ],
    ],
  ]);

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();

    await sql.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1::uuid, $2, 'test-only-not-a-login-hash', 'P7', 'Creator', 'ACTIVE', CURRENT_TIMESTAMP),
              ($3::uuid, $4, 'test-only-not-a-login-hash', 'P7', 'Assignee', 'ACTIVE', CURRENT_TIMESTAMP),
              ($5::uuid, $6, 'test-only-not-a-login-hash', 'P7', 'Other', 'ACTIVE', CURRENT_TIMESTAMP),
              ($7::uuid, $8, 'test-only-not-a-login-hash', 'P7', 'Override', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [
        creatorId,
        `p7-creator-${creatorId}@vfm.test`,
        assigneeId,
        `p7-assignee-${assigneeId}@vfm.test`,
        otherUserId,
        `p7-other-${otherUserId}@vfm.test`,
        overrideUserId,
        `p7-override-${overrideUserId}@vfm.test`,
      ],
    );

    //  Namjerno vrsta bez obaveznih polja u ORDER formi (legacy complete koristi
    //  ORDER shemu dok `realizationFormSchemaVersionId` nije postavljen): ovaj
    //  test mjeri autorizaciju završetka, ne formu.
    const formResult = await sql.query<{ taskTypeId: string; formSchemaId: string; versionId: string }>(
      `SELECT tt."id" AS "taskTypeId", fs."id" AS "formSchemaId",
              fs."currentPublishedVersionId" AS "versionId"
         FROM "TaskType" tt
         JOIN "FormSchema" fs ON fs."id" = tt."formSchemaId"
        WHERE tt."code" = 'FUEL_REFILL' AND tt."active" = TRUE AND tt."deletedAt" IS NULL
          AND fs."currentPublishedVersionId" IS NOT NULL
        LIMIT 1`,
    );
    const form = formResult.rows[0];
    if (!form) throw new Error('Seedovana FUEL_REFILL vrsta i objavljena forma su obavezni za P7 test.');

    for (const [taskId, suffix] of [
      [assigneeTaskId, 'assignee'],
      [overrideTaskId, 'override'],
      [rollbackTaskId, 'rollback'],
    ] as const) {
      await sql.query(
        `INSERT INTO "Task" (
           "id", "code", "title", "taskTypeId", "priority", "status", "assignMode",
           "createdById", "assigneeUserId", "claimedAt", "formSchemaId", "formSchemaVersionId",
           "formData", "version", "updatedAt"
         ) VALUES ($1::uuid, $2, $3, $4::uuid, 'NORMAL', 'IN_PROGRESS', 'OPEN_CLAIM',
                  $5::uuid, $6::uuid, CURRENT_TIMESTAMP, $7::uuid, $8::uuid,
                  '{"napomena":"P7 testni nalog."}'::jsonb, 1, CURRENT_TIMESTAMP)`,
        [
          taskId,
          `${taskCodePrefix}-${suffix}`,
          `P7 task ${suffix}`,
          form.taskTypeId,
          creatorId,
          assigneeId,
          form.formSchemaId,
          form.versionId,
        ],
      );
      await sql.query(
        `INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedById", "assignedAt")
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'ASSIGNEE', $4::uuid, CURRENT_TIMESTAMP)`,
        [randomUUID(), taskId, assigneeId, creatorId],
      );
    }

    const [{ PrismaPg }, { PrismaClient }, { PrismaAuditSink }, { TasksController }, { TasksService }] =
      await Promise.all([
        import('@prisma/adapter-pg'),
        import('../../src/generated/prisma/client.js'),
        import('../../src/common/audit/prisma-audit.sink.js'),
        import('../../src/modules/tasks/tasks.controller.js'),
        import('../../src/modules/tasks/tasks.service.js'),
      ]);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    prisma = client;

    const permissions = {
      effective: async (userId: string, clientType: ClientType) => {
        const grants = grantsByUser.get(userId) ?? [];
        return evaluateEffectivePermissions({
          roles: ['OBICNI_KORISNIK'],
          grants,
          clientType,
        });
      },
    };
    const tasks = new TasksService(client as unknown as PrismaService, permissions as never);
    const permissionSnapshot = {
      snapshot: async () => ({ permissionsVersion: 0 }),
      currentPermissionsVersion: async () => 0,
    };
    const auditSink = new PrismaAuditSink(client as unknown as PrismaService);
    const moduleRef = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        PermissionsGuard,
        AuditInterceptor,
        { provide: AUDIT_SINK, useValue: auditSink },
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
        const rawUserId = request.headers['x-p7-user'];
        const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
        if (typeof userId === 'string' && grantsByUser.has(userId)) {
          const grants = grantsByUser.get(userId) ?? [];
          request.user = {
            id: userId,
            email: `p7-${userId}@vfm.test`,
            roles: ['OBICNI_KORISNIK'],
            roleIds: [],
            clientType: 'WEB',
            sessionId: `p7-session-${userId}`,
            jti: `p7-token-${userId}`,
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
          request.id = `p7-${userId}`;
        }
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalInterceptors(app.get(AuditInterceptor));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    // TaskEvent/AuditLog su append-only; fixture ostaje samo u disposable CI bazi.
    await sql?.end();
  });

  async function completeTask(taskId: string, userId: string, reason?: string): Promise<Response> {
    return fetch(`${baseUrl}/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'x-p7-user': userId, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        formData: { napomena: 'P7 testni završetak.' },
        ...(reason ? { reason } : {}),
      }),
    });
  }

  async function waitForAudit(
    taskId: string,
  ): Promise<{ actorId: string; metadata: Record<string, unknown> }> {
    if (!sql) throw new Error('P7 test nije inicijalizovan.');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await sql.query<{ actorId: string; metadata: Record<string, unknown> }>(
        `SELECT "actorId", "metadata" FROM "AuditLog"
          WHERE "entityType" = 'Task' AND "entityId" = $1::uuid AND "action" = 'COMPLETE'
          ORDER BY "createdAt" DESC LIMIT 1`,
        [taskId],
      );
      if (result.rows[0]) return result.rows[0];
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`AuditLog COMPLETE nije upisan za P7 task ${taskId}.`);
  }

  async function waitForAuditRequest(
    requestId: string,
  ): Promise<{ success: boolean; reason: string | null }> {
    if (!sql) throw new Error('P7 test nije inicijalizovan.');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await sql.query<{ success: boolean; reason: string | null }>(
        `SELECT ("metadata"->>'success')::boolean AS "success", "reason"
           FROM "AuditLog" WHERE "requestId" = $1 AND "action" = 'COMPLETE'`,
        [requestId],
      );
      if (result.rows[0]) return result.rows[0];
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`AuditLog COMPLETE nije upisan za request ${requestId}.`);
  }

  it('odbija neizvršioca, dopušta izvršioca i bilježi transakcijski override u TaskEvent/AuditLog', async () => {
    if (!sql || !app) throw new Error('P7 test nije inicijalizovan.');

    const denied = await completeTask(assigneeTaskId, otherUserId);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'NOT_ASSIGNEE' } });
    const deniedTask = await sql.query<{ status: string; eventCount: string }>(
      `SELECT t."status", COUNT(e."id")::text AS "eventCount"
         FROM "Task" t LEFT JOIN "TaskEvent" e ON e."taskId" = t."id"
        WHERE t."id" = $1::uuid GROUP BY t."id"`,
      [assigneeTaskId],
    );
    expect(deniedTask.rows[0]).toEqual({ status: 'IN_PROGRESS', eventCount: '0' });

    const selfComplete = await completeTask(assigneeTaskId, assigneeId);
    expect(selfComplete.status).toBe(200);
    const completedByAssignee = await sql.query<{ status: string; completedById: string; action: string }>(
      `SELECT t."status", t."completedById", e."action"
         FROM "Task" t JOIN "TaskEvent" e ON e."taskId" = t."id"
        WHERE t."id" = $1::uuid`,
      [assigneeTaskId],
    );
    expect(completedByAssignee.rows).toEqual([
      { status: 'COMPLETED', completedById: assigneeId, action: 'COMPLETED' },
    ]);

    const overrideReason = 'Administrativni završetak nakon provjere.';
    const overrideResponse = await completeTask(overrideTaskId, overrideUserId, overrideReason);
    expect(overrideResponse.status).toBe(200);

    const overrideState = await sql.query<{
      status: string;
      completedById: string;
      action: string;
      eventOverride: boolean;
      eventCompletedById: string;
    }>(
      `SELECT t."status", t."completedById", e."action",
              (e."data"->>'override')::boolean AS "eventOverride",
              e."data"->>'completedById' AS "eventCompletedById"
         FROM "Task" t JOIN "TaskEvent" e ON e."taskId" = t."id"
        WHERE t."id" = $1::uuid`,
      [overrideTaskId],
    );
    expect(overrideState.rows).toEqual([
      {
        status: 'COMPLETED',
        completedById: overrideUserId,
        action: 'OVERRIDE_COMPLETED',
        eventOverride: true,
        eventCompletedById: overrideUserId,
      },
    ]);

    const audit = await waitForAudit(overrideTaskId);
    expect(audit.actorId).toBe(overrideUserId);
    expect(audit.metadata).toMatchObject({ override: true, reason: overrideReason });
    const auditRecord = await sql.query<{ action: string; actorId: string; entityId: string }>(
      `SELECT "action", "actorId", "entityId" FROM "AuditLog"
        WHERE "entityType" = 'Task' AND "entityId" = $1::uuid AND "actorId" = $2::uuid
          AND "action" = 'COMPLETE'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [overrideTaskId, overrideUserId],
    );
    expect(auditRecord.rows).toEqual([
      { action: 'COMPLETE', actorId: overrideUserId, entityId: overrideTaskId },
    ]);
  }, 60_000);

  it('vraća task i outbox mutacije kada TaskEvent insert padne unutar transakcije', async () => {
    if (!sql || !app) throw new Error('P7 test nije inicijalizovan.');

    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `p7_fail_event_${suffix}`;
    const triggerName = `p7_fail_event_${suffix}`;
    await sql.query(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $p7$
      BEGIN
        IF NEW."taskId" = '${rollbackTaskId}'::uuid THEN
          RAISE EXCEPTION 'P7_INJECTED_TASK_EVENT_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $p7$;
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "TaskEvent"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    let response: Response;
    try {
      response = await completeTask(rollbackTaskId, assigneeId);
    } finally {
      await sql.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON "TaskEvent"`);
      await sql.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: { code?: string; requestId?: string } };
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    const requestId = body.error?.requestId;
    expect(requestId).toBeTruthy();
    if (!requestId) throw new Error('P7 rollback response nema requestId.');

    const state = await sql.query<{
      status: string;
      version: number;
      completedAt: Date | null;
      eventCount: string;
      completionOutboxCount: string;
    }>(
      `SELECT t."status", t."version", t."completedAt",
              COUNT(DISTINCT e."id")::text AS "eventCount",
              (SELECT COUNT(*)::text FROM "OutboxEvent" o
                WHERE o."aggregateId" = t."id" AND o."eventType" = 'TASK_COMPLETED') AS "completionOutboxCount"
         FROM "Task" t LEFT JOIN "TaskEvent" e ON e."taskId" = t."id"
        WHERE t."id" = $1::uuid GROUP BY t."id"`,
      [rollbackTaskId],
    );
    expect(state.rows).toEqual([
      {
        status: 'IN_PROGRESS',
        version: 1,
        completedAt: null,
        eventCount: '0',
        completionOutboxCount: '0',
      },
    ]);

    const failedAudit = await waitForAuditRequest(requestId);
    expect(failedAudit).toEqual({ success: false, reason: 'INTERNAL_ERROR' });
  }, 60_000);
});
