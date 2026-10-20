/**
 * `VehiclesService` — vozila kao zapisi dinamičke forme (docs/07 §2.5, P10/P11).
 *
 * Provjerava ono što bi u produkciji skupo koštalo:
 * - `formData` se validira prema **tačnoj** verziji forme, a normalizovane
 *   kolone se pune samo s whitelist-a vozila (`NORMALIZATION_MISMATCH` inače);
 * - `internalNo`/`vin` su jedinstveni među aktivnim zapisima (`DUPLICATE_ENTRY`);
 * - `PATCH` je optimistički zaključan (`version` → `VERSION_CONFLICT`);
 * - status mašina ne dozvoljava „preskok" u `ARCHIVED` mimo `/archive`;
 * - arhiviranje i brisanje ne uklanjaju zapis (arhiva/brisanje su meke).
 */
import { describe, expect, it } from 'vitest';
import type { VehicleDetail } from '@vfm/shared/schemas';
import { VEHICLE_STATUS_TRANSITIONS, VehiclesService } from '../../src/modules/vehicles/vehicles.service.js';
import {
  FakeVehiclePrisma,
  asPrisma,
  baseInput,
  catchVfm,
  getCurrentVersion,
  vehicleForm,
} from '../helpers/vehicles-fake.js';

describe('VehiclesService — create', () => {
  it('puni normalizovane kolone iz forme i čuva verziju forme (P10)', async () => {
    const fake = new FakeVehiclePrisma();
    const { formSchemaId, versionId } = fake.addForm();
    const service = new VehiclesService(asPrisma(fake));

    const outcome = await service.create(baseInput() as never, 'actor-1');

    expect(outcome.data.internalNo).toBe('V-001');
    expect(outcome.data.year).toBe(2019);
    expect(outcome.data.odometerKm).toBe(120_000);
    expect(outcome.data.fuelType).toBe('DIESEL');
    expect(outcome.data.formSchemaId).toBe(formSchemaId);
    expect(outcome.data.formSchemaVersionId).toBe(versionId);
    expect(outcome.data.status).toBe('ACTIVE');
    expect(outcome.data.version).toBe(0);
    expect(fake.vehicles[0]?.createdById).toBe('actor-1');
    expect(outcome.after?.status).toBe('ACTIVE');
  });

  it('bez objavljene VEHICLE forme ne kreira zapis', async () => {
    const fake = new FakeVehiclePrisma();
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('FORM_VERSION_NOT_PUBLISHED');
  });

  it('odbija verziju forme drugog subjecta', async () => {
    const fake = new FakeVehiclePrisma();
    const { versionId } = fake.addForm({ subject: 'TASK', definition: vehicleForm() });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(
      service.create({ formData: baseInput().formData as object, formSchemaVersionId: versionId } as never),
    );
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('P11: nedostajuće obavezno polje daje grešku po ključu forme', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));

    const { make: _make, ...withoutMake } = baseInput();

    const error = await catchVfm(service.create(withoutMake as never));
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect((error.details ?? []).some((item) => item.path?.join('.') === 'formData.make')).toBe(true);
    expect(fake.vehicles).toHaveLength(0);
  });

  it('dupli internalNo među aktivnim vozilima → DUPLICATE_VALUE', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    await service.create(baseInput() as never);

    const error = await catchVfm(
      service.create({ ...baseInput(), formData: { plateNumber: 'B99-M-999' } } as never),
    );
    expect(error.code).toBe('DUPLICATE_ENTRY');
    expect(error.httpStatus).toBe(409);
  });

  it('mapiranje na kolonu koja nije dozvoljena se odbija već pri parsiranju definicije', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm({
      definition: vehicleForm({
        normalizedName: [
          ...(vehicleForm().normalizedName as unknown[]),
          { fieldKey: 'make', column: 'modelYear', transform: 'TO_INT' },
        ],
      }),
    });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('normalizovana vrijednost koja nije cijeli broj → NORMALIZATION_MISMATCH', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm({
      definition: vehicleForm({
        normalizedName: [{ fieldKey: 'plateNumber', column: 'odometerKm', transform: 'TO_TEXT' }],
      }),
    });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('NORMALIZATION_MISMATCH');
  });
});

describe('VehiclesService — list', () => {
  async function seeded(): Promise<{ service: VehiclesService; fake: FakeVehiclePrisma }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    await service.create(baseInput() as never);
    await service.create({
      internalNo: 'V-002',
      make: 'Renault',
      model: 'Clio',
      fuelType: 'PETROL',
      formData: { plateNumber: 'B22-M-222' },
    } as never);
    return { service, fake };
  }

  it('podrazumijevano skriva arhivirana vozila', async () => {
    const { service } = await seeded();
    const first = (
      await service.list({ page: 1, pageSize: 25, sortOrder: 'asc', includeArchived: false } as never)
    ).items[0];
    await service.archive(first!.id, {} as never);

    const visible = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: false,
    } as never);
    expect(visible.total).toBe(1);

    const all = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: true,
    } as never);
    expect(all.total).toBe(2);
  });

  it('paginacija vraća `totalPages` i filtrira po `q`', async () => {
    const { service } = await seeded();

    const page = await service.list({
      page: 1,
      pageSize: 1,
      sortOrder: 'asc',
      includeArchived: false,
    } as never);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);

    const search = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: false,
      q: 'clio',
    } as never);
    expect(search.items.map((item) => item.internalNo)).toEqual(['V-002']);
  });
});

describe('VehiclesService — update / status', () => {
  async function seed(): Promise<{
    service: VehiclesService;
    fake: FakeVehiclePrisma;
    vehicle: VehicleDetail;
  }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const created = await service.create(baseInput() as never);
    return { service, fake, vehicle: created.data };
  }

  it('pogrešna `version` → VERSION_CONFLICT s trenutnom verzijom', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.update(vehicle.id, { version: 99, notes: 'x' } as never));
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(getCurrentVersion(error)).toBe(0);
  });

  it('uspješna promjena diže verziju i vraća before/after za audit', async () => {
    const { service, vehicle } = await seed();

    const outcome = await service.update(vehicle.id, {
      version: 0,
      status: 'IN_SERVICE',
      notes: 'Servis u toku',
    } as never);

    expect(outcome.data.status).toBe('IN_SERVICE');
    expect(outcome.data.version).toBe(1);
    expect(outcome.data.notes).toBe('Servis u toku');
    expect(outcome.before?.status).toBe('ACTIVE');
    expect(outcome.after?.status).toBe('IN_SERVICE');
  });

  it('nedozvoljen prelaz statusa → VALIDATION_ERROR', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.update(vehicle.id, { version: 0, status: 'ARCHIVED' } as never));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(VEHICLE_STATUS_TRANSITIONS.ACTIVE).not.toContain('ARCHIVED');
  });

  it('arhivirano vozilo se ne mijenja (samo /restore)', async () => {
    const { service, vehicle } = await seed();
    await service.archive(vehicle.id, { reason: 'prodato' } as never);

    const error = await catchVfm(service.update(vehicle.id, { version: 0, notes: 'x' } as never));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('izmjena formData koristi verziju koju zapis nosi (i RETIRED je dozvoljena)', async () => {
    const { service, fake, vehicle } = await seed();
    // Verzija je u međuvremenu povučena — postojeći zapis se i dalje validira njome (P10).
    const version = fake.versions.find((item) => item.id === vehicle.formSchemaVersionId);
    if (version) version.status = 'RETIRED';

    const outcome = await service.update(vehicle.id, {
      version: 0,
      formData: { plateNumber: 'A12-M-345', odometerKm: 130_000 },
    } as never);

    expect(outcome.data.odometerKm).toBe(130_000);
    expect(outcome.data.formSchemaVersionId).toBe(vehicle.formSchemaVersionId);
  });

  it('dupli `vin` pri izmjeni, uz izuzimanje samog sebe', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const VIN_A = 'WVWZZZ1KZAW000001';
    const VIN_B = 'WVWZZZ1KZAW000002';

    const first = await service.create({ ...baseInput(), vin: VIN_A } as never);
    const second = await service.create({ ...baseInput(), internalNo: 'V-002', vin: VIN_B } as never);

    // Isti zapis smije zadržati svoj VIN.
    const same = await service.update(first.data.id, { version: 0, vin: VIN_A } as never);
    expect(same.data.vin).toBe(VIN_A);

    const error = await catchVfm(service.update(second.data.id, { version: 0, vin: VIN_A } as never));
    expect(error.code).toBe('DUPLICATE_ENTRY');
  });
});

describe('VehiclesService — arhiva i brisanje', () => {
  async function seed(): Promise<{
    service: VehiclesService;
    fake: FakeVehiclePrisma;
    vehicle: VehicleDetail;
  }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const created = await service.create(baseInput() as never);
    return { service, fake, vehicle: created.data };
  }

  it('arhiviranje čuva zapis i postavlja `archivedAt`', async () => {
    const { service, fake, vehicle } = await seed();

    const outcome = await service.archive(vehicle.id, { reason: 'prodato' } as never);

    expect(outcome.data.status).toBe('ARCHIVED');
    expect(outcome.data.archivedAt).not.toBeNull();
    expect(fake.vehicles[0]?.notes).toBe('prodato');
    expect(fake.vehicles[0]?.deletedAt).toBeNull();
  });

  it('restore vraća u `INACTIVE` i briše `archivedAt`', async () => {
    const { service, vehicle } = await seed();
    await service.archive(vehicle.id, {} as never);

    const outcome = await service.restore(vehicle.id);
    expect(outcome.data.status).toBe('INACTIVE');
    expect(outcome.data.archivedAt).toBeNull();
  });

  it('restore nad ne-arhiviranim vozilom → VALIDATION_ERROR', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.restore(vehicle.id));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('brisanje je soft-delete: zapis ostaje, `GET` ga više ne vraća', async () => {
    const { service, fake, vehicle } = await seed();

    await service.remove(vehicle.id, 'actor-1');

    expect(fake.vehicles).toHaveLength(1);
    expect(fake.vehicles[0]?.deletedAt).not.toBeNull();
    const error = await catchVfm(service.get(vehicle.id));
    expect(error.code).toBe('NOT_FOUND');
  });
});
