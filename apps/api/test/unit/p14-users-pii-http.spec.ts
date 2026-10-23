import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { UsersController } from '../../src/modules/users/users.controller.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { PasswordService } from '../../src/modules/auth/services/password.service.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { asPrismaService, FakePrismaClient } from '../helpers/fake-prisma.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function actorFor(scenario: 'VIEW_WITH_OWN_PII' | 'VIEW_WITHOUT_PII'): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = [
    { permission: 'user:view', scope: 'ALL' },
    ...(scenario === 'VIEW_WITH_OWN_PII' ? [{ permission: 'user:view_pii', scope: 'OWN' as const }] : []),
  ];
  return {
    id: ACTOR_ID,
    roles: ['CUSTOM'],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-users-session',
    jti: 'p14-users-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — user PII HTTP response', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const prisma = new FakePrismaClient();
    prisma.addRole({ id: ROLE_ID, code: 'CUSTOM', name: 'Custom role' });
    prisma.addUser({
      id: ACTOR_ID,
      email: 'actor.private@example.ba',
      passwordHash: 'unused-test-hash',
      firstName: 'Amina',
      lastName: 'Akter',
      phone: '+387 61 111 222',
    });
    prisma.addUserRole({ userId: ACTOR_ID, roleId: ROLE_ID });
    prisma.addUser({
      id: TARGET_ID,
      email: 'target.private@example.ba',
      passwordHash: 'unused-test-hash',
      firstName: 'Tarik',
      lastName: 'Testić',
      phone: '+387 62 333 444',
    });
    prisma.addUserRole({ userId: TARGET_ID, roleId: ROLE_ID });

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        Reflector,
        PermissionsGuard,
        UsersService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: PasswordService, useValue: {} },
        { provide: TokenService, useValue: {} },
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
        if (scenario) request.user = actorFor(scenario as 'VIEW_WITH_OWN_PII' | 'VIEW_WITHOUT_PII');
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

  it('user:view_pii:OWN otkriva vlastite podatke, ali ne tuđe', async () => {
    const ownResponse = await fetch(`${baseUrl}/users/${ACTOR_ID}`, {
      headers: { 'x-sweep-role': 'VIEW_WITH_OWN_PII' },
    });
    const own = await ownResponse.json();
    expect(ownResponse.status).toBe(200);
    expect(own.piiRedacted).toBe(false);
    expect(own.email).toBe('actor.private@example.ba');
    expect(own.phone).toBe('+387 61 111 222');

    const otherResponse = await fetch(`${baseUrl}/users/${TARGET_ID}`, {
      headers: { 'x-sweep-role': 'VIEW_WITH_OWN_PII' },
    });
    const other = await otherResponse.json();
    expect(otherResponse.status).toBe(200);
    expect(other.piiRedacted).toBe(true);
    expect(other.email).toBe('t***@example.ba');
    expect(other.phone).toBe('•••••444');
  });

  it('bez user:view_pii maskira PII čak i kada user:view dopušta pristup zapisu', async () => {
    const response = await fetch(`${baseUrl}/users/${TARGET_ID}`, {
      headers: { 'x-sweep-role': 'VIEW_WITHOUT_PII' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.piiRedacted).toBe(true);
    expect(body.email).toBe('t***@example.ba');
    expect(body.phone).toBe('•••••444');
  });
});
