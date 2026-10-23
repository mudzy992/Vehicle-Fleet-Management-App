import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { InsurancesController } from '../../src/modules/insurances/insurances.controller.js';
import { InsurancesService } from '../../src/modules/insurances/insurances.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { asPrisma, baseInsuranceInput, FakePeriodPrisma } from '../helpers/periods-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const VEHICLE_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEHICLE_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

type Scenario = 'VEHICLE_ONE' | 'VEHICLE_TWO' | 'NO_VIEW';

function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] =
    scenario === 'NO_VIEW'
      ? []
      : [
          {
            permission: 'insurance:view',
            scope: 'VEHICLE_IDS',
            scopeVehicleIds: [scenario === 'VEHICLE_ONE' ? VEHICLE_ONE : VEHICLE_TWO],
          },
        ];
  return {
    id: `p14-${scenario.toLowerCase()}`,
    roles: ['CUSTOM'],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-insurance-session',
    jti: 'p14-insurance-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — insurances scope HTTP rute', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const prisma = new FakePeriodPrisma();
    prisma.addForm('INSURANCE');
    prisma.addVehicle({ id: VEHICLE_ONE });
    prisma.addVehicle({ id: VEHICLE_TWO });
    const seedService = new InsurancesService(asPrisma(prisma));
    await seedService.create(baseInsuranceInput(VEHICLE_ONE) as never, 'seed-user');
    await seedService.create(
      baseInsuranceInput(VEHICLE_TWO, { policyNumber: 'POL-002' }) as never,
      'seed-user',
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [InsurancesController],
      providers: [
        Reflector,
        PermissionsGuard,
        InsurancesService,
        { provide: PrismaService, useValue: asPrisma(prisma) },
        {
          provide: PermissionsService,
          useValue: {
            snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
            currentPermissionsVersion: vi.fn(async () => 0),
          },
        },
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
        if (scenario) request.user = actorFor(scenario as Scenario);
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

  it('insurance:view scope VEHICLE_IDS filtrira listu polisa na vozila dodijeljena akteru', async () => {
    const firstResponse = await fetch(`${baseUrl}/insurances?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    const firstBody = (await firstResponse.json()) as { total: number; items: Array<{ vehicleId: string }> };
    expect(firstResponse.status).toBe(200);
    expect(firstBody.total).toBe(1);
    expect(firstBody.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual([VEHICLE_ONE]);

    const secondResponse = await fetch(`${baseUrl}/insurances?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'VEHICLE_TWO' },
    });
    const secondBody = (await secondResponse.json()) as {
      total: number;
      items: Array<{ vehicleId: string }>;
    };
    expect(secondResponse.status).toBe(200);
    expect(secondBody.total).toBe(1);
    expect(secondBody.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual([VEHICLE_TWO]);
  });

  it('bez insurance:view zahtjev se odbija prije podataka', async () => {
    const response = await fetch(`${baseUrl}/insurances?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
  });
});
