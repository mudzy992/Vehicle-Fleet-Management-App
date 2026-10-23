/**
 * `UsersController` — ugovor prema docs/07 §2.2 (P14).
 *
 * Provjerava:
 * - **permisije po ruti** — direktan poziv URL-a bez prava mora pasti na
 *   `PermissionsGuard`-u (ne u servisu),
 * - **audit** — `DELETE` je `CRITICAL`, reset i dodjela rola `SECURITY`,
 *   a čitanje nije auditovano,
 * - **nema curenja tajni u audit**: privremena lozinka i reset token nikad ne
 *   idu u `AuditContext`/`AuditLog`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { CreateUserResult, PasswordResetIssued, UserDetail } from '@vfm/shared/schemas';
import { AuditContext } from '../../src/common/audit/audit.types.js';
import {
  AUDIT_METADATA_KEY,
  REQUIRED_PERMISSIONS_KEY,
  type AuditMetadata,
} from '../../src/common/decorators/auth.decorators.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import { __resetEnvCache } from '../../src/config/env.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { UsersController } from '../../src/modules/users/users.controller.js';
import { UsersModule } from '../../src/modules/users/users.module.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { FakeRedis, fakeRedisService } from '../helpers/rbac-fakes.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const USER_ID = '018f0000-0000-7000-8000-000000000002';
const ROLE_ID = '018f0000-0000-7000-8000-0000000000b1';
const ACTOR_ID = '018f0000-0000-7000-8000-000000000001';

const ACTOR: AuthenticatedUser = {
  id: ACTOR_ID,
  email: 'super@vfm.test',
  roles: ['SUPER_ADMIN'],
  roleIds: ['018f0000-0000-7000-8000-0000000000b0'],
  clientType: 'WEB',
  sessionId: '018f0000-0000-7000-8000-0000000000aa',
  jti: '018f0000-0000-7000-8000-0000000000ab',
  tokenVersion: 1,
  permissionsVersion: 1,
  isSuperAdmin: true,
  mustChangePassword: false,
  status: 'ACTIVE',
  allowedClientTypes: ['WEB'],
};

const DETAIL: UserDetail = {
  id: USER_ID,
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  phone: null,
  status: 'ACTIVE',
  mustChangePassword: true,
  roles: [{ id: ROLE_ID, code: 'ADMINISTRATOR', name: 'Administrator' }],
  lastLoginAt: null,
  lockedUntil: null,
  piiRedacted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  timezone: 'Europe/Sarajevo',
  locale: 'bs',
  tokenVersion: 1,
  activeSessions: 0,
};

function permissionsOf(handler: object): string[] {
  const metadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler) as
    | { permissions: string[] }
    | undefined;
  return metadata?.permissions ?? [];
}

function auditOf(handler: object): AuditMetadata | undefined {
  return Reflect.getMetadata(AUDIT_METADATA_KEY, handler) as AuditMetadata | undefined;
}

function fakeRequest(): VfmRequest {
  return { method: 'POST', url: '/api/v1/users', headers: {} } as unknown as VfmRequest;
}

function fakeService() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const mutation = <T>(data: T) => ({
    data,
    before: { firstName: 'Ana' },
    after: { firstName: 'Ana Marija' },
    meta: { revokedSessions: 2, roleCode: 'ADMINISTRATOR', action: 'ASSIGNED' },
  });

  const service = {
    list: async (query: unknown, actor: unknown) => {
      calls.push({ method: 'list', args: [query, actor] });
      return { items: [DETAIL], page: 1, pageSize: 20, total: 1, totalPages: 1 };
    },
    get: async (id: string, actor: unknown) => {
      calls.push({ method: 'get', args: [id, actor] });
      return DETAIL;
    },
    create: async (input: unknown, actor: unknown): Promise<CreateUserResult> => {
      calls.push({ method: 'create', args: [input, actor] });
      return { user: DETAIL, temporaryPassword: 'Tajna-lozinka-123!', mustChangePassword: true };
    },
    update: async (id: string, input: unknown, actor: unknown) => {
      calls.push({ method: 'update', args: [id, input, actor] });
      return mutation(DETAIL);
    },
    archive: async (id: string, input: unknown, actor: unknown) => {
      calls.push({ method: 'archive', args: [id, input, actor] });
      return {
        ...mutation({ id, archivedAt: '2026-02-01T10:00:00.000Z' }),
        meta: { revokedSessions: 2, reason: 'prestanak rada' },
      };
    },
    remove: async (id: string, input: unknown, actor: unknown) => {
      calls.push({ method: 'remove', args: [id, input, actor] });
      return mutation({ id, anonymizedAt: '2026-02-01T10:00:00.000Z' });
    },
    assignRole: async (id: string, input: unknown, actor: unknown) => {
      calls.push({ method: 'assignRole', args: [id, input, actor] });
      return mutation(DETAIL);
    },
    removeRole: async (id: string, roleId: string, actor: unknown) => {
      calls.push({ method: 'removeRole', args: [id, roleId, actor] });
      return mutation(DETAIL);
    },
    issuePasswordReset: async (id: string, input: unknown, actor: unknown): Promise<ReturnType<typeof mutation<PasswordResetIssued>>> => {
      calls.push({ method: 'issuePasswordReset', args: [id, input, actor] });
      return mutation({
        userId: id,
        email: 'ana.anic@vfm.test',
        token: 'reset-token-koji-ne-smije-u-audit',
        expiresAt: '2026-02-01T10:30:00.000Z',
        deliveredBy: 'ADMIN' as const,
      });
    },
    forceLogout: async (id: string, actor: unknown) => {
      calls.push({ method: 'forceLogout', args: [id, actor] });
      // Servis vraća snapshot `tokenVersion` prije/poslije (ne ime korisnika).
      return {
        data: { revokedSessions: 2, tokenVersion: 3 },
        before: { id, tokenVersion: 2 },
        after: { id, tokenVersion: 3 },
        meta: { revokedSessions: 2 },
      };
    },
  };

  return { service: service as unknown as UsersService, calls };
}

describe('UsersController — permisije po ruti (P14)', () => {
  it.each([
    ['list', 'user:view'],
    ['get', 'user:view'],
    ['create', 'user:create'],
    ['update', 'user:update'],
    ['archive', 'user:archive'],
    ['remove', 'user:delete'],
    ['assignRole', 'user:assign_role'],
    ['removeRole', 'user:assign_role'],
    ['resetPassword', 'user:reset_password'],
    ['forceLogout', 'user:force_logout'],
  ] as const)('%s traži %s', (method, permission) => {
    const handler = (UsersController.prototype as unknown as Record<string, object | undefined>)[method];
    expect(handler).toBeDefined();
    expect(permissionsOf(handler as object)).toContain(permission);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object)).toMatchObject({ scope: 'ALL' });
  });

  it('nijedna ruta nije javna', () => {
    const isPublic = (handler: object): unknown => Reflect.getMetadata('vfm:isPublic', handler);
    expect(isPublic(UsersController.prototype.list)).toBeUndefined();
    expect(isPublic(UsersController.prototype.resetPassword)).toBeUndefined();
  });
});

describe('UsersController — audit metadata', () => {
  it('DELETE je CRITICAL, reset/role/archive su SECURITY', () => {
    expect(auditOf(UsersController.prototype.remove)).toMatchObject({
      action: 'DELETE',
      severity: 'CRITICAL',
      resource: 'User',
    });
    expect(auditOf(UsersController.prototype.archive)).toMatchObject({ action: 'ARCHIVE', severity: 'SECURITY' });
    expect(auditOf(UsersController.prototype.assignRole)).toMatchObject({ action: 'UPDATE', severity: 'SECURITY' });
    expect(auditOf(UsersController.prototype.forceLogout)).toMatchObject({ action: 'SECURITY' });
    expect(auditOf(UsersController.prototype.resetPassword)).toMatchObject({
      action: 'UPDATE',
      severity: 'SECURITY',
      diff: false,
    });
  });

  it('čitanje i kreiranje nisu SECURITY', () => {
    expect(auditOf(UsersController.prototype.list)).toBeUndefined();
    expect(auditOf(UsersController.prototype.get)).toBeUndefined();
    expect(auditOf(UsersController.prototype.create)).toMatchObject({ action: 'CREATE', severity: 'INFO' });
    expect(auditOf(UsersController.prototype.update)).toMatchObject({ action: 'UPDATE', severity: 'INFO' });
  });
});

describe('UsersController — AuditContext', () => {
  it('create bilježi entityId i snapshot bez privremene lozinke', async () => {
    const { service } = fakeService();
    const controller = new UsersController(service);
    const request = fakeRequest();

    const result = await controller.create(
      { email: 'ana.anic@vfm.test', firstName: 'Ana', lastName: 'Anić', roleIds: [ROLE_ID] },
      ACTOR,
      request,
    );

    expect(result.temporaryPassword).toBe('Tajna-lozinka-123!');
    const context = AuditContext.from(request);
    expect(context.entityId).toBe(USER_ID);
    expect(context.resource).toBe('User');
    expect(JSON.stringify(context.after)).not.toContain('Tajna-lozinka-123!');
    expect(context.after).toMatchObject({ email: 'ana.anic@vfm.test', roles: 'ADMINISTRATOR' });
  });

  it('reset lozinke ne upisuje token u audit', async () => {
    const { service } = fakeService();
    const controller = new UsersController(service);
    const request = fakeRequest();

    const result = await controller.resetPassword(USER_ID, { expiresInMinutes: 30 }, ACTOR, request);

    expect(result.token).toBe('reset-token-koji-ne-smije-u-audit');
    const context = AuditContext.from(request);
    expect(context.entityId).toBe(USER_ID);
    expect(JSON.stringify(context.after)).not.toContain('reset-token-koji-ne-smije-u-audit');
    expect(context.after).toMatchObject({ expiresAt: '2026-02-01T10:30:00.000Z' });
  });

  it('update/archive postavljaju before/after diff', async () => {
    const { service } = fakeService();
    const controller = new UsersController(service);

    const updateRequest = fakeRequest();
    await controller.update(USER_ID, { firstName: 'Ana Marija' }, ACTOR, updateRequest);
    expect(AuditContext.from(updateRequest).before).toMatchObject({ firstName: 'Ana' });
    expect(AuditContext.from(updateRequest).after).toMatchObject({ firstName: 'Ana Marija' });

    const archiveRequest = fakeRequest();
    await controller.archive(USER_ID, { reason: 'prestanak rada' }, ACTOR, archiveRequest);
    expect(AuditContext.from(archiveRequest).meta).toMatchObject({ revokedSessions: 2 });
  });

  it('dodjela i skidanje role bilježe akciju u meta', async () => {
    const { service, calls } = fakeService();
    const controller = new UsersController(service);

    const assignRequest = fakeRequest();
    await controller.assignRole(USER_ID, { roleId: ROLE_ID }, ACTOR, assignRequest);
    expect(AuditContext.from(assignRequest).meta).toMatchObject({ roleChange: { action: 'ASSIGNED' } });

    const removeRequest = fakeRequest();
    await controller.removeRole(USER_ID, ROLE_ID, ACTOR, removeRequest);
    expect(AuditContext.from(removeRequest).meta).toMatchObject({ roleChange: { action: 'ASSIGNED' } });
    expect(calls.at(-1)).toMatchObject({ method: 'removeRole', args: [USER_ID, ROLE_ID, ACTOR] });
  });

  it('force-logout bilježi broj revokovanih sesija i novi tokenVersion', async () => {
    const { service } = fakeService();
    const controller = new UsersController(service);
    const request = fakeRequest();

    const result = await controller.forceLogout(USER_ID, ACTOR, request);

    expect(result).toEqual({ revokedSessions: 2, tokenVersion: 3 });
    expect(AuditContext.from(request).meta).toMatchObject({ revokedSessions: 2 });
    expect(AuditContext.from(request).after).toMatchObject({ tokenVersion: 3 });
  });

  it('list prosljeđuje validiran query i aktera servisu', async () => {
    const { service, calls } = fakeService();
    const controller = new UsersController(service);

    const result = await controller.list({ page: 2, pageSize: 10 }, ACTOR);

    expect(result.total).toBe(1);
    expect(calls.at(-1)).toMatchObject({ method: 'list', args: [{ page: 2, pageSize: 10 }, ACTOR] });
  });
});

describe('UsersModule — DI', () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
    __resetEnvCache();
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = savedSecret;
    __resetEnvCache();
  });

  it('modul se gradi bez infrastrukture (AuthModule daje Password/Token/Permissions servise)', async () => {
    const prisma = new FakePrismaClient();
    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule, RedisModule, PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(asPrismaService(prisma))
      .overrideProvider(RedisService)
      .useValue(fakeRedisService(new FakeRedis(), false))
      .compile();

    expect(moduleRef.get(UsersService)).toBeInstanceOf(UsersService);
    expect(moduleRef.get(UsersModule)).toBeInstanceOf(UsersModule);

    await moduleRef.close();
  });
});
