/**
 * `RolesService` — uloge, matrica prava i katalog (P2, docs/05 §3–§4).
 *
 * Testovi pokrivaju ono što DoD traži, ne implementaciju:
 * - **P2**: grant/revoke kroz `PUT /roles/matrix` u jednoj transakciji,
 *   `permissionsVersion` raste, a Redis se invalidira (keš obrisan, brojač
 *   preslikan na DB verziju) → postojeći tokeni vide novo stanje bez prijave.
 * - **P1/N-05**: Super Admin ostaje web-only; matrica ne dira njegova prava.
 * - **Zaštite**: rezervisani kodovi, arhiviranje sistemskih rola i rola s
 *   aktivnim korisnicima, `LAST_SUPER_ADMIN_PROTECTED`.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_ALLOWED_CLIENT_TYPES } from '@vfm/shared';
import type { RoleMatrixUpdateInput } from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { RolesService } from '../../src/modules/roles/roles.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { FakeLoader, FakeRedis, fakeRedisService } from '../helpers/rbac-fakes.js';

const ROLE_SUPER = '018f0000-0000-7000-8000-0000000000b0';
const ROLE_ADMIN = '018f0000-0000-7000-8000-0000000000b1';
const ROLE_DISPATCHER = '018f0000-0000-7000-8000-0000000000b2';
const USER_ID = '018f0000-0000-7000-8000-000000000002';

function build() {
  const prisma = new FakePrismaClient();
  const redis = new FakeRedis();
  const redisService = fakeRedisService(redis, true);
  const permissions = new PermissionsService(redisService, new FakeLoader([]));
  const roles = new RolesService(asPrismaService(prisma), permissions);

  return { prisma, redis, redisService, permissions, roles };
}

/** Osnovni katalog: tri role + tri permisije + jedan grant. */
function seed(prisma: FakePrismaClient): void {
  prisma.addRole({
    id: ROLE_SUPER,
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    isSystem: true,
    priority: 10,
    allowedClientTypes: ['WEB'],
  });
  prisma.addRole({ id: ROLE_ADMIN, code: 'ADMINISTRATOR', name: 'Administrator', isSystem: true, priority: 20 });
  prisma.addRole({ id: ROLE_DISPATCHER, code: 'DISPECER', name: 'Dispečer', priority: 100 });

  prisma.addPermission({ code: 'vehicle:view' });
  prisma.addPermission({ code: 'vehicle:create' });
  prisma.addPermission({ code: 'role:view' });

  prisma.addGrant({ roleId: ROLE_ADMIN, permission: 'vehicle:view', scope: 'ALL' });
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<VfmException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    const exception = error as VfmException;
    expect(exception.code).toBe(code);
    return exception;
  }
  throw new Error(`Očekivana greška '${code}', ali poziv je uspio.`);
}

describe('RolesService — čitanje', () => {
  it('list() vraća aktivne role s brojem korisnika i grantova', async () => {
    const { prisma, roles } = build();
    seed(prisma);
    prisma.addUser({ id: USER_ID, email: 'ana@vfm.test', passwordHash: 'x' });
    prisma.addRole({ id: '018f0000-0000-7000-8000-0000000000b9', code: 'ARHIVIRANA' }).deletedAt = new Date();
    prisma.addUserRole({ userId: USER_ID, roleId: ROLE_ADMIN });

    const list = await roles.list();

    expect(list.map((role) => role.code)).toEqual(['SUPER_ADMIN', 'ADMINISTRATOR', 'DISPECER']);
    const admin = list.find((role) => role.code === 'ADMINISTRATOR');
    expect(admin).toMatchObject({ activeUserCount: 1, grantedCount: 1, isSystem: true });
  });

  it('get() vraća grantove s kodom permisije i opsegom; nepoznata rola → NOT_FOUND', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const detail = await roles.get(ROLE_ADMIN);
    expect(detail.grants).toEqual([
      expect.objectContaining({ roleId: ROLE_ADMIN, permission: 'vehicle:view', scope: 'ALL' }),
    ]);

    await expectCode(() => roles.get('018f0000-0000-7000-8000-0000000000ff'), 'NOT_FOUND');
  });

  it('matrix() vraća katalog, role i grantove u jednom odgovoru', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const matrix = await roles.matrix();

    expect(matrix.roles).toHaveLength(3);
    expect(matrix.grants).toHaveLength(1);
    expect(matrix.modules.length).toBeGreaterThan(5);
    expect(matrix.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});

describe('RolesService — create/update', () => {
  it('create() odbija rezervisan kod i duplikat', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(
      () => roles.create({ code: 'SUPER_ADMIN', name: 'Klon' }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      () => roles.create({ code: 'DISPECER', name: 'Duplikat' }),
      'VALIDATION_ERROR',
    );
  });

  it('create() upisuje nerolejnu rolu s default klijentima i praznim grantovima', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const created = await roles.create(
      { code: 'SERVISER', name: 'Serviser', description: 'Servisna ekipa' },
      USER_ID,
    );

    expect(created.data).toMatchObject({
      code: 'SERVISER',
      name: 'Serviser',
      isSystem: false,
      permissionsVersion: 0,
      activeUserCount: 0,
      grants: [],
    });
    expect(created.data.allowedClientTypes).toEqual([...ROLE_ALLOWED_CLIENT_TYPES.CUSTOM]);
    expect(created.after).toMatchObject({ code: 'SERVISER' });
  });

  it('update() mijenja naziv bez bumpa verzije', async () => {
    const { prisma, roles, redis, redisService } = build();
    seed(prisma);

    const updated = await roles.update(ROLE_DISPATCHER, { name: 'Dispečer (smjene)' });

    expect(updated.data.name).toBe('Dispečer (smjene)');
    expect(updated.data.permissionsVersion).toBe(0);
    expect(redis.store.get(redisService.key('permissionsVersion', 'role', ROLE_DISPATCHER))).toBeUndefined();
  });

  it('update() promjena allowedClientTypes diže verziju i invalidira keš (N-05)', async () => {
    const { prisma, roles, redis, redisService } = build();
    seed(prisma);
    redis.store.set(redisService.key('permissions', USER_ID), '{"keš":true}');

    const updated = await roles.update(ROLE_DISPATCHER, { allowedClientTypes: ['WEB'] });

    expect(updated.data.permissionsVersion).toBe(1);
    expect(redis.store.get(redisService.key('permissionsVersion', 'role', ROLE_DISPATCHER))).toBe('1');
    expect(redis.store.get(redisService.key('permissions', USER_ID))).toBeUndefined();
    expect(updated.after).toMatchObject({ allowedClientTypes: 'WEB' });
  });

  it('update() ne dopušta mobilni pristup Super Adminu', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(
      () => roles.update(ROLE_SUPER, { allowedClientTypes: ['WEB', 'MOBILE_ANDROID'] }),
      'VALIDATION_ERROR',
    );

    const stillWeb = await roles.update(ROLE_SUPER, { allowedClientTypes: ['WEB'] });
    expect(stillWeb.data.allowedClientTypes).toEqual(['WEB']);
  });
});

describe('RolesService — archive', () => {
  it('Super Admin se ne može arhivirati (LAST_SUPER_ADMIN_PROTECTED)', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(() => roles.archive(ROLE_SUPER, {}), 'LAST_SUPER_ADMIN_PROTECTED');
  });

  it('sistemska rola se ne može arhivirati', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(() => roles.archive(ROLE_ADMIN, {}), 'VALIDATION_ERROR');
  });

  it('rola s aktivnim korisnicima se ne može arhivirati (poruka sadrži broj)', async () => {
    const { prisma, roles } = build();
    seed(prisma);
    prisma.addUser({ id: USER_ID, email: 'ana@vfm.test', passwordHash: 'x' });
    prisma.addUserRole({ userId: USER_ID, roleId: ROLE_DISPATCHER });

    const error = await expectCode(() => roles.archive(ROLE_DISPATCHER, { reason: 'ukidanje' }), 'VALIDATION_ERROR');
    expect(error.details?.[0]?.message).toContain('1 aktivnih korisnika');
  });

  it('uspješno arhiviranje sklanja rolu iz liste i vraća vrijeme arhive', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const archived = await roles.archive(ROLE_DISPATCHER, { reason: 'ukinuta pozicija' }, USER_ID);

    expect(archived.data.code).toBe('DISPECER');
    expect(archived.after).toMatchObject({ archivedAt: archived.data.archivedAt });
    const list = await roles.list();
    expect(list.map((role) => role.code)).not.toContain('DISPECER');
  });
});

describe('RolesService — matrica prava (P2/P3)', () => {
  it('dodavanje granta: added=1, verzija 1, red u bazi, Redis invalidiran', async () => {
    const { prisma, roles, redis, redisService } = build();
    seed(prisma);

    const result = await roles.updateMatrix(
      {
        roles: [
          {
            roleId: ROLE_ADMIN,
            grants: [
              { permission: 'vehicle:view', scope: 'ALL' },
              { permission: 'vehicle:create', scope: 'OWN' },
            ],
          },
        ],
      },
      USER_ID,
    );

    expect(result.data).toMatchObject({ affectedRoles: 1, added: 1, removed: 0, scopeChanged: 0 });
    expect(result.data.permissionsVersion[ROLE_ADMIN]).toBe(1);
    expect(result.data.changed[0]).toMatchObject({ permission: 'vehicle:create', before: null, after: 'OWN' });

    const grants = prisma.rolePermissions.filter((row) => row.roleId === ROLE_ADMIN);
    expect(grants).toHaveLength(2);
    expect(redis.store.get(redisService.key('permissionsVersion', 'role', ROLE_ADMIN))).toBe('1');

    // Flat snapshot za audit diff: unija grantova prije i poslije. Nepromijenjeni
    // `vehicle:view` je u oba ista (diff ga preskače), a `vehicle:create` se vidi
    // kao null → 'OWN' (novi grant).
    expect(result.before).toEqual({
      'ADMINISTRATOR.vehicle:create': null,
      'ADMINISTRATOR.vehicle:view': 'ALL',
    });
    expect(result.after).toEqual({
      'ADMINISTRATOR.vehicle:create': 'OWN',
      'ADMINISTRATOR.vehicle:view': 'ALL',
    });
  });

  it('uklanjanje granta: removed=1 i after=null', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const result = await roles.updateMatrix({ roles: [{ roleId: ROLE_ADMIN, grants: [] }] });

    expect(result.data).toMatchObject({ removed: 1, added: 0, scopeChanged: 0 });
    expect(result.data.changed[0]).toMatchObject({ permission: 'vehicle:view', before: 'ALL', after: null });
    expect(prisma.rolePermissions.filter((row) => row.roleId === ROLE_ADMIN)).toHaveLength(0);
  });

  it('promjena opsega: scopeChanged=1', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const result = await roles.updateMatrix({
      roles: [{ roleId: ROLE_ADMIN, grants: [{ permission: 'vehicle:view', scope: 'OWN' }] }],
    });

    expect(result.data).toMatchObject({ added: 0, removed: 0, scopeChanged: 1 });
    expect(result.data.changed[0]).toMatchObject({ before: 'ALL', after: 'OWN' });
  });

  it('Super Adminova prava se ne uređuju matricom (R-07)', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(
      () =>
        roles.updateMatrix({
          roles: [{ roleId: ROLE_SUPER, grants: [{ permission: 'vehicle:view', scope: 'ALL' }] }],
        }),
      'VALIDATION_ERROR',
    );
  });

  it('permisija koje nema u bazi prekida transakciju prije brisanja grantova', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const error = await expectCode(
      () =>
        roles.updateMatrix({
          roles: [
            {
              roleId: ROLE_ADMIN,
              grants: [
                { permission: 'vehicle:view', scope: 'ALL' },
                { permission: 'driver:view', scope: 'ALL' },
              ],
            },
          ],
        }),
      'VALIDATION_ERROR',
    );

    expect(error.details?.[0]?.message).toContain('permissions/sync');
    expect(prisma.rolePermissions.filter((row) => row.roleId === ROLE_ADMIN)).toHaveLength(1);
    expect(prisma.calls.rolePermissionDeleteMany).toBe(0);
  });

  it('nepoznata rola → NOT_FOUND', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await expectCode(
      () => roles.updateMatrix({ roles: [{ roleId: '018f0000-0000-7000-8000-0000000000ff', grants: [] }] }),
      'NOT_FOUND',
    );
  });

  it('opseg VEHICLE_IDS čuva listu vozila, ostale liste se prazne', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    await roles.updateMatrix({
      roles: [
        {
          roleId: ROLE_DISPATCHER,
          grants: [
            {
              permission: 'vehicle:view',
              scope: 'VEHICLE_IDS',
              scopeVehicleIds: ['018f0000-0000-7000-8000-0000000000c1'],
            },
          ],
        },
      ],
    });

    const grant = prisma.rolePermissions.find((row) => row.roleId === ROLE_DISPATCHER);
    expect(grant).toMatchObject({
      scope: 'VEHICLE_IDS',
      scopeVehicleIds: ['018f0000-0000-7000-8000-0000000000c1'],
      scopeDriverIds: [],
    });
  });
});

describe('RolesService — katalog', () => {
  it('catalog() označava koje permisije postoje u bazi', async () => {
    const { prisma, roles } = build();
    seed(prisma);

    const groups = await roles.catalog();
    const flat = groups.flatMap((group) => group.permissions);

    expect(flat.find((entry) => entry.code === 'vehicle:view')).toMatchObject({ inDatabase: true });
    expect(flat.find((entry) => entry.code === 'task:claim')).toMatchObject({ inDatabase: false });
    expect(flat.find((entry) => entry.code === 'role:manage_permissions')).toMatchObject({ isSensitive: true });
    expect(groups.map((group) => group.module)).toContain('vehicles');
  });

  it('syncCatalog() dodaje nove, ispravlja neusklađene i broji nepromijenjene', async () => {
    const { prisma, roles } = build();
    prisma.addPermission({ code: 'vehicle:view', module: 'pogrešan', action: 'view', isSensitive: true });

    const result = await roles.syncCatalog();

    expect(result.created).toBeGreaterThan(0);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(prisma.permissions.length);
    expect(prisma.permissions.find((row) => row.code === 'vehicle:view')).toMatchObject({
      module: 'vehicles',
      isSensitive: false,
    });
    expect(prisma.permissions.every((row) => row.id && row.module.length > 0)).toBe(true);
  });
});

describe('RolesService — ulazna validacija matrice', () => {
  it('RoleMatrixUpdateInput prima samo poznate permisije i opsege', async () => {
    const { roleMatrixUpdateSchema } = await import('@vfm/shared/schemas');

    const parsed = roleMatrixUpdateSchema.safeParse({
      roles: [{ roleId: ROLE_ADMIN, grants: [{ permission: 'vehicle:view', scope: 'ALL' }] }],
    });
    expect(parsed.success).toBe(true);

    const invalid = roleMatrixUpdateSchema.safeParse({
      roles: [{ roleId: ROLE_ADMIN, grants: [{ permission: 'nepostojeca:permisija', scope: 'ALL' }] }],
    });
    expect(invalid.success).toBe(false);

    const badScope = roleMatrixUpdateSchema.safeParse({
      roles: [
        {
          roleId: ROLE_ADMIN,
          grants: [{ permission: 'vehicle:view', scope: 'VEHICLE_IDS', scopeVehicleIds: [] }],
        },
      ],
    });
    expect(badScope.success).toBe(false);
  });
});

describe('RolesService — tipovi ulaza', () => {
  it('RoleMatrixUpdateInput je kompatibilan s onim što servis očekuje', () => {
    const input: RoleMatrixUpdateInput = { roles: [{ roleId: ROLE_ADMIN, grants: [] }] };
    expect(input.roles[0]?.roleId).toBe(ROLE_ADMIN);
  });
});
