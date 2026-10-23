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
type Scenario = 'CREATE' | 'UPDATE' | 'ARCHIVE' | 'NO_PERMISSION';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'CREATE'
    ? [{ permission: 'role:create', scope: 'ALL', scopeVehicleIds: [] }]
    : scenario === 'UPDATE'
      ? [{ permission: 'role:update', scope: 'ALL', scopeVehicleIds: [] }]
      : scenario === 'ARCHIVE'
        ? [{ permission: 'role:archive', scope: 'ALL', scopeVehicleIds: [] }]
        : [];
  return {
    id: `p14-role-lifecycle-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: `p14-role-lifecycle-session-${scenario.toLowerCase()}`, jti: `p14-role-lifecycle-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — kreiranje i arhiviranje uloga kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    create: vi.fn(async () => ({
      before: undefined, after: { code: 'P14_ROLE' },
      data: { id: ROLE_ID, code: 'P14_ROLE', name: 'P14 uloga' },
    })),
    update: vi.fn(async () => ({
      before: { name: 'Stara uloga' }, after: { name: 'Nova uloga' },
      data: { id: ROLE_ID, code: 'P14_ROLE', name: 'Nova uloga' },
    })),
    archive: vi.fn(async () => ({
      before: { archivedAt: null }, after: { archivedAt: '2026-10-23T00:00:00.000Z' },
      data: { archivedAt: '2026-10-23T00:00:00.000Z' },
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
      const raw = request.headers['x-role-lifecycle'];
      request.user = actorFor((Array.isArray(raw) ? raw[0] : raw ?? 'NO_PERMISSION') as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('role:create, role:update i role:archive se provjeravaju zasebno prije mutacije', async () => {
    const validCreate = { code: 'P14_ROLE', name: 'P14 uloga' };
    const deniedCreate = await fetch(`${baseUrl}/roles`, {
      method: 'POST',
      headers: { 'x-role-lifecycle': 'NO_PERMISSION', 'content-type': 'application/json' },
      body: JSON.stringify(validCreate),
    });
    expect(deniedCreate.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();

    const allowedCreate = await fetch(`${baseUrl}/roles`, {
      method: 'POST',
      headers: { 'x-role-lifecycle': 'CREATE', 'content-type': 'application/json' },
      body: JSON.stringify(validCreate),
    });
    expect(allowedCreate.status).toBe(201);
    expect(service.create).toHaveBeenCalledOnce();

    const deniedUpdate = await fetch(`${baseUrl}/roles/${ROLE_ID}`, {
      method: 'PATCH',
      headers: { 'x-role-lifecycle': 'CREATE', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nova uloga' }),
    });
    expect(deniedUpdate.status).toBe(403);
    expect(service.update).not.toHaveBeenCalled();

    const allowedUpdate = await fetch(`${baseUrl}/roles/${ROLE_ID}`, {
      method: 'PATCH',
      headers: { 'x-role-lifecycle': 'UPDATE', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nova uloga' }),
    });
    expect(allowedUpdate.status).toBe(200);
    expect(service.update).toHaveBeenCalledOnce();

    const deniedArchive = await fetch(`${baseUrl}/roles/${ROLE_ID}/archive`, {
      method: 'POST',
      headers: { 'x-role-lifecycle': 'CREATE', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'P14 provjera' }),
    });
    expect(deniedArchive.status).toBe(403);
    expect(service.archive).not.toHaveBeenCalled();

    const allowedArchive = await fetch(`${baseUrl}/roles/${ROLE_ID}/archive`, {
      method: 'POST',
      headers: { 'x-role-lifecycle': 'ARCHIVE', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'P14 provjera' }),
    });
    expect(allowedArchive.status).toBe(204);
    expect(service.archive).toHaveBeenCalledOnce();
  });
});
