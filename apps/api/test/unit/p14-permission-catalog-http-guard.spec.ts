import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PermissionsController } from '../../src/modules/roles/roles.controller.js';
import { RolesService } from '../../src/modules/roles/roles.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

type Scenario = 'VIEW' | 'SYNC' | 'NO_PERMISSION';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'VIEW'
    ? [{ permission: 'permission:view', scope: 'ALL', scopeVehicleIds: [] }]
    : scenario === 'SYNC'
      ? [{ permission: 'permission:catalog_sync', scope: 'ALL', scopeVehicleIds: [] }]
      : [];
  return {
    id: `p14-permissions-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: `p14-permissions-session-${scenario.toLowerCase()}`, jti: `p14-permissions-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — katalog dozvola kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    catalog: vi.fn(async () => []),
    syncCatalog: vi.fn(async () => ({ created: 0, updated: 0, total: 0 })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PermissionsController],
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
      const raw = request.headers['x-permission-scenario'];
      request.user = actorFor((Array.isArray(raw) ? raw[0] : raw ?? 'NO_PERMISSION') as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('permission:view štiti katalog, a catalog_sync štiti sync prije poziva servisa', async () => {
    const deniedCatalog = await fetch(`${baseUrl}/permissions`, {
      headers: { 'x-permission-scenario': 'NO_PERMISSION' },
    });
    expect(deniedCatalog.status).toBe(403);
    expect(service.catalog).not.toHaveBeenCalled();

    const allowedCatalog = await fetch(`${baseUrl}/permissions`, {
      headers: { 'x-permission-scenario': 'VIEW' },
    });
    expect(allowedCatalog.status).toBe(200);
    expect(service.catalog).toHaveBeenCalledOnce();

    const deniedSync = await fetch(`${baseUrl}/permissions/sync`, {
      method: 'POST', headers: { 'x-permission-scenario': 'VIEW' },
    });
    expect(deniedSync.status).toBe(403);
    expect(service.syncCatalog).not.toHaveBeenCalled();

    const allowedSync = await fetch(`${baseUrl}/permissions/sync`, {
      method: 'POST', headers: { 'x-permission-scenario': 'SYNC' },
    });
    expect(allowedSync.status).toBe(201);
    expect(service.syncCatalog).toHaveBeenCalledOnce();
  });
});
