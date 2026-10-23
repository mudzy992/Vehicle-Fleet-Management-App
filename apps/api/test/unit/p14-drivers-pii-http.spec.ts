import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  type PermissionGrant,
  type RoleCode,
} from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { DriversController } from '../../src/modules/drivers/drivers.controller.js';
import { DriversService } from '../../src/modules/drivers/drivers.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { asPrisma, FakeDriverPrisma } from '../helpers/drivers-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const DRIVER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FORM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FORM_VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function actorFor(roleName: string): AuthenticatedUser {
  const role = roleName as RoleCode;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const grants: readonly PermissionGrant[] =
    roleName === 'SCOPED_VIEW'
      ? [
          {
            permission: 'driver:view',
            scope: 'DRIVER_IDS',
            scopeDriverIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
          },
        ]
      : defaultGrantsForRole(role);
  return {
    id: `p14-${roleName.toLowerCase()}`,
    email: 'actor@example.ba',
    roles: [role],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-driver-session',
    jti: 'p14-driver-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({
      roles: [role],
      grants,
      clientType: 'WEB',
    }),
  };
}

describe('P14 — driver PII HTTP response', () => {
  let app: INestApplication;
  let baseUrl: string;
  const prisma = new FakeDriverPrisma();
  prisma.addDriver({
    id: DRIVER_ID,
    firstName: 'Fikret',
    lastName: 'Hodžić',
    phone: '+387 61 111 222',
    email: 'fikret.hodzic@example.ba',
    dateOfBirth: new Date('1985-04-12T00:00:00.000Z'),
    address: 'Ulica 1, Sarajevo',
    licenseNumber: 'BA-123456',
    notes: 'Privatna napomena',
    formData: { emergencyContact: 'Selma 061 000 000' },
    formSchemaId: FORM_ID,
    formSchemaVersionId: FORM_VERSION_ID,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    const permissions = {
      snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
      currentPermissionsVersion: vi.fn(async () => 0),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DriversController],
      providers: [
        Reflector,
        PermissionsGuard,
        DriversService,
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
        const rawRole = request.headers['x-sweep-role'];
        const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
        if (role) request.user = actorFor(role);
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

  it('administratoru vraća maskiran PII kroz stvarni controller i servis', async () => {
    const response = await fetch(`${baseUrl}/drivers/${DRIVER_ID}`, {
      headers: { 'x-sweep-role': 'ADMINISTRATOR' },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.piiRedacted).toBe(true);
    expect(body.phone).toBe('•••••222');
    expect(body.email).toBe('f***@example.ba');
    expect(body.dateOfBirth).toBeNull();
    expect(body.address).toBeNull();
    expect(body.licenseNumber).toBe('•••••456');
    expect(body.notes).toBeNull();
    expect(body.formData).toEqual({});
  });

  it('driver:view s DRIVER_IDS opsegom ne otkriva zapis izvan dodijeljene liste', async () => {
    const response = await fetch(`${baseUrl}/drivers/${DRIVER_ID}`, {
      headers: { 'x-sweep-role': 'SCOPED_VIEW' },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
  });

  it('SUPER_ADMIN dobija PII kroz istu rutu; OBICNI_KORISNIK bez driver:view dobija 403', async () => {
    const privilegedResponse = await fetch(`${baseUrl}/drivers/${DRIVER_ID}`, {
      headers: { 'x-sweep-role': 'SUPER_ADMIN' },
    });
    const privilegedBody = (await privilegedResponse.json()) as Record<string, unknown>;
    expect(privilegedResponse.status).toBe(200);
    expect(privilegedBody.piiRedacted).toBe(false);
    expect(privilegedBody.phone).toBe('+387 61 111 222');
    expect(privilegedBody.email).toBe('fikret.hodzic@example.ba');
    expect(privilegedBody.dateOfBirth).toBe('1985-04-12');
    expect(privilegedBody.address).toBe('Ulica 1, Sarajevo');
    expect(privilegedBody.licenseNumber).toBe('BA-123456');
    expect(privilegedBody.notes).toBe('Privatna napomena');
    expect(privilegedBody.formData).toEqual({ emergencyContact: 'Selma 061 000 000' });

    const deniedResponse = await fetch(`${baseUrl}/drivers/${DRIVER_ID}`, {
      headers: { 'x-sweep-role': 'OBICNI_KORISNIK' },
    });
    expect(deniedResponse.status).toBe(403);
    expect(((await deniedResponse.json()) as { error: { code: string } }).error.code).toBe(
      'PERMISSION_DENIED',
    );
  });
});
