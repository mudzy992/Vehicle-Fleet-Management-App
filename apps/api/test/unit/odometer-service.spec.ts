/**
 * Kilometraža — `POST /vehicles/:id/odometer` i `/correct` (docs/07 §2.5).
 *
 * Provjerava pravila iz docs/03 §3.3:
 * - nova vrijednost < zatečene → `422 ODOMETER_REGRESSION` (bez upisa);
 * - ispravka je jedini put za nižu vrijednost i traži razlog (≥ 5 znakova);
 * - `Vehicle.odometerKm`/`odometerUpdatedAt` se mijenjaju u **istoj** transakciji
 *   i `version` raste (stari klijent dobija `VERSION_CONFLICT`);
 * - očitanje „iz budućnosti" se odbija; lista je sortirana po vremenu očitanja.
 */
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { VehiclesService } from '../../src/modules/vehicles/vehicles.service.js';
import type { VehicleDetail } from '@vfm/shared/schemas';
import { FakeVehiclePrisma, asPrisma, baseInput, catchVfm } from '../helpers/vehicles-fake.js';

const SUPER_ADMIN = { id: 'super-admin', isSuperAdmin: true } as AuthenticatedUser;

async function seedVehicle(): Promise<{
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

describe('dodavanje očitanja', () => {
  it('viša vrijednost: upisuje očitanje i denormalizovanu kilometražu u transakciji', async () => {
    const { service, fake, vehicle } = await seedVehicle();
    expect(vehicle.odometerKm).toBe(120_000);

    const outcome = await service.addOdometer(
      vehicle.id,
      { valueKm: 121_500, source: 'MANUAL', readingAt: '2026-10-20T08:00:00.000Z' } as never,
      'actor-1',
    );

    expect(outcome.data.valueKm).toBe(121_500);
    expect(outcome.data.isCorrection).toBe(false);
    expect(outcome.data.recordedById).toBe('actor-1');
    expect(fake.readings).toHaveLength(1);
    expect(fake.vehicles[0]?.odometerKm).toBe(121_500);
    expect(fake.vehicles[0]?.odometerUpdatedAt?.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    // `version` raste da stari klijent dobije VERSION_CONFLICT.
    expect(fake.vehicles[0]?.version).toBe(vehicle.version + 1);
    expect(outcome.before?.odometerKm).toBe(120_000);
    expect(outcome.after?.odometerKm).toBe(121_500);
  });

  it('niža vrijednost od zatečene → ODOMETER_REGRESSION, bez upisa', async () => {
    const { service, fake, vehicle } = await seedVehicle();

    const error = await catchVfm(
      service.addOdometer(vehicle.id, { valueKm: 119_999, source: 'MANUAL' } as never),
    );

    expect(error.code).toBe('ODOMETER_REGRESSION');
    expect(error.httpStatus).toBe(422);
    expect(error.extra?.currentKm).toBe(120_000);
    expect(fake.readings).toHaveLength(0);
    expect(fake.vehicles[0]?.odometerKm).toBe(120_000);
  });

  it('jednaka vrijednost je dozvoljena (nije regresija)', async () => {
    const { service, vehicle } = await seedVehicle();

    const outcome = await service.addOdometer(vehicle.id, { valueKm: 120_000 } as never);
    expect(outcome.data.valueKm).toBe(120_000);
  });

  it('bez `source` koristi se MANUAL, s `source` se čuva izvor', async () => {
    const { service, vehicle } = await seedVehicle();

    const manual = await service.addOdometer(vehicle.id, { valueKm: 121_000 } as never);
    expect(manual.data.source).toBe('MANUAL');

    const task = await service.addOdometer(vehicle.id, {
      valueKm: 122_000,
      source: 'TASK',
      referenceType: 'Task',
    } as never);
    expect(task.data.source).toBe('TASK');
  });

  it('očitanje u budućnosti → VALIDATION_ERROR', async () => {
    const { service, vehicle } = await seedVehicle();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const error = await catchVfm(
      service.addOdometer(vehicle.id, { valueKm: 130_000, readingAt: future } as never),
    );
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('nepostojeće vozilo → NOT_FOUND', async () => {
    const { service } = await seedVehicle();

    const error = await catchVfm(service.addOdometer('nema-ga', { valueKm: 1 } as never));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('ispravka očitanja', () => {
  it('niža vrijednost s razlogom: isCorrection, previousValueKm i nova denormalizovana vrijednost', async () => {
    const { service, fake, vehicle } = await seedVehicle();

    const outcome = await service.correctOdometer(
      vehicle.id,
      { valueKm: 118_000, correctionReason: 'Greška u unosu pri servisu.' } as never,
      'actor-1',
    );

    expect(outcome.data.isCorrection).toBe(true);
    expect(outcome.data.correctionReason).toBe('Greška u unosu pri servisu.');
    expect(outcome.data.previousValueKm).toBe(120_000);
    expect(fake.vehicles[0]?.odometerKm).toBe(118_000);
    expect(outcome.after?.previousValueKm).toBe(120_000);
  });

  it('prekratak razlog → VALIDATION_ERROR i bez upisa', async () => {
    const { service, fake, vehicle } = await seedVehicle();

    const error = await catchVfm(
      service.correctOdometer(vehicle.id, { valueKm: 118_000, correctionReason: 'x' } as never),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(fake.readings).toHaveLength(0);
  });

  it('korekcija na višu vrijednost je dozvoljena', async () => {
    const { service, vehicle } = await seedVehicle();

    const outcome = await service.correctOdometer(vehicle.id, {
      valueKm: 125_000,
      correctionReason: 'Naknadno očitano sa displeja.',
    } as never);
    expect(outcome.data.valueKm).toBe(125_000);
  });
});

describe('lista očitanja', () => {
  it('vraća stavke obrnutim redom po vremenu očitanja uz paginaciju', async () => {
    const { service, vehicle } = await seedVehicle();
    await service.addOdometer(vehicle.id, {
      valueKm: 121_000,
      readingAt: '2026-10-18T08:00:00.000Z',
    } as never);
    await service.addOdometer(vehicle.id, {
      valueKm: 122_000,
      readingAt: '2026-10-19T08:00:00.000Z',
    } as never);
    await service.addOdometer(vehicle.id, {
      valueKm: 123_000,
      readingAt: '2026-10-20T08:00:00.000Z',
    } as never);

    const first = await service.listOdometer(vehicle.id, { page: 1, pageSize: 2 }, SUPER_ADMIN);
    expect(first.items.map((item) => item.valueKm)).toEqual([123_000, 122_000]);
    expect(first.total).toBe(3);
    expect(first.totalPages).toBe(2);

    const second = await service.listOdometer(vehicle.id, { page: 2, pageSize: 2 }, SUPER_ADMIN);
    expect(second.items.map((item) => item.valueKm)).toEqual([121_000]);
  });

  it('lista nepostojećeg vozila → NOT_FOUND', async () => {
    const { service } = await seedVehicle();

    const error = await catchVfm(service.listOdometer('nema-ga', { page: 1, pageSize: 25 }, SUPER_ADMIN));
    expect(error.code).toBe('NOT_FOUND');
  });
});
