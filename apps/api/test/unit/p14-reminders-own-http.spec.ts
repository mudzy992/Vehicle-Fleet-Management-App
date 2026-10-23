import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { RemindersController } from '../../src/modules/reminders/reminders.controller.js';
import { RemindersService } from '../../src/modules/reminders/reminders.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const USER_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEHICLE_ONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const VEHICLE_TWO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const REMINDER_TWO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

type Scenario = 'USER_ONE' | 'NO_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'USER_ONE'
    ? [
        { permission: 'reminder:view', scope: 'OWN', scopeVehicleIds: [] },
        { permission: 'reminder:acknowledge', scope: 'OWN', scopeVehicleIds: [] },
        { permission: 'reminder:snooze', scope: 'OWN', scopeVehicleIds: [] },
      ]
    : [];
  return {
    id: USER_ONE, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: 'p14-reminders-session', jti: `p14-reminders-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — OWN scope podsjetnika kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const reminder = {
    id: REMINDER_TWO, kind: 'REGISTRATION_DUE', entityType: 'Vehicle', entityId: VEHICLE_TWO,
    dueDate: null, dueKm: null, thresholdDays: null, status: 'PENDING', fireAt: new Date('2026-10-23T10:00:00Z'),
    dedupeKey: 'p14-reminder-key', acknowledgedAt: null, acknowledgedById: null,
    createdAt: new Date('2026-10-20T10:00:00Z'), updatedAt: new Date('2026-10-20T10:00:00Z'),
  };
  const count = vi.fn(async () => 0);
  const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => []);
  const findUnique = vi.fn(async () => reminder);
  const update = vi.fn(async () => reminder);
  const vehicleFindMany = vi.fn(async () => [{ id: VEHICLE_ONE }]);
  const vehicleFindFirst = vi.fn(async () => null);
  const driverFindMany = vi.fn(async () => []);

  beforeAll(async () => {
    const prisma = {
      scheduledReminder: { count, findMany, findUnique, update },
      vehicle: { findMany: vehicleFindMany, findFirst: vehicleFindFirst },
      driver: { findMany: driverFindMany },
    } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [RemindersController],
      providers: [
        Reflector, PermissionsGuard, RemindersService,
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

  it('reminder:view OWN ograničava listu na vozila i vozače koje je korisnik kreirao', async () => {
    const response = await fetch(`${baseUrl}/reminders?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'USER_ONE' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [], total: 0 });
    expect(findMany.mock.calls.at(-1)?.[0].where).toMatchObject({
      AND: [
        {},
        { OR: [{ entityType: 'Vehicle', entityId: { in: [VEHICLE_ONE] } }] },
      ],
    });
  });

  it('reminder:acknowledge OWN ne dopušta potvrdu podsjetnika za tuđe vozilo', async () => {
    const response = await fetch(`${baseUrl}/reminders/${REMINDER_TWO}/acknowledge`, {
      method: 'POST', headers: { 'x-sweep-role': 'USER_ONE' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
    expect(vehicleFindFirst).toHaveBeenCalledWith({
      where: { id: VEHICLE_TWO, createdById: USER_ONE, deletedAt: null }, select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('reminder:snooze OWN ne dopušta odgodu podsjetnika za tuđe vozilo', async () => {
    const response = await fetch(`${baseUrl}/reminders/${REMINDER_TWO}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sweep-role': 'USER_ONE' },
      body: JSON.stringify({ days: 2 }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
    expect(vehicleFindFirst).toHaveBeenLastCalledWith({
      where: { id: VEHICLE_TWO, createdById: USER_ONE, deletedAt: null }, select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('bez reminder:view zahtjev se odbija prije čitanja podsjetnika', async () => {
    const callsBefore = count.mock.calls.length;
    const response = await fetch(`${baseUrl}/reminders?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    expect(count).toHaveBeenCalledTimes(callsBefore);
  });
});
