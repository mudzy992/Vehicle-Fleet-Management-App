import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { RolesController } from '../../src/modules/roles/roles.controller.js';
import { RolesService } from '../../src/modules/roles/roles.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ROLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
type Scenario = 'VIEW' | 'MANAGE' | 'NO_PERMISSION';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'VIEW'
    ? [{ permission: 'role:view', scope: 'ALL', scopeVehicleIds: [] }]
    : scenario === 'MANAGE'
      ? [{ permission: 'role:manage_permissions', scope: 'ALL', scopeVehicleIds: [] }]
      : [];
  return {
    id: `p14-roles-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: `p14-roles-session-${scenario.toLowerCase()}`, jti: `p14-roles-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — matrica dozvola uloga kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    list: vi.fn(async () => []),
    updateMatrix: vi.fn(async () => ({
      before: {}, after: {},
      data: { affectedRoles: ['CUSTOM'], added: 0, removed: 0, scopeChanged: 0, permissionsVersion: 1 },
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        Reflector, PermissionsGuard,
        { provide: RolesService, useValue: service },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      const raw = request.headers['x-role-scenario'];
      request.user = actorFor((Array.isArray(raw) ? raw[0] : raw ?? 'NO_PERMISSION') as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('role:view čita listu; role:manage_permissions štiti promjenu matrice prije mutacije', async () => {
    const deniedList = await fetch(`${baseUrl}/roles`, { headers: { 'x-role-scenario': 'NO_PERMISSION' } });
    expect(deniedList.status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();

    const allowedList = await fetch(`${baseUrl}/roles`, { headers: { 'x-role-scenario': 'VIEW' } });
    expect(allowedList.status).toBe(200);
    expect(service.list).toHaveBeenCalledOnce();

    const payload = { roles: [{ roleId: ROLE_ID, grants: [] }] };
    const deniedUpdate = await fetch(`${baseUrl}/roles/matrix`, {
      method: 'PUT',
      headers: { 'x-role-scenario': 'VIEW', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(deniedUpdate.status).toBe(403);
    expect(service.updateMatrix).not.toHaveBeenCalled();

    const allowedUpdate = await fetch(`${baseUrl}/roles/matrix`, {
      method: 'PUT',
      headers: { 'x-role-scenario': 'MANAGE', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(allowedUpdate.status).toBe(200);
    expect(service.updateMatrix).toHaveBeenCalledOnce();
  });
});
