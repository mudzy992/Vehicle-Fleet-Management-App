/**
 * `DriversService` — vozači i kategorije dozvole (docs/09, Faza 3).
 *
 * Provjerava pravila iz docs/03 §3.3 i docs/05 §8.2: PII se ne vraća bez
 * `driver:view_pii`, arhiviranje ne briše zapis, `version` štiti od paralelnih
 * izmjena, a kategorija dozvole je jedinstvena po vozaču.
 */
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import {
  DriversService,
  daysUntil,
  maskDocumentNumber,
  maskDriverEmail,
  maskPhone,
} from '../../src/modules/drivers/drivers.service.js';
import type { DriverListQuery } from '@vfm/shared/schemas';
import {
  asPrisma,
  baseDriverInput,
  catchVfm,
  driverForm,
  FakeDriverPrisma,
  inDays,
} from '../helpers/drivers-fake.js';

const VIEW_PII = 'driver:view_pii';

function actor(permissions: string[] = [], isSuperAdmin = false): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'admin@example.ba',
    clientType: 'WEB',
    permissionsVersion: 1,
    isSuperAdmin,
    permissions: {
      list: permissions,
      permissions: new Map(permissions.map((permission) => [permission, 'ALL'])),
      grants: permissions.map((permission) => ({ permission, scope: 'ALL' })),
    },
  } as unknown as AuthenticatedUser;
}

function scopeActor(
  permission: string,
  scope: 'ALL' | 'OWN' | 'DRIVER_IDS',
  id = 'user-1',
  driverIds: string[] = [],
): AuthenticatedUser {
  return {
    ...actor([permission]),
    id,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeDriverIds: driverIds }],
    },
  } as unknown as AuthenticatedUser;
}

function driverViewer(
  scope: 'ALL' | 'OWN' | 'DRIVER_IDS',
  id = 'user-1',
  driverIds: string[] = [],
): AuthenticatedUser {
  const permission = 'driver:view' as const;
  return {
    ...actor([permission]),
    id,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeDriverIds: driverIds }],
    },
  } as unknown as AuthenticatedUser;
}

function service(fake = new FakeDriverPrisma()): { fake: FakeDriverPrisma; svc: DriversService } {
  return { fake, svc: new DriversService(asPrisma(fake)) };
}

function query(overrides: Partial<DriverListQuery> = {}): DriverListQuery {
  return {
    page: 1,
    pageSize: 25,
    sortOrder: 'asc',
    includeArchived: false,
    ...overrides,
  } as DriverListQuery;
}

describe('DriversService — kreiranje', () => {
  it('ne dopušta kreiranje s opsegom DRIVER_IDS', async () => {
    const { svc } = service();
    const denied = await catchVfm(
      svc.create(baseDriverInput() as never, scopeActor('driver:create', 'DRIVER_IDS')),
    );
    expect(denied.code).toBe('SCOPE_DENIED');
  });
  it('validira formu i čuva PII, ali ga maskira bez `driver:view_pii`', async () => {
    const { fake, svc } = service();
    const { versionId } = fake.addForm();

    const created = await svc.create(baseDriverInput() as never, actor(['driver:create']));

    expect(created.data.firstName).toBe('Fikret');
    expect(created.data.piiRedacted).toBe(true);
    expect(created.data.email).toBe('f***@example.ba');
    expect(created.data.phone).toBe('•••••222');
    expect(created.data.licenseNumber).toBe('•••••456');
    expect(created.data.dateOfBirth).toBeNull();
    expect(created.data.address).toBeNull();
    expect(created.data.formSchemaVersionId).toBe(versionId);
    expect(created.data.formData).toEqual({ emergencyContact: 'Selma 061 000 000' });
  });

  it('sa `driver:view_pii` vraća puna PII polja', async () => {
    const { fake, svc } = service();
    fake.addForm();

    const created = await svc.create(baseDriverInput() as never, actor([VIEW_PII, 'driver:create']));

    expect(created.data.piiRedacted).toBe(false);
    expect(created.data.email).toBe('fikret.hodzic@example.ba');
    expect(created.data.phone).toBe('+387 61 111 222');
    expect(created.data.licenseNumber).toBe('BA-123456');
    expect(created.data.dateOfBirth).toBe('1985-04-12');
  });

  it('Super Admin vidi PII bez eksplicitne permisije (R-07)', async () => {
    const { fake, svc } = service();
    fake.addForm();

    const created = await svc.create(baseDriverInput() as never, actor([], true));

    expect(created.data.piiRedacted).toBe(false);
    expect(created.data.email).toBe('fikret.hodzic@example.ba');
  });

  it('bez aktera (servis interno) maskira PII', async () => {
    const { fake, svc } = service();
    fake.addForm();

    const created = await svc.create(baseDriverInput() as never);

    expect(created.data.piiRedacted).toBe(true);
    expect(created.data.phone).toBe('•••••222');
  });

  it('datumi idu u bazu kao `Date` (`@db.Date`), ne kao `YYYY-MM-DD`', async () => {
    const { fake, svc } = service();
    fake.addForm();

    const input = baseDriverInput({ licenseIssuedAt: '2022-09-11' });
    await svc.create(input as never, actor(['driver:create']));

    expect(fake.drivers[0]!.licenseIssuedAt).toBeInstanceOf(Date);
    expect(fake.drivers[0]!.licenseExpiresAt).toBeInstanceOf(Date);
    expect(fake.drivers[0]!.dateOfBirth).toBeInstanceOf(Date);
    expect((fake.drivers[0]!.licenseIssuedAt as Date).toISOString()).toBe('2022-09-11T00:00:00.000Z');
  });

  it('greška forme ide po polju (`formData.<key>`)', async () => {
    const { fake, svc } = service();
    fake.addForm();

    const error = await catchVfm(
      svc.create(
        baseDriverInput({ formData: { napomena: 'x'.repeat(501) } }) as never,
        actor(['driver:create']),
      ),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(fake.drivers).toHaveLength(0);
  });

  it('forma koja mapira kolonu vozača pada s `NORMALIZATION_MISMATCH`', async () => {
    const { fake, svc } = service();
    fake.addForm();
    // Zamijeni definiciju mapiranjem na kolonu koju vozač ne dozvoljava.
    fake.versions[0]!.definition = driverForm({
      normalizedName: [{ fieldKey: 'emergencyContact', column: 'notes', transform: 'TO_TEXT' }],
    });

    const error = await catchVfm(svc.create(baseDriverInput() as never, actor(['driver:create'])));

    expect(error.code).toBe('NORMALIZATION_MISMATCH');
  });

  it('bez objavljene DRIVER forme nema kreiranja', async () => {
    const { svc } = service();

    const error = await catchVfm(svc.create(baseDriverInput() as never, actor(['driver:create'])));

    expect(error.code).toBe('FORM_VERSION_NOT_PUBLISHED');
  });
});

describe('DriversService — izmjena i verzija', () => {
  it('spor klijent dobija `VERSION_CONFLICT` s trenutnom verzijom', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver({ version: 3 });

    const error = await catchVfm(
      svc.update(row.id, { version: 2, firstName: 'Novo' } as never, actor(['driver:update'])),
    );

    expect(error.code).toBe('VERSION_CONFLICT');
    expect((error.extra as { currentVersion: number }).currentVersion).toBe(3);
  });

  it('uspješna izmjena diže verziju i vraća maskiran PII', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    const outcome = await svc.update(
      row.id,
      { version: 0, firstName: 'Novi', employmentStatus: 'STALNI' } as never,
      actor(['driver:update']),
    );

    expect(outcome.data.firstName).toBe('Novi');
    expect(outcome.data.version).toBe(1);
    expect(outcome.data.piiRedacted).toBe(true);
  });

  it('nedozvoljen prelaz statusa (ACTIVE → ARCHIVED) je `VALIDATION_ERROR`', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    const error = await catchVfm(
      svc.update(row.id, { version: 0, status: 'ARCHIVED' } as never, actor(['driver:update'])),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('arhiviran vozač se ne mijenja', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver({ status: 'ARCHIVED' });

    const error = await catchVfm(
      svc.update(row.id, { version: 0, firstName: 'X' } as never, actor(['driver:update'])),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('driver:update OWN dozvoljava vlasniku, a odbija izmjenu tuđeg zapisa', async () => {
    const { fake, svc } = service();
    fake.addForm();
    const created = await svc.create(
      baseDriverInput() as never,
      scopeActor('driver:create', 'OWN', 'owner-1'),
    );

    await svc.update(
      created.data.id,
      { version: 0, firstName: 'Izmijenjeno' } as never,
      scopeActor('driver:update', 'OWN', 'owner-1'),
    );
    const denied = await catchVfm(
      svc.update(
        created.data.id,
        { version: 1, firstName: 'Neovlašteno' } as never,
        scopeActor('driver:update', 'OWN', 'other-user'),
      ),
    );
    const deniedArchive = await catchVfm(
      svc.archive(created.data.id, {} as never, scopeActor('driver:archive', 'OWN', 'other-user')),
    );
    const deniedDelete = await catchVfm(
      svc.remove(created.data.id, 'other-user', scopeActor('driver:delete', 'OWN', 'other-user')),
    );
    const deniedCategory = await catchVfm(
      svc.addLicenseCategory(
        created.data.id,
        {} as never,
        'other-user',
        scopeActor('driver:update', 'OWN', 'other-user'),
      ),
    );

    expect(denied.code).toBe('SCOPE_DENIED');
    expect(deniedArchive.code).toBe('SCOPE_DENIED');
    expect(deniedDelete.code).toBe('SCOPE_DENIED');
    expect(deniedCategory.code).toBe('SCOPE_DENIED');
  });

  it('nepostojeći vozač je `NOT_FOUND`', async () => {
    const { svc } = service();
    const error = await catchVfm(svc.get('nema-me', actor(['driver:view'])));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('DriversService — arhiva i brisanje', () => {
  it('arhiviranje mijenja status, ponovno arhiviranje je idempotentno', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    const first = await svc.archive(row.id, { reason: 'Prešao u drugu firmu' }, actor(['driver:archive']));
    const second = await svc.archive(row.id, {}, actor(['driver:archive']));

    expect(first.data.status).toBe('ARCHIVED');
    expect(second.data.status).toBe('ARCHIVED');
    expect(fake.drivers[0]!.status).toBe('ARCHIVED');
    expect(fake.drivers[0]!.notes).toBe('Prešao u drugu firmu');
  });

  it('restore vraća `INACTIVE`, ne `ACTIVE`', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver({ status: 'ARCHIVED' });

    const restored = await svc.restore(row.id, actor(['driver:archive']));

    expect(restored.data.status).toBe('INACTIVE');
  });

  it('restore aktivnog vozača je `VALIDATION_ERROR`', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    const error = await catchVfm(svc.restore(row.id, actor(['driver:archive'])));

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE je soft-delete — zapis ostaje, lista ga ne vraća', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    await svc.remove(row.id, 'user-1');

    expect(fake.drivers).toHaveLength(1);
    expect(fake.drivers[0]!.deletedAt).toBeInstanceOf(Date);
    const error = await catchVfm(svc.get(row.id, actor(['driver:view'])));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('DriversService — lista i filteri', () => {
  it('default ne vraća arhivirane ni obrisane', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Aktivan' });
    fake.addDriver({ lastName: 'Arhiviran', status: 'ARCHIVED' });
    fake.addDriver({ lastName: 'Obrisan', deletedAt: new Date() });

    const list = await svc.list(query(), actor(['driver:view']));

    expect(list.items.map((item) => item.lastName)).toEqual(['Aktivan']);
    expect(list.total).toBe(1);
  });

  it('`includeArchived` vraća i arhivirane', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Aktivan' });
    fake.addDriver({ lastName: 'Arhiviran', status: 'ARCHIVED' });

    const list = await svc.list(query({ includeArchived: true }), actor(['driver:view']));

    expect(list.total).toBe(2);
  });

  it('`q` pretražuje ime, prezime i broj zaposlenika', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Hodžić', employeeNumber: 'EMP-1' });
    fake.addDriver({ lastName: 'Kovač', employeeNumber: 'EMP-2' });

    expect((await svc.list(query({ q: 'kova' }), actor(['driver:view']))).total).toBe(1);
    expect((await svc.list(query({ q: 'EMP-1' }), actor(['driver:view']))).total).toBe(1);
  });

  it('`licenseCategory` filtrira po kategoriji (case-insensitive ulaz)', async () => {
    const { fake, svc } = service();
    const c = fake.addDriver({ lastName: 'C-kategorija' });
    fake.addDriver({ lastName: 'Bez kategorije' });
    await fake.driverLicenseCategory.create({ data: { driverId: c.id, category: 'C' } });

    const list = await svc.list(query({ licenseCategory: 'c' }), actor(['driver:view']));

    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.lastName).toBe('C-kategorija');
    expect(list.items[0]!.categories).toEqual(['C']);
  });

  it('`expiringInDays` gleda i dozvolu i kategorije', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Dozvola', licenseExpiresAt: inDays(3) });
    const category = fake.addDriver({ lastName: 'Kategorija', licenseExpiresAt: null });
    await fake.driverLicenseCategory.create({
      data: { driverId: category.id, category: 'CE', expiresAt: inDays(5) },
    });
    fake.addDriver({ lastName: 'Daleko', licenseExpiresAt: inDays(90) });

    const list = await svc.list(query({ expiringInDays: 7 }), actor(['driver:view']));

    expect(list.items.map((item) => item.lastName).sort()).toEqual(['Dozvola', 'Kategorija']);
  });

  it('dozvola koja ističe **danas** ulazi u `expiringInDays: 0` (granica je početak dana)', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Danas', licenseExpiresAt: inDays(0) });
    fake.addDriver({ lastName: 'Sutra', licenseExpiresAt: inDays(1) });

    const list = await svc.list(query({ expiringInDays: 0 }), actor(['driver:view']));

    expect(list.items.map((item) => item.lastName)).toEqual(['Danas']);
  });

  it('`licenseDaysLeft` je negativan za isteklu dozvolu', async () => {
    const { fake, svc } = service();
    fake.addDriver({ licenseExpiresAt: inDays(-2) });

    const list = await svc.list(query(), actor(['driver:view']));

    expect(list.items[0]!.licenseDaysLeft).toBeLessThan(0);
  });

  it('primjenjuje OWN i DRIVER_IDS, a ALL zadržava pristup svim vozačima', async () => {
    const { fake, svc } = service();
    fake.addDriver({ lastName: 'Vlastiti', createdById: 'user-1' });
    const scopedDriver = fake.addDriver({ lastName: 'Dodijeljeni', createdById: 'user-2' });
    fake.addDriver({ lastName: 'Treći', createdById: 'user-3' });

    const own = await svc.list(query(), driverViewer('OWN', 'user-1'));
    const assigned = await svc.list(query(), driverViewer('DRIVER_IDS', 'user-4', [scopedDriver.id]));
    const all = await svc.list(query(), driverViewer('ALL', 'user-4'));

    expect(own.items.map((item) => item.lastName)).toEqual(['Vlastiti']);
    expect(assigned.items.map((item) => item.lastName)).toEqual(['Dodijeljeni']);
    expect(all.total).toBe(3);
    await expect(svc.get(scopedDriver.id, driverViewer('DRIVER_IDS', 'user-4', []))).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
  });
});

describe('DriversService — kategorije dozvole', () => {
  it('dodaje kategoriju velikim slovima i vraća je u listi', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();

    const created = await svc.addLicenseCategory(row.id, {
      category: 'ce',
      issuedAt: '2020-01-01',
      expiresAt: '2030-01-01',
    });

    expect(created.data.category).toBe('CE');
    const list = await svc.listLicenseCategories(row.id, actor(['driver:view']));
    expect(list.items).toHaveLength(1);
  });

  it('dupla kategorija je `DUPLICATE_ENTRY`', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();
    await svc.addLicenseCategory(row.id, { category: 'C' });

    const error = await catchVfm(svc.addLicenseCategory(row.id, { category: 'c' }));

    expect(error.code).toBe('DUPLICATE_ENTRY');
    expect(fake.licenses).toHaveLength(1);
  });

  it('izmjena i brisanje kategorije', async () => {
    const { fake, svc } = service();
    const row = fake.addDriver();
    const created = await svc.addLicenseCategory(row.id, { category: 'B' });

    const updated = await svc.updateLicenseCategory(row.id, created.data.id, {
      expiresAt: '2031-12-31',
    });
    expect(updated.data.expiresAt).toBe('2031-12-31');

    await svc.removeLicenseCategory(row.id, created.data.id);
    expect(fake.licenses).toHaveLength(0);
  });

  it('kategorija drugog vozača je `NOT_FOUND`', async () => {
    const { fake, svc } = service();
    const first = fake.addDriver();
    const second = fake.addDriver();
    const created = await svc.addLicenseCategory(first.id, { category: 'B' });

    const error = await catchVfm(svc.updateLicenseCategory(second.id, created.data.id, { notes: 'x' }));

    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('pomoćne funkcije', () => {
  it('`daysUntil` računa u danima i tolerise istek', () => {
    expect(daysUntil('2026-01-11', '2026-01-01')).toBe(10);
    expect(daysUntil('2025-12-30', '2026-01-01')).toBe(-2);
    expect(daysUntil(null)).toBeNull();
  });

  it('maskiranje ne otkriva cijeli dokument/broj', () => {
    expect(maskPhone('+387 61 111 222')).toBe('•••••222');
    expect(maskDocumentNumber('BA-123456')).toBe('•••••456');
    expect(maskPhone(null)).toBeNull();
  });

  it('maskiranje kratkih vrijednosti ne pada', () => {
    expect(maskDocumentNumber('AB')).toBe('•••••AB');
    expect(maskDriverEmail(null)).toBeNull();
  });
});
