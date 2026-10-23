import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  type PermissionGrant,
  type RoleCode,
} from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { VehiclesController } from '../../src/modules/vehicles/vehicles.controller.js';
import { VehiclesService } from '../../src/modules/vehicles/vehicles.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { asPrisma, baseInput, FakeVehiclePrisma } from '../helpers/vehicles-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const VEHICLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type SweepScenario =
  'SUPER_ADMIN' | 'ADMINISTRATOR' | 'OBICNI_KORISNIK' | 'NO_GRANTS' | 'ASSIGNED' | 'UNASSIGNED';

function actorFor(scenario: SweepScenario): AuthenticatedUser {
  const role: RoleCode =
    scenario === 'SUPER_ADMIN' || scenario === 'ADMINISTRATOR' || scenario === 'OBICNI_KORISNIK'
      ? scenario
      : 'CUSTOM';
  const grants: readonly PermissionGrant[] =
    scenario === 'ASSIGNED' || scenario === 'UNASSIGNED'
      ? [
          {
            permission: 'vehicle:view',
            scope: 'VEHICLE_IDS',
            scopeVehicleIds:
              scenario === 'ASSIGNED' ? [VEHICLE_ID] : ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
          },
        ]
      : defaultGrantsForRole(role);
  return {
    id: `p14-${scenario.toLowerCase()}`,
    roles: [role],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-vehicle-session',
    jti: 'p14-vehicle-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: scenario === 'SUPER_ADMIN',
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: [role], grants, clientType: 'WEB' }),
  };
}

describe('P14 — vehicle scope HTTP rute', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const prisma = new FakeVehiclePrisma();
    prisma.addForm();
    const seedService = new VehiclesService(asPrisma(prisma));
    await seedService.create(baseInput() as never, 'p14-owner');
    prisma.vehicles[0]!.id = VEHICLE_ID;

    const permissions = {
      snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
      currentPermissionsVersion: vi.fn(async () => 0),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VehiclesController],
      providers: [
        Reflector,
        PermissionsGuard,
        VehiclesService,
        { provide: PrismaService, useValue: asPrisma(prisma) },
        { provide: PermissionsService, useValue: permissions },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser },
        _response: unknown,
        next: () => void,
      ) => {
        const rawScenario = request.headers['x-sweep-role'];
        const scenario = Array.isArray(rawScenario) ? rawScenario[0] : rawScenario;
        if (scenario) request.user = actorFor(scenario as SweepScenario);
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('vehicle:view:ALL ostaje dozvoljen običnom korisniku na stvarnom HTTP endpointu', async () => {
    const response = await fetch(`${baseUrl}/vehicles/${VEHICLE_ID}`, {
      headers: { 'x-sweep-role': 'OBICNI_KORISNIK' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(VEHICLE_ID);
    expect(body.internalNo).toBe('V-001');
  });

  it('odbijeni HTTP zahtjev bez vehicle:view ne vraća podatke', async () => {
    const response = await fetch(`${baseUrl}/vehicles/${VEHICLE_ID}`, {
      headers: { 'x-sweep-role': 'NO_GRANTS' },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('PERMISSION_DENIED');
  });

  it('VEHICLE_IDS opseg dopušta dodijeljeno vozilo, a drugo odbija na servisnoj granici', async () => {
    const assigned = await fetch(`${baseUrl}/vehicles/${VEHICLE_ID}`, {
      headers: { 'x-sweep-role': 'ASSIGNED' },
    });
    expect(assigned.status).toBe(200);

    const unassigned = await fetch(`${baseUrl}/vehicles/${VEHICLE_ID}`, {
      headers: { 'x-sweep-role': 'UNASSIGNED' },
    });
    expect(unassigned.status).toBe(403);
    expect((await unassigned.json()).error.code).toBe('SCOPE_DENIED');
  });
});
