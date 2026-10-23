import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { TaskTypesController } from '../../src/modules/task-types/task-types.controller.js';
import { TaskTypesService } from '../../src/modules/task-types/task-types.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

type Scenario = 'VIEW' | 'CREATE' | 'NO_PERMISSION';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'VIEW'
    ? [{ permission: 'task_type:view', scope: 'ALL', scopeVehicleIds: [] }]
    : scenario === 'CREATE'
      ? [{ permission: 'task_type:create', scope: 'ALL', scopeVehicleIds: [] }]
      : [];
  return {
    id: `p14-task-types-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: `p14-task-types-session-${scenario.toLowerCase()}`, jti: `p14-task-types-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — zaštita konfiguracije task-types kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ data: { id: 'task-type-id' }, after: {} })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TaskTypesController],
      providers: [
        Reflector, PermissionsGuard,
        { provide: TaskTypesService, useValue: service },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      const scenario = request.headers['x-task-type-scenario'];
      request.user = actorFor((Array.isArray(scenario) ? scenario[0] : scenario ?? 'NO_PERMISSION') as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('view i create dozvole se provjeravaju prije pristupa servisu', async () => {
    const deniedList = await fetch(`${baseUrl}/task-types`, {
      headers: { 'x-task-type-scenario': 'NO_PERMISSION' },
    });
    expect(deniedList.status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();

    const allowedList = await fetch(`${baseUrl}/task-types`, {
      headers: { 'x-task-type-scenario': 'VIEW' },
    });
    expect(allowedList.status).toBe(200);
    expect(service.list).toHaveBeenCalledOnce();

    const deniedCreate = await fetch(`${baseUrl}/task-types`, {
      method: 'POST',
      headers: { 'x-task-type-scenario': 'VIEW', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'P14_TEST', name: 'P14 test' }),
    });
    expect(deniedCreate.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();

    const allowedCreate = await fetch(`${baseUrl}/task-types`, {
      method: 'POST',
      headers: { 'x-task-type-scenario': 'CREATE', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'P14_TEST', name: 'P14 test' }),
    });
    expect(allowedCreate.status).toBe(201);
    expect(service.create).toHaveBeenCalledOnce();
  });
});
