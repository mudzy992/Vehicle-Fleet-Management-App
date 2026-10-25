import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { DeviceTokensController } from '../../src/modules/notifications/device-tokens.controller.js';
import { DeviceTokensService } from '../../src/modules/notifications/device-tokens.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const USER_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const USER_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const DEVICE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const now = new Date('2026-10-25T08:00:00.000Z');
const deviceRow = {
  id: DEVICE_ID,
  platform: 'android',
  appVersion: '1.0.0',
  deviceModel: null,
  osVersion: null,
  locale: null,
  status: 'ACTIVE',
  lastSeenAt: now,
  failureCount: 0,
  createdAt: now,
  revokedAt: null,
};

type Scenario = 'USER_ONE' | 'USER_TWO' | 'NO_PERMISSION';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] =
    scenario === 'NO_PERMISSION'
      ? []
      : [{ permission: 'notification:manage_preferences', scope: 'ALL', scopeVehicleIds: [] }];
  return {
    id: scenario === 'USER_TWO' ? USER_TWO : USER_ONE,
    roles: ['CUSTOM'],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'device-token-http-session',
    jti: 'device-token-http-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('DeviceToken HTTP — owner scope', () => {
  let app: INestApplication;
  let baseUrl: string;
  const findMany = vi.fn(async () => [deviceRow]);
  const findUnique = vi.fn(async () => null);
  const create = vi.fn(async () => deviceRow);
  const update = vi.fn(async () => deviceRow);
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const cancelDeliveries = vi.fn(async () => ({ count: 0 }));
  const transaction = vi.fn(
    async (
      callback: (client: {
        notificationDelivery: { updateMany: typeof cancelDeliveries };
        deviceToken: { deleteMany: typeof deleteMany };
      }) => Promise<unknown>,
    ) =>
      callback({
        notificationDelivery: { updateMany: cancelDeliveries },
        deviceToken: { deleteMany },
      }),
  );

  beforeAll(async () => {
    const prisma = {
      deviceToken: { findMany, findUnique, create, update },
      $transaction: transaction,
    } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [DeviceTokensController],
      providers: [
        Reflector,
        PermissionsGuard,
        DeviceTokensService,
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
        const scenario = request.headers['x-test-actor'];
        if (scenario) request.user = actorFor((Array.isArray(scenario) ? scenario[0] : scenario) as Scenario);
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([deviceRow]);
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(deviceRow);
    update.mockResolvedValue(deviceRow);
    deleteMany.mockResolvedValue({ count: 0 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lista samo uređaje aktera i ne vraća sirovi token/hash', async () => {
    const response = await fetch(`${baseUrl}/devices/tokens`, { headers: { 'x-test-actor': 'USER_ONE' } });
    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ONE } }));
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({ id: DEVICE_ID, platform: 'android', status: 'ACTIVE' });
    expect(body.items[0]).not.toHaveProperty('token');
    expect(body.items[0]).not.toHaveProperty('tokenHash');
  });

  it('registruje token pod authenticated ownerom i odbacuje forged userId', async () => {
    const response = await fetch(`${baseUrl}/devices/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'USER_ONE' },
      body: JSON.stringify({ token: 'http-test-device-token', platform: 'ios' }),
    });
    expect(response.status).toBe(201);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: expect.any(String) } }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: USER_ONE, platform: 'ios' }) }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('tokenHash');

    const forged = await fetch(`${baseUrl}/devices/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'USER_ONE' },
      body: JSON.stringify({ token: 'another-token', platform: 'android', userId: USER_TWO }),
    });
    expect(forged.status).toBe(422);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('opoziv je owner-scoped i tuđi ID vraća 404', async () => {
    const response = await fetch(`${baseUrl}/devices/tokens/${DEVICE_ID}`, {
      method: 'DELETE',
      headers: { 'x-test-actor': 'USER_ONE' },
    });
    expect(response.status).toBe(404);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: DEVICE_ID, userId: USER_ONE } });
  });

  it('zahtijeva notification:manage_preferences prije pristupa bazi', async () => {
    const response = await fetch(`${baseUrl}/devices/tokens`, {
      headers: { 'x-test-actor': 'NO_PERMISSION' },
    });
    expect(response.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
});
