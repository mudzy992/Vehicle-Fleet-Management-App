import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { TireInstallationsController } from '../../src/modules/tires/tire-installations.controller.js';
import { TireInstallationsService } from '../../src/modules/tires/tire-installations.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const VEHICLE_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
type Scenario = 'VEHICLE_ONE' | 'NO_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'VEHICLE_ONE'
    ? [{ permission: 'tire:view', scope: 'VEHICLE_IDS', scopeVehicleIds: [VEHICLE_ONE] }]
    : [];
  return {
    id: `p14-${scenario.toLowerCase()}`,
    roles: ['CUSTOM'], roleIds: [], clientType: 'WEB', sessionId: 'p14-tire-install-session',
    jti: 'p14-tire-install-token', tokenVersion: 1, permissionsVersion: 0,
    isSuperAdmin: false, mustChangePassword: false, status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — tire installation scope HTTP rute', () => {
  let app: INestApplication;
  let baseUrl: string;
  const count = vi.fn(async () => 0);
  const findMany = vi.fn(async () => []);

  beforeAll(async () => {
    const prisma = { tireInstallation: { count, findMany } } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [TireInstallationsController],
      providers: [
        Reflector, PermissionsGuard, TireInstallationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      const scenario = request.headers['x-sweep-role'];
      if (scenario) request.user = actorFor((Array.isArray(scenario) ? scenario[0] : scenario) as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('tire:view VEHICLE_IDS prenosi ograničenje vozila na HTTP listu', async () => {
    const response = await fetch(`${baseUrl}/tire-installations?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, items: [] });
    const query = findMany.mock.calls.at(-1)?.[0] as unknown as { where: { AND: Array<Record<string, unknown>> } };
    expect(query.where.AND).toEqual([
      { deletedAt: null },
      { vehicleId: { in: [VEHICLE_ONE] } },
    ]);
  });

  it('bez tire:view HTTP zahtjev se odbija prije pristupa podacima', async () => {
    const callsBefore = count.mock.calls.length;
    const response = await fetch(`${baseUrl}/tire-installations?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    expect(count).toHaveBeenCalledTimes(callsBefore);
  });
});
