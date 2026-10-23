import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { NotificationsController } from '../../src/modules/notifications/notifications.controller.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const USER_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const USER_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const NOTIFICATION_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

type Scenario = 'USER_ONE' | 'NO_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'USER_ONE'
    ? [
        { permission: 'notification:view', scope: 'ALL', scopeVehicleIds: [] },
        { permission: 'notification:mark_read', scope: 'ALL', scopeVehicleIds: [] },
      ]
    : [];
  return {
    id: scenario === 'USER_ONE' ? USER_ONE : USER_TWO,
    roles: ['CUSTOM'], roleIds: [], clientType: 'WEB', sessionId: 'p14-notification-session',
    jti: 'p14-notification-token', tokenVersion: 1, permissionsVersion: 0,
    isSuperAdmin: false, mustChangePassword: false, status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — vlasništvo nad obavijestima kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => []);
  const count = vi.fn(async () => 0);
  const findFirst = vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === NOTIFICATION_ID && where.userId === USER_TWO ? { id: NOTIFICATION_ID, isRead: false } : null,
  );

  beforeAll(async () => {
    const prisma = { notification: { findMany, count, findFirst } } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        Reflector, PermissionsGuard, NotificationsService,
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

  it('filtrira listu po akteru i ne otkriva obavijest drugog korisnika', async () => {
    const listResponse = await fetch(`${baseUrl}/notifications?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'USER_ONE' },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({ items: [], total: 0 });
    expect(findMany.mock.calls.at(-1)?.[0].where).toEqual({ userId: USER_ONE });

    const otherUserRead = await fetch(`${baseUrl}/notifications/${NOTIFICATION_ID}/read`, {
      method: 'POST',
      headers: { 'x-sweep-role': 'USER_ONE' },
    });
    expect(otherUserRead.status).toBe(404);
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { id: NOTIFICATION_ID, userId: USER_ONE },
      select: { id: true, isRead: true },
    });
  });

  it('bez notification:view odbija HTTP listu prije upita prema bazi', async () => {
    const callsBefore = count.mock.calls.length;
    const response = await fetch(`${baseUrl}/notifications?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    expect(count).toHaveBeenCalledTimes(callsBefore);
  });
});
