/**
 * `RegistrationsService` — periodi registracije (docs/09, Faza 3).
 *
 * Ključna pravila: bez preklapanja perioda (`409 PERIOD_OVERLAP`, B-10),
 * denormalizovani `Vehicle.registrationExpiresAt` u istoj transakciji,
 * `VERSION_CONFLICT` i soft-delete koji oslobađa period.
 */
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { RegistrationsService, daysLeft } from '../../src/modules/registrations/registrations.service.js';
import { toLocalDateString } from '@vfm/shared';
import type { RegistrationListQuery } from '@vfm/shared/schemas';
import { asPrisma, baseRegistrationInput, catchVfm, FakePeriodPrisma } from '../helpers/periods-fake.js';

function registrationViewer(
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  id = 'viewer-1',
  vehicleIds: string[] = [],
): AuthenticatedUser {
  const permission = 'registration:view' as const;
  return {
    id,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      permissions: new Map([[permission, scope]]),
      list: [permission],
      grants: [{ permission, scope, scopeVehicleIds: vehicleIds }],
    },
  } as unknown as AuthenticatedUser;
}

function service(fake = new FakePeriodPrisma()): {
  fake: FakePeriodPrisma;
  svc: RegistrationsService;
} {
  return { fake, svc: new RegistrationsService(asPrisma(fake)) };
}

function query(overrides: Partial<RegistrationListQuery> = {}): RegistrationListQuery {
  return { page: 1, pageSize: 25, sortOrder: 'desc', ...overrides } as RegistrationListQuery;
}

describe('RegistrationsService — kreiranje', () => {
  it('upisuje registraciju i postavlja rok na vozilu', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();

    const created = await svc.create(baseRegistrationInput(vehicle.id) as never, 'user-1');

    expect(created.data.registrationNumber).toBe('REG-001');
    expect(created.data.status).toBe('ACTIVE');
    expect(created.data.validUntil).toBe('2026-12-31');
    expect(fake.vehicles[0]!.registrationExpiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('period ide u bazu kao `Date` (`@db.Date`), ne kao `YYYY-MM-DD`', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();

    await svc.create(baseRegistrationInput(vehicle.id) as never);

    expect(fake.registrations[0]!.validFrom).toBeInstanceOf(Date);
    expect(fake.registrations[0]!.validUntil).toBeInstanceOf(Date);
  });

  it('preklapanje perioda je `409 PERIOD_OVERLAP` s ID-jem sukoba', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const first = await svc.create(baseRegistrationInput(vehicle.id) as never);

    const error = await catchVfm(
      svc.create(
        baseRegistrationInput(vehicle.id, {
          registrationNumber: 'REG-002',
          validFrom: '2026-06-01',
          validUntil: '2027-06-01',
        }) as never,
      ),
    );

    expect(error.code).toBe('PERIOD_OVERLAP');
    expect((error.extra as { conflictingId: string }).conflictingId).toBe(first.data.id);
  });

  it('period koji se nastavlja dan nakon isteka ne preklapa se', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    await svc.create(baseRegistrationInput(vehicle.id) as never);

    const second = await svc.create(
      baseRegistrationInput(vehicle.id, {
        registrationNumber: 'REG-002',
        validFrom: '2027-01-01',
        validUntil: '2027-12-31',
      }) as never,
    );

    expect(second.data.registrationNumber).toBe('REG-002');
    // Rok na vozilu je najdalji, ne zadnji upisani.
    expect(fake.vehicles[0]!.registrationExpiresAt?.toISOString().slice(0, 10)).toBe('2027-12-31');
  });

  it('isti dan na oba kraja se preklapa (zatvoren interval)', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    await svc.create(baseRegistrationInput(vehicle.id) as never);

    const error = await catchVfm(
      svc.create(
        baseRegistrationInput(vehicle.id, {
          registrationNumber: 'REG-002',
          validFrom: '2026-12-31',
          validUntil: '2027-02-01',
        }) as never,
      ),
    );

    expect(error.code).toBe('PERIOD_OVERLAP');
  });

  it('nepostojeće vozilo je `NOT_FOUND`', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');

    const error = await catchVfm(svc.create(baseRegistrationInput('nema-ga') as never));

    expect(error.code).toBe('NOT_FOUND');
  });

  it('bez objavljene `REGISTRATION` forme nema upisa', async () => {
    const { fake, svc } = service();
    const vehicle = fake.addVehicle();

    const error = await catchVfm(svc.create(baseRegistrationInput(vehicle.id) as never));

    expect(error.code).toBe('FORM_VERSION_NOT_PUBLISHED');
  });

  it('greška forme ide po polju', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();

    const error = await catchVfm(
      svc.create(
        baseRegistrationInput(vehicle.id, {
          // `registrationNumber` se merge-uje iz API-ja, pa se greška traži na
          // polju koje dolazi isključivo iz forme.
          formData: { insuranceCompany: 'x'.repeat(81) },
        }) as never,
      ),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('API polja pobjeđuju nad istim poljima u `formData` (merge prije validacije)', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();

    const created = await svc.create(
      baseRegistrationInput(vehicle.id, {
        formData: { registrationNumber: 'REG-IZ-FORME', validFrom: '2026-02-01', validUntil: '2026-03-01' },
      }) as never,
    );

    expect(created.data.registrationNumber).toBe('REG-001');
    expect(created.data.validFrom).toBe('2026-01-01');
  });
});

describe('RegistrationsService — izmjena', () => {
  it('pomjeranje perioda provjerava preklapanje s ostalima', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    await svc.create(baseRegistrationInput(vehicle.id) as never);
    const second = await svc.create(
      baseRegistrationInput(vehicle.id, {
        registrationNumber: 'REG-002',
        validFrom: '2027-01-01',
        validUntil: '2027-12-31',
      }) as never,
    );

    const error = await catchVfm(
      svc.update(second.data.id, {
        version: 0,
        validFrom: '2026-12-01',
        validUntil: '2027-06-01',
      } as never),
    );

    expect(error.code).toBe('PERIOD_OVERLAP');
  });

  it('izmjena bez pomjeranja perioda ne dira rokove', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const created = await svc.create(baseRegistrationInput(vehicle.id) as never);

    const updated = await svc.update(created.data.id, {
      version: 0,
      registrationNumber: 'REG-001-A',
    } as never);

    expect(updated.data.registrationNumber).toBe('REG-001-A');
    expect(updated.data.validFrom).toBe('2026-01-01');
    expect(updated.data.version).toBe(1);
  });

  it('`VERSION_CONFLICT` nosi trenutnu verziju', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const created = await svc.create(baseRegistrationInput(vehicle.id) as never);

    const error = await catchVfm(
      svc.update(created.data.id, { version: 99, registrationNumber: 'X' } as never),
    );

    expect(error.code).toBe('VERSION_CONFLICT');
    expect((error.extra as { currentVersion: number }).currentVersion).toBe(0);
  });

  it('status: `CANCELLED` skida rok s vozila, `ARCHIVED` nije dozvoljen kroz PATCH', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const created = await svc.create(baseRegistrationInput(vehicle.id) as never);

    const cancelled = await svc.update(created.data.id, {
      version: 0,
      status: 'CANCELLED',
    } as never);
    expect(cancelled.data.status).toBe('CANCELLED');
    expect(fake.vehicles[0]!.registrationExpiresAt).toBeNull();

    const error = await catchVfm(svc.update(created.data.id, { version: 1, status: 'ARCHIVED' } as never));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('datum isteka prije početka je `VALIDATION_ERROR`', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const created = await svc.create(baseRegistrationInput(vehicle.id) as never);

    const error = await catchVfm(
      svc.update(created.data.id, {
        version: 0,
        validFrom: '2026-12-01',
        validUntil: '2026-11-01',
      } as never),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

describe('RegistrationsService — brisanje i lista', () => {
  it('soft-delete oslobađa period i vraća prethodni rok', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const first = await svc.create(baseRegistrationInput(vehicle.id) as never);
    await svc.create(
      baseRegistrationInput(vehicle.id, {
        registrationNumber: 'REG-002',
        validFrom: '2027-01-01',
        validUntil: '2027-12-31',
      }) as never,
    );

    await svc.remove(first.data.id, 'user-1');

    expect(fake.registrations[0]!.deletedAt).toBeInstanceOf(Date);
    expect(fake.vehicles[0]!.registrationExpiresAt?.toISOString().slice(0, 10)).toBe('2027-12-31');

    const recreated = await svc.create(
      baseRegistrationInput(vehicle.id, {
        registrationNumber: 'REG-003',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
      }) as never,
    );
    expect(recreated.data.registrationNumber).toBe('REG-003');
  });

  it('lista filtrira po vozilu, statusu i `q`', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const first = fake.addVehicle();
    const second = fake.addVehicle();
    await svc.create(baseRegistrationInput(first.id) as never);
    await svc.create(
      baseRegistrationInput(second.id, {
        registrationNumber: 'DRUGI-1',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
      }) as never,
    );

    expect((await svc.list(query({ vehicleId: first.id }), registrationViewer('ALL'))).total).toBe(1);
    expect((await svc.list(query({ q: 'drugi' }), registrationViewer('ALL'))).total).toBe(1);
    expect((await svc.list(query({ status: 'CANCELLED' }), registrationViewer('ALL'))).total).toBe(0);
  });

  it('`expiringInDays` gleda samo aktivne zapise', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    const soonIso = soon.toISOString().slice(0, 10);

    await svc.create(
      baseRegistrationInput(vehicle.id, {
        validFrom: '2026-01-01',
        validUntil: soonIso,
      }) as never,
    );

    const list = await svc.list(query({ expiringInDays: 7 }), registrationViewer('ALL'));
    expect(list.total).toBe(1);
    expect(list.items[0]!.daysLeft).toBeGreaterThanOrEqual(0);
  });

  it('zapis koji ističe **danas** ulazi u `expiringInDays` (granica je početak dana)', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const vehicle = fake.addVehicle();
    const today = toLocalDateString(new Date());
    const from = new Date(new Date(today).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

    await svc.create(baseRegistrationInput(vehicle.id, { validFrom: from, validUntil: today }) as never);

    const list = await svc.list(query({ expiringInDays: 0 }), registrationViewer('ALL'));
    expect(list.total).toBe(1);
    expect(list.items[0]!.daysLeft).toBe(0);
  });

  it('scope OWN i VEHICLE_IDS ograničavaju listu i direktni GET, a ALL ostaje dozvoljen', async () => {
    const { fake, svc } = service();
    fake.addForm('REGISTRATION');
    const ownVehicle = fake.addVehicle();
    const assignedVehicle = fake.addVehicle();
    await svc.create(baseRegistrationInput(ownVehicle.id) as never, 'owner-1');
    const assignedRecord = await svc.create(
      baseRegistrationInput(assignedVehicle.id, { registrationNumber: 'REG-002' }) as never,
      'owner-2',
    );
    const listQuery = query();

    expect((await svc.list(listQuery, registrationViewer('OWN', 'owner-1'))).total).toBe(1);
    expect(
      (await svc.list(listQuery, registrationViewer('VEHICLE_IDS', 'viewer', [assignedVehicle.id]))).items,
    ).toHaveLength(1);
    expect((await svc.list(listQuery, registrationViewer('ALL'))).total).toBe(2);
    await expect(
      svc.get(assignedRecord.data.id, registrationViewer('VEHICLE_IDS', 'viewer', [ownVehicle.id])),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect(fake.registrations[0]?.createdById).toBe('owner-1');
  });

  it('`daysLeft` je negativan za istekao period', () => {
    expect(daysLeft('2026-01-10', '2026-01-01')).toBe(9);
    expect(daysLeft('2025-12-30', '2026-01-01')).toBe(-2);
  });
});
