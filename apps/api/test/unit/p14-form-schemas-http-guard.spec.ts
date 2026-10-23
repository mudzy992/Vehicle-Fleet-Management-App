import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { FormSchemasController } from '../../src/modules/form-schemas/form-schemas.controller.js';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

function actorFor(allowed: boolean): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = allowed
    ? [{ permission: 'form:view', scope: 'ALL', scopeVehicleIds: [] }]
    : [];
  const identity = allowed ? 'allowed' : 'denied';
  return {
    id: `p14-form-schema-${identity}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: `p14-form-schema-session-${identity}`, jti: `p14-form-schema-${identity}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — zaštita form-schemas kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    list: vi.fn(async () => []),
    active: vi.fn(async () => ({ contentHash: 'test-hash', definition: {} })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FormSchemasController],
      providers: [
        Reflector, PermissionsGuard,
        { provide: FormSchemasService, useValue: service },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      request.user = actorFor(request.headers['x-form-view'] === 'yes');
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('form:view blokira listu i aktivnu definiciju prije poziva servisa', async () => {
    const deniedList = await fetch(`${baseUrl}/form-schemas`, { headers: { 'x-form-view': 'no' } });
    expect(deniedList.status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();

    const allowedList = await fetch(`${baseUrl}/form-schemas`, { headers: { 'x-form-view': 'yes' } });
    expect(allowedList.status).toBe(200);
    expect(service.list).toHaveBeenCalledOnce();

    const deniedActive = await fetch(`${baseUrl}/form-schemas/active?subject=TASK`, {
      headers: { 'x-form-view': 'no' },
    });
    expect(deniedActive.status).toBe(403);
    expect(service.active).not.toHaveBeenCalled();
  });
});
