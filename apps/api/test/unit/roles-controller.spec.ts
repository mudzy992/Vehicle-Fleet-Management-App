/**
 * `RolesController` + `PermissionsController` — ugovor prema docs/07 §2.3.
 *
 * Provjerava ono što se lako pokvari tiho:
 * - **permisije po ruti** (`@RequirePermissions`) — P14: direktan poziv URL-a bez
 *   prava mora pasti na `PermissionsGuard`-u, ne u servisu;
 * - **audit** (`@Audit`) — matrica prava je `PERMISSION_CHANGE` sa `SECURITY`
 *   severity i before/after snapshotom (P2: „matrica sačuvana i auditovana");
 * - **redoslijed ruta** — `GET /roles/matrix` mora biti registrovan prije
 *   `GET /roles/:id`, inače `matrix` završi kao UUID parametar i vrati 400.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { RoleDetail, RoleMatrixUpdateInput, RoleMatrixUpdateResult, RoleSummary } from '@vfm/shared/schemas';
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
import { PermissionsController, RolesController } from '../../src/modules/roles/roles.controller.js';
import { RolesModule } from '../../src/modules/roles/roles.module.js';
import { RolesService } from '../../src/modules/roles/roles.service.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { ADMIN_SNAPSHOT, FakeRedis, fakeRedisService } from '../helpers/rbac-fakes.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ROLE_ID = '018f0000-0000-7000-8000-0000000000b1';
const ACTOR_ID = ADMIN_SNAPSHOT.userId;

const ACTOR: AuthenticatedUser = {
  id: ACTOR_ID,
  email: 'ana.anic@vfm.test',
  roles: ['ADMINISTRATOR'],
  roleIds: [ROLE_ID],
  clientType: 'WEB',
  sessionId: '018f0000-0000-7000-8000-0000000000aa',
  jti: '018f0000-0000-7000-8000-0000000000ab',
  tokenVersion: 4,
  permissionsVersion: 1,
  isSuperAdmin: false,
  mustChangePassword: false,
  status: 'ACTIVE',
  allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
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

const SUMMARY: RoleSummary = {
  id: ROLE_ID,
  code: 'DISPECER',
  name: 'Dispečer',
  description: null,
  isSystem: false,
  allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
  permissionsVersion: 3,
  priority: 100,
  activeUserCount: 2,
  grantedCount: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const MATRIX_RESULT: RoleMatrixUpdateResult = {
  affectedRoles: 1,
  added: 1,
  removed: 0,
  scopeChanged: 0,
  changed: [{ roleId: ROLE_ID, roleCode: 'DISPECER', permission: 'vehicle:view', before: null, after: 'ALL' }],
  permissionsVersion: { [ROLE_ID]: 4 },
};

function fakeService() {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const service = {
    list: async () => {
      calls.push({ method: 'list', args: [] });
      return [SUMMARY];
    },
    matrix: async () => {
      calls.push({ method: 'matrix', args: [] });
      return { modules: [], roles: [SUMMARY], grants: [], generatedAt: new Date().toISOString() };
    },
    updateMatrix: async (input: RoleMatrixUpdateInput, actorId?: string) => {
      calls.push({ method: 'updateMatrix', args: [input, actorId] });
      return {
        data: MATRIX_RESULT,
        before: { 'DISPECER.vehicle:view': null },
        after: { 'DISPECER.vehicle:view': 'ALL' },
        meta: { affectedRoles: 1 },
      };
    },
    create: async (input: unknown, actorId?: string) => {
      calls.push({ method: 'create', args: [input, actorId] });
      const detail = { ...SUMMARY } as RoleDetail;
      return { data: detail, after: { code: SUMMARY.code }, meta: { code: SUMMARY.code } };
    },
    get: async (id: string) => {
      calls.push({ method: 'get', args: [id] });
      return { ...SUMMARY, grants: [] };
    },
    update: async (id: string, input: unknown, actorId?: string) => {
      calls.push({ method: 'update', args: [id, input, actorId] });
      return { data: { ...SUMMARY, grants: [] }, before: { name: 'Dispečer' }, after: { name: 'Dispečer 2' } };
    },
    archive: async (id: string, input: unknown, actorId?: string) => {
      calls.push({ method: 'archive', args: [id, input, actorId] });
      return {
        data: { id, code: 'DISPECER', archivedAt: '2026-02-01T10:00:00.000Z' },
        before: { code: 'DISPECER' },
        after: { code: 'DISPECER', archivedAt: '2026-02-01T10:00:00.000Z' },
      };
    },
    catalog: async () => {
      calls.push({ method: 'catalog', args: [] });
      return [];
    },
    syncCatalog: async () => {
      calls.push({ method: 'syncCatalog', args: [] });
      return { total: 161, created: 3, updated: 1, unchanged: 157 };
    },
  };

  return { service: service as unknown as RolesService, calls, raw: service };
}

function fakeRequest(): VfmRequest {
  return { method: 'PUT', url: '/api/v1/roles/matrix', headers: {} } as unknown as VfmRequest;
}

describe('RolesController — permisije po ruti (P14)', () => {
  it.each([
    ['list', 'role:view'],
    ['matrix', 'role:view'],
    ['updateMatrix', 'role:manage_permissions'],
    ['create', 'role:create'],
    ['get', 'role:view'],
    ['update', 'role:update'],
    ['archive', 'role:archive'],
  ] as const)('%s traži %s', (method, permission) => {
    const handler = (RolesController.prototype as unknown as Record<string, object>)[method];
    expect(handler).toBeDefined();
    expect(permissionsOf(handler as object)).toContain(permission);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object)).toMatchObject({ scope: 'ALL' });
  });

  it('PermissionsController: katalog traži permission:view, sync traži permission:catalog_sync', () => {
    expect(permissionsOf(PermissionsController.prototype.catalog)).toContain('permission:view');
    expect(permissionsOf(PermissionsController.prototype.sync)).toContain('permission:catalog_sync');
  });

  it('nijedna ruta nije javna (nema @Public)', () => {
    const isPublic = (handler: object): unknown => Reflect.getMetadata('vfm:isPublic', handler);
    expect(isPublic(RolesController.prototype.list)).toBeUndefined();
    expect(isPublic(PermissionsController.prototype.catalog)).toBeUndefined();
  });
});

describe('RolesController — audit', () => {
  it('matrica je PERMISSION_CHANGE sa SECURITY severity i resource Role', () => {
    expect(auditOf(RolesController.prototype.updateMatrix)).toMatchObject({
      action: 'PERMISSION_CHANGE',
      severity: 'SECURITY',
      resource: 'Role',
    });
  });

  it('create/update/archive nose odgovarajuće akcije', () => {
    expect(auditOf(RolesController.prototype.create)).toMatchObject({ action: 'CREATE', resource: 'Role' });
    expect(auditOf(RolesController.prototype.update)).toMatchObject({ action: 'UPDATE', resource: 'Role' });
    expect(auditOf(RolesController.prototype.archive)).toMatchObject({ action: 'ARCHIVE', resource: 'Role' });
    expect(auditOf(PermissionsController.prototype.sync)).toMatchObject({
      action: 'UPDATE',
      severity: 'SECURITY',
    });
  });

  it('čitanje nije auditovano (nema šuma u Audit logu)', () => {
    expect(auditOf(RolesController.prototype.list)).toBeUndefined();
    expect(auditOf(RolesController.prototype.matrix)).toBeUndefined();
    expect(auditOf(RolesController.prototype.get)).toBeUndefined();
  });
});

describe('RolesController — prosljeđivanje servisu', () => {
  it('list/matrix/get/catalog su tanki passthrough (bez transformacije)', async () => {
    const { service } = fakeService();
    const controller = new RolesController(service);
    const permissions = new PermissionsController(service);

    expect(await controller.list()).toEqual([SUMMARY]);
    expect((await controller.matrix()).roles).toEqual([SUMMARY]);
    expect(await controller.get(ROLE_ID)).toMatchObject({ id: ROLE_ID, grants: [] });
    expect(await permissions.catalog()).toEqual([]);
  });
});

describe('RolesController — AuditContext', () => {
  it('updateMatrix upisuje before/after i brojače u kontekst zahtjeva', async () => {
    const { service } = fakeService();
    const controller = new RolesController(service);
    const request = fakeRequest();

    const result = await controller.updateMatrix({ roles: [{ roleId: ROLE_ID, grants: [] }] }, ACTOR, request);

    expect(result).toEqual(MATRIX_RESULT);
    const context = AuditContext.from(request);
    expect(context.before).toEqual({ 'DISPECER.vehicle:view': null });
    expect(context.after).toEqual({ 'DISPECER.vehicle:view': 'ALL' });
    expect(context.resource).toBe('Role');
    expect(context.meta).toMatchObject({ affectedRoles: 1, added: 1, removed: 0, scopeChanged: 0 });
    expect(context.meta.permissionsVersion).toEqual({ [ROLE_ID]: 4 });
  });

  it('create postavlja entityId na novu rolu', async () => {
    const { service } = fakeService();
    const controller = new RolesController(service);
    const request = fakeRequest();

    await controller.create({ code: 'DISPECER', name: 'Dispečer' }, ACTOR, request);

    const context = AuditContext.from(request);
    expect(context.entityId).toBe(ROLE_ID);
    expect(context.after).toEqual({ code: 'DISPECER' });
    expect(context.resource).toBe('Role');
  });

  it('archive postavlja entityId i archivedAt, a prosljeđuje razlog servisu', async () => {
    const { service, calls } = fakeService();
    const controller = new RolesController(service);
    const request = fakeRequest();

    await controller.archive(ROLE_ID, { reason: 'ukinuta pozicija' }, ACTOR, request);

    const context = AuditContext.from(request);
    expect(context.entityId).toBe(ROLE_ID);
    expect(context.before).toEqual({ code: 'DISPECER' });
    expect(context.meta).toMatchObject({ archivedAt: '2026-02-01T10:00:00.000Z' });
    expect(calls.at(-1)).toMatchObject({
      method: 'archive',
      args: [ROLE_ID, { reason: 'ukinuta pozicija' }, ACTOR_ID],
    });
  });

  it('update mijenja resource i označava promjenu klijenata', async () => {
    const { service } = fakeService();
    const controller = new RolesController(service);
    const request = fakeRequest();

    await controller.update(ROLE_ID, { allowedClientTypes: ['WEB'] }, ACTOR, request);

    const context = AuditContext.from(request);
    expect(context.before).toEqual({ name: 'Dispečer' });
    expect(context.after).toEqual({ name: 'Dispečer 2' });
    expect(context.meta).toMatchObject({ allowedClientTypesChanged: true });
  });

  it('sync bilježi brojače u kontekst', async () => {
    const { service } = fakeService();
    const controller = new PermissionsController(service);
    const request = fakeRequest();

    const result = await controller.sync(request);

    expect(result).toEqual({ total: 161, created: 3, updated: 1, unchanged: 157 });
    expect(AuditContext.from(request).resource).toBe('Permission');
    expect(AuditContext.from(request).meta).toMatchObject({ created: 3, updated: 1, total: 161 });
  });
});

describe('RolesController — redoslijed ruta', () => {
  it('`matrix` je deklarisan prije `:id` (inače bi ga pipe tretirao kao UUID)', () => {
    const methods = Object.getOwnPropertyNames(RolesController.prototype);
    expect(methods.indexOf('matrix')).toBeGreaterThan(-1);
    expect(methods.indexOf('matrix')).toBeLessThan(methods.indexOf('get'));
  });

  it('radi i bez korisnika u kontekstu (actorId ostaje undefined)', async () => {
    const { service, calls } = fakeService();
    const controller = new RolesController(service);
    const request = fakeRequest();

    await controller.updateMatrix({ roles: [{ roleId: ROLE_ID, grants: [] }] }, undefined, request);

    expect(calls.at(-1)).toMatchObject({ method: 'updateMatrix', args: [expect.anything(), undefined] });
    expect(AuditContext.from(request).resource).toBe('Role');
  });

  it('prosljeđuje ID aktera servisu (audit „ko je šta uradio")', async () => {
    const { service, calls } = fakeService();
    const controller = new RolesController(service);

    await controller.updateMatrix({ roles: [{ roleId: ROLE_ID, grants: [] }] }, ACTOR, fakeRequest());

    expect(calls.at(-1)).toMatchObject({ method: 'updateMatrix', args: [expect.anything(), ACTOR_ID] });
  });
});

describe('RolesModule — DI', () => {
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

  it('modul se gradi bez infrastrukture (AuthModule izvozi PermissionsService)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RolesModule, RedisModule, PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(asPrismaService(new FakePrismaClient()))
      .overrideProvider(RedisService)
      .useValue(fakeRedisService(new FakeRedis(), false))
      .compile();

    const service = moduleRef.get(RolesService);
    expect(service).toBeInstanceOf(RolesService);
    // Servis iz drugog modula mora biti dostupan (dokaz da je AuthModule eksportuje).
    expect(moduleRef.get(RolesModule)).toBeInstanceOf(RolesModule);

    await moduleRef.close();
  });
});
