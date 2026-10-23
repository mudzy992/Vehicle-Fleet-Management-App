import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const VEHICLE_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEHICLE_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SERVICE_ONE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const SERVICE_TWO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

type Scenario = 'VEHICLE_ONE' | 'NO_VIEW';
type ServiceRow = {
  id: string;
  vehicleId: string;
  serviceDate: Date;
  serviceType: string;
  workshopName: string | null;
  description: string | null;
  odometerKm: number;
  totalCost: number;
  currency: string;
  nextServiceDueDate: Date | null;
  nextServiceDueKm: number | null;
  status: string;
  formSchemaId: string;
  formSchemaVersionId: string;
  version: number;
  createdById: string | null;
  deletedAt: Date | null;
};

function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] =
    scenario === 'VEHICLE_ONE'
      ? [{ permission: 'service:view', scope: 'VEHICLE_IDS', scopeVehicleIds: [VEHICLE_ONE] }]
      : [];
  return {
    id: `p14-${scenario.toLowerCase()}`,
    roles: ['CUSTOM'],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-service-session',
    jti: 'p14-service-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

function makeRow(id: string, vehicleId: string): ServiceRow {
  return {
    id,
    vehicleId,
    serviceDate: new Date('2026-10-01T00:00:00.000Z'),
    serviceType: 'MALI_SERVIS',
    workshopName: 'Test servis',
    description: null,
    odometerKm: 12000,
    totalCost: 12345,
    currency: 'BAM',
    nextServiceDueDate: new Date('2027-10-01T00:00:00.000Z'),
    nextServiceDueKm: 27000,
    status: 'ACTIVE',
    formSchemaId: SERVICE_ONE,
    formSchemaVersionId: SERVICE_ONE,
    version: 0,
    createdById: 'seed-user',
    deletedAt: null,
  };
}

function matches(row: ServiceRow, where: Record<string, unknown> = {}): boolean {
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (typeof where.vehicleId === 'string' && row.vehicleId !== where.vehicleId) return false;
  if (where.vehicleId && typeof where.vehicleId === 'object') {
    const ids = (where.vehicleId as { in?: readonly string[] }).in;
    if (ids && !ids.includes(row.vehicleId)) return false;
  }
  const and = where.AND as readonly Record<string, unknown>[] | undefined;
  return !and || and.every((condition) => matches(row, condition));
}

describe('P14 — service scope HTTP rute', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const rows = [makeRow(SERVICE_ONE, VEHICLE_ONE), makeRow(SERVICE_TWO, VEHICLE_TWO)];
    const delegate = {
      count: vi.fn(
        async ({ where }: { where?: Record<string, unknown> }) =>
          rows.filter((row) => matches(row, where)).length,
      ),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, where)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where?: Record<string, unknown> }) =>
          rows.find((row) => matches(row, where)) ?? null,
      ),
    };
    const prisma = { serviceRecord: delegate } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [
        Reflector,
        PermissionsGuard,
        ServicesService,
        { provide: PrismaService, useValue: prisma },
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

  it('service:view VEHICLE_IDS filtrira HTTP listu i blokira direktan GET tuđeg zapisa', async () => {
    const listResponse = await fetch(`${baseUrl}/services?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    const list = (await listResponse.json()) as { total: number; items: Array<{ vehicleId: string }> };
    expect(listResponse.status).toBe(200);
    expect(list.total).toBe(1);
    expect(list.items.map((item) => item.vehicleId)).toEqual([VEHICLE_ONE]);

    const assignedRecord = await fetch(`${baseUrl}/services/${SERVICE_ONE}`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    expect(assignedRecord.status).toBe(200);

    const unassignedRecord = await fetch(`${baseUrl}/services/${SERVICE_TWO}`, {
      headers: { 'x-sweep-role': 'VEHICLE_ONE' },
    });
    expect(unassignedRecord.status).toBe(403);
    expect(((await unassignedRecord.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
  });

  it('bez service:view zahtjev se odbija prije podataka', async () => {
    const response = await fetch(`${baseUrl}/services?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
  });
});
