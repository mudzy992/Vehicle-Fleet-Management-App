import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { FormSchemasController } from '../../src/modules/form-schemas/form-schemas.controller.js';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakeFormPrisma, asPrisma } from './form-schemas-fake.js';

const FORM_PERMISSIONS = [
  'form:view',
  'form:create',
  'form:update',
  'form:manage_schema',
  'form:publish_version',
  'form:retire_version',
] as const;

function actor(): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = FORM_PERMISSIONS.map((permission) => ({
    permission,
    scope: 'ALL',
    scopeVehicleIds: [],
  }));
  return {
    id: '018f0000-0000-7000-8000-0000000000aa',
    roles: ['CUSTOM'],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'form-version-session',
    jti: 'form-version-jti',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

export interface FormVersionHttpApp {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly prisma: FakeFormPrisma;
}

export async function startFormVersionHttpApp(): Promise<FormVersionHttpApp> {
  const prisma = new FakeFormPrisma();
  const moduleRef = await Test.createTestingModule({
    controllers: [FormSchemasController],
    providers: [
      Reflector,
      PermissionsGuard,
      FormSchemasService,
      { provide: PrismaService, useValue: asPrisma(prisma) },
      {
        provide: PermissionsService,
        useValue: {
          snapshot: async () => ({ permissionsVersion: 0 }),
          currentPermissionsVersion: async () => 0,
        },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use((request: { user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
    request.user = actor();
    next();
  });
  app.useGlobalGuards(app.get(PermissionsGuard));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, prisma };
}

export async function apiJson(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; payload: unknown; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    payload: text.length > 0 ? (JSON.parse(text) as unknown) : null,
    headers: response.headers,
  };
}

export function payloadData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export function taskFormPayload(
  prisma: FakeFormPrisma,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const taskTypeId = typeof patch.taskTypeId === 'string' ? patch.taskTypeId : randomUUID();
  prisma.addTaskType({ id: taskTypeId });
  return { subject: 'TASK', taskTypeId, role: 'ORDER', ...patch };
}
