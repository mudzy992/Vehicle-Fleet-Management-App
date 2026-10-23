import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { ServiceItemsController } from '../../src/modules/services/service-items.controller.js';
import { ServiceItemsService } from '../../src/modules/services/service-items.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const VEHICLE_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEHICLE_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SERVICE_ONE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const SERVICE_TWO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

type Scenario = 'VEHICLE_ONE' | 'NO_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'VEHICLE_ONE'
    ? [{ permission: 'service:view', scope: 'VEHICLE_IDS', scopeVehicleIds: [VEHICLE_ONE] }]
    : [];
  return {
    id: `p14-service-items-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [],
    clientType: 'WEB', sessionId: 'p14-service-items-session', jti: 'p14-service-items-token',
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — service items scope HTTP rute', () => {
  let app: INestApplication;
  let baseUrl: string;
  const rows = new Map([
    [SERVICE_ONE, { id: SERVICE_ONE, vehicleId: VEHICLE_ONE, createdById: 'owner-1', version: 1, totalCost: 1250, items: [] }],
    [SERVICE_TWO, { id: SERVICE_TWO, vehicleId: VEHICLE_TWO, createdById: 'owner-2', version: 1, totalCost: 2250, items: [] }],
  ]);
  const findFirst = vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);

  beforeAll(async () => {
    const prisma = { serviceRecord: { findFirst } } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [ServiceItemsController],
      providers: [
        Reflector, PermissionsGuard, ServiceItemsService,
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

  it('service:view VEHICLE_IDS dopušta stavke dodijeljenog servisa, ali blokira tuđi direktni GET', async () => {
    const assigned = await fetch(`${baseUrl}/services/${SERVICE_ONE}/items`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toEqual({ version: 1, totalCost: 1250, items: [] });

    const unassigned = await fetch(`${baseUrl}/services/${SERVICE_TWO}/items`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    expect(unassigned.status).toBe(403);
    expect(((await unassigned.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
  });

  it('bez service:view zahtjev se odbija prije čitanja servisnog zapisa', async () => {
    const callsBefore = findFirst.mock.calls.length;
    const response = await fetch(`${baseUrl}/services/${SERVICE_ONE}/items`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    expect(findFirst).toHaveBeenCalledTimes(callsBefore);
  });
});
