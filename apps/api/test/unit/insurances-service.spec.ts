/**
 * `InsurancesService` — periodi osiguranja (docs/09, Faza 3).
 *
 * Isti ugovor kao registracije (B-10), ali nad `InsuranceRecord` i
 * `Vehicle.insuranceExpiresAt`; polisa ima i `type` (KASKO/ODGOVORNOST) te
 * odbitnu franšizu.
 */
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { InsurancesService } from '../../src/modules/insurances/insurances.service.js';
import type { InsuranceListQuery } from '@vfm/shared/schemas';
import { asPrisma, baseInsuranceInput, catchVfm, FakePeriodPrisma } from '../helpers/periods-fake.js';

function insuranceViewer(
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  id = 'viewer-1',
  vehicleIds: string[] = [],
): AuthenticatedUser {
  const permission = 'insurance:view' as const;
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
  svc: InsurancesService;
} {
  return { fake, svc: new InsurancesService(asPrisma(fake)) };
}

function query(overrides: Partial<InsuranceListQuery> = {}): InsuranceListQuery {
  return { page: 1, pageSize: 25, sortOrder: 'desc', ...overrides } as InsuranceListQuery;
}

describe('InsurancesService — kreiranje', () => {
  it('upisuje polisu i postavlja `insuranceExpiresAt` na vozilu', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();

    const created = await svc.create(
      baseInsuranceInput(vehicle.id, { type: 'KASKO', deductibleAmount: 5000 }) as never,
      'user-1',
    );

    expect(created.data.policyNumber).toBe('POL-001');
    expect(created.data.type).toBe('KASKO');
    expect(created.data.deductibleAmount).toBe(5000);
    expect(fake.vehicles[0]!.insuranceExpiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');
    // Registracija nije dirana.
    expect(fake.vehicles[0]!.registrationExpiresAt).toBeNull();
  });

  it('preklapanje je `PERIOD_OVERLAP`', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();
    await svc.create(baseInsuranceInput(vehicle.id) as never);

    const error = await catchVfm(
      svc.create(
        baseInsuranceInput(vehicle.id, { validFrom: '2026-05-01', validUntil: '2027-05-01' }) as never,
      ),
    );

    expect(error.code).toBe('PERIOD_OVERLAP');
  });

  it('polisa bez obaveznih polja forme pada s `FORM_VALIDATION_FAILED`', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();

    const error = await catchVfm(
      svc.create(
        baseInsuranceInput(vehicle.id, {
          policyNumber: undefined,
          insuranceCompany: undefined,
        }) as never,
      ),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('premija ide u formu kao `{ amount, currency }` i normalizuje se u feninge', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();

    const created = await svc.create(baseInsuranceInput(vehicle.id, { premiumAmount: 12_000 }) as never);

    // Novac je uvijek cijeli broj feninga (120,00 KM) — transform ne mijenja iznos.
    expect(created.data.premiumAmount).toBe(12_000);
  });

  it('nepostojeće vozilo je `NOT_FOUND`', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');

    const error = await catchVfm(svc.create(baseInsuranceInput('nema') as never));

    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('InsurancesService — izmjena i brisanje', () => {
  it('otkazivanje skida rok, a `VERSION_CONFLICT` čuva paralelne izmjene', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();
    const created = await svc.create(baseInsuranceInput(vehicle.id) as never);

    const cancelled = await svc.update(created.data.id, {
      version: 0,
      status: 'CANCELLED',
    } as never);
    expect(cancelled.data.status).toBe('CANCELLED');
    expect(fake.vehicles[0]!.insuranceExpiresAt).toBeNull();

    const error = await catchVfm(svc.update(created.data.id, { version: 0, notes: 'x' } as never));
    expect(error.code).toBe('VERSION_CONFLICT');
  });

  it('soft-delete vraća prethodni rok i oslobađa period', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();
    const first = await svc.create(baseInsuranceInput(vehicle.id) as never);
    await svc.create(
      baseInsuranceInput(vehicle.id, {
        policyNumber: 'POL-002',
        validFrom: '2027-01-01',
        validUntil: '2027-12-31',
      }) as never,
    );

    await svc.remove(first.data.id, 'user-1');

    expect(fake.vehicles[0]!.insuranceExpiresAt?.toISOString().slice(0, 10)).toBe('2027-12-31');
    const list = await svc.list(query(), insuranceViewer('ALL'));
    expect(list.total).toBe(1);
  });
});

describe('InsurancesService — lista', () => {
  it('filtrira po vozilu, `type` i `q` (polisa/osiguravajuće društvo)', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const first = fake.addVehicle();
    const second = fake.addVehicle();
    await svc.create(baseInsuranceInput(first.id, { type: 'KASKO' }) as never);
    await svc.create(
      baseInsuranceInput(second.id, {
        policyNumber: 'POL-AUTO-9',
        insuranceCompany: 'Drugo osiguranje',
        type: 'ODGOVORNOST',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
      }) as never,
    );

    expect((await svc.list(query({ vehicleId: first.id }), insuranceViewer('ALL'))).total).toBe(1);
    expect((await svc.list(query({ type: 'ODGOVORNOST' }), insuranceViewer('ALL'))).total).toBe(1);
    expect((await svc.list(query({ q: 'drugo' }), insuranceViewer('ALL'))).total).toBe(1);
    expect((await svc.list(query({ q: 'auto-9' }), insuranceViewer('ALL'))).total).toBe(1);
  });

  it('scope OWN i VEHICLE_IDS ograničavaju listu i direktni GET, a ALL ostaje dozvoljen', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const ownVehicle = fake.addVehicle();
    const assignedVehicle = fake.addVehicle();
    await svc.create(baseInsuranceInput(ownVehicle.id) as never, 'owner-1');
    const assignedRecord = await svc.create(
      baseInsuranceInput(assignedVehicle.id, { policyNumber: 'POL-002' }) as never,
      'owner-2',
    );
    const listQuery = query();

    expect((await svc.list(listQuery, insuranceViewer('OWN', 'owner-1'))).total).toBe(1);
    expect(
      (await svc.list(listQuery, insuranceViewer('VEHICLE_IDS', 'viewer', [assignedVehicle.id]))).items,
    ).toHaveLength(1);
    expect((await svc.list(listQuery, insuranceViewer('ALL'))).total).toBe(2);
    await expect(
      svc.get(assignedRecord.data.id, insuranceViewer('VEHICLE_IDS', 'viewer', [ownVehicle.id])),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('`daysLeft` i `expiringInDays` rade nad `validUntil`', async () => {
    const { fake, svc } = service();
    fake.addForm('INSURANCE');
    const vehicle = fake.addVehicle();
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 2);
    const soonIso = soon.toISOString().slice(0, 10);

    await svc.create(
      baseInsuranceInput(vehicle.id, { validFrom: '2026-01-01', validUntil: soonIso }) as never,
    );

    const list = await svc.list(query({ expiringInDays: 7 }), insuranceViewer('ALL'));
    expect(list.total).toBe(1);
    expect(list.items[0]!.daysLeft).toBeGreaterThanOrEqual(0);
    expect(list.items[0]!.daysLeft).toBeLessThanOrEqual(7);
  });
});
