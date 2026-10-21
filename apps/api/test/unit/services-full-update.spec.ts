/** Potpuna izmjena servisa: datum, km, rokovi, zaključavanje i denormalizacija vozila. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { updateServiceSchema, type UpdateServiceInput } from '@vfm/shared/schemas';
import { AuditContext } from '../../src/common/audit/audit.types.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const serviceId = '11111111-1111-4111-8111-111111111111';
const vehicleId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const formSchemaId = '44444444-4444-4444-8444-444444444444';
const formVersionId = '55555555-5555-4555-8555-555555555555';

function setup(options: { casConflict?: boolean } = {}) {
  const calls: string[] = [];
  const row = {
    id: serviceId,
    vehicleId,
    version: 3,
    serviceDate: new Date('2026-01-20T00:00:00Z'),
    serviceType: 'Mali servis',
    workshopName: 'Stara radionica',
    description: 'Opis',
    odometerKm: 1000,
    totalCost: 10000,
    currency: 'BAM',
    nextServiceDueDate: new Date('2026-07-20T00:00:00Z'),
    nextServiceDueKm: 11000,
    status: 'ACTIVE',
    formSchemaId,
    formSchemaVersionId: formVersionId,
    formData: { serviceDate: '2026-01-20', totalCost: { amount: 10000, currency: 'BAM' } },
    createdAt: new Date('2026-01-20T10:00:00Z'),
  };
  const vehicle = {
    id: vehicleId,
    odometerKm: 1000,
    status: 'ACTIVE',
    nextServiceDueDate: new Date('2026-07-20T00:00:00Z'),
    nextServiceDueKm: 11000,
    version: 7,
  };
  let updatedRow = { ...row };
  let latestDue: { nextServiceDueDate: Date | null; nextServiceDueKm: number | null } = {
    nextServiceDueDate: new Date('2026-07-20T00:00:00Z'),
    nextServiceDueKm: 11000,
  };
  let serviceByIdReads = 0;

  const tx = {
    $queryRaw: vi.fn(async () => {
      calls.push('zakljucavanje');
      return [vehicle];
    }),
    serviceRecord: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        if ('id' in args.where) {
          serviceByIdReads += 1;
          return options.casConflict && serviceByIdReads > 1 ? { ...row, version: 4 } : row;
        }
        return latestDue;
      }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.push('servis');
        if (options.casConflict) return { count: 0 };
        updatedRow = { ...row, ...args.data, version: 4 };
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => updatedRow),
    },
    odometerReading: {
      create: vi.fn(async () => {
        calls.push('km');
      }),
    },
    vehicle: {
      update: vi.fn(async () => {
        calls.push('vozilo');
      }),
    },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id: formVersionId,
        formSchemaId,
        version: 1,
        status: 'RETIRED',
        formSchema: { subject: 'SERVICE' },
        definition: SEED_FORMS.find((form) => form.subject === 'SERVICE')!.definition,
      }),
    },
    formSchema: { findFirst: vi.fn() },
  };

  return {
    calls,
    row,
    vehicle,
    tx,
    setLatestDue(next: typeof latestDue) {
      latestDue = next;
    },
    svc: new ServicesService({
      $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService),
  };
}

function parse(input: Record<string, unknown>): UpdateServiceInput {
  return updateServiceSchema.parse({ version: 3, ...input });
}

describe('Potpuna izmjena servisa', () => {
  it('mijenja datum/km/rokove, dodaje SERVICE očitanje i ažurira vozilo u istoj transakciji', async () => {
    const { calls, svc, tx, setLatestDue } = setup();
    setLatestDue({ nextServiceDueDate: new Date('2026-08-01T00:00:00Z'), nextServiceDueKm: 11500 });

    const result = await svc.update(
      serviceId,
      parse({
        serviceDate: '2026-02-01',
        odometerKm: 1500,
        nextServiceDueDate: '2026-08-01',
        nextServiceDueKm: 11500,
      }),
      actorId,
    );

    expect(calls).toEqual(['zakljucavanje', 'servis', 'km', 'vozilo']);
    const data = tx.serviceRecord.updateMany.mock.calls[0]?.[0].data;
    expect(data?.serviceDate).toBeInstanceOf(Date);
    expect((data?.serviceDate as Date).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(data?.nextServiceDueDate).toBeInstanceOf(Date);
    expect(data).toMatchObject({ odometerKm: 1500, nextServiceDueKm: 11500 });
    expect(data).not.toHaveProperty('totalCost');
    expect(data?.formData).toMatchObject({ serviceDate: '2026-02-01' });
    expect(tx.odometerReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vehicleId,
        valueKm: 1500,
        source: 'SERVICE',
        referenceType: 'ServiceRecord',
        referenceId: serviceId,
        recordedById: actorId,
      }),
    });
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: vehicleId },
      data: expect.objectContaining({
        odometerKm: 1500,
        nextServiceDueKm: 11500,
        version: { increment: 1 },
      }),
    });
    expect(result.before).toMatchObject({ serviceDate: '2026-01-20', odometerKm: 1000 });
    expect(result.after).toMatchObject({ serviceDate: '2026-02-01', odometerKm: 1500, version: 4 });
    expect(result.vehicleBefore).toMatchObject({ odometerKm: 1000, version: 7 });
    expect(result.vehicleAfter).toMatchObject({
      odometerKm: 1500,
      nextServiceDueDate: '2026-08-01',
      nextServiceDueKm: 11500,
      version: 8,
    });
  });

  it('pomjeranje datuma unazad vraća rok vozila na drugi najnoviji servis', async () => {
    const { svc, tx, setLatestDue } = setup();
    setLatestDue({ nextServiceDueDate: new Date('2026-09-01T00:00:00Z'), nextServiceDueKm: 12000 });

    await svc.update(serviceId, parse({ serviceDate: '2026-01-01' }));

    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: vehicleId },
      data: {
        nextServiceDueDate: new Date('2026-09-01T00:00:00Z'),
        nextServiceDueKm: 12000,
        version: { increment: 1 },
      },
    });
  });

  it('rok starijeg servisa ne prepisuje rok najnovijeg servisa na vozilu', async () => {
    const { svc, tx, vehicle, setLatestDue } = setup();
    vehicle.nextServiceDueDate = new Date('2026-09-01T00:00:00Z');
    vehicle.nextServiceDueKm = 12000;
    setLatestDue({ nextServiceDueDate: new Date('2026-09-01T00:00:00Z'), nextServiceDueKm: 12000 });

    await svc.update(serviceId, parse({ nextServiceDueDate: '2026-08-01', nextServiceDueKm: 11500 }));

    expect(tx.serviceRecord.updateMany).toHaveBeenCalledOnce();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('nova km ispod zaključane trenutne km vozila je regresija i nema upisa', async () => {
    const { svc, tx, vehicle } = setup();
    vehicle.odometerKm = 2000;

    await expect(svc.update(serviceId, parse({ odometerKm: 1500 }))).rejects.toMatchObject({
      code: 'ODOMETER_REGRESSION',
      extra: { currentKm: 2000 },
    });
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('snižavanje snapshot km na već korigovanu trenutnu km ne dodaje očitanje niti diže vozilo', async () => {
    const { row, svc, tx, vehicle } = setup();
    row.odometerKm = 2000;
    vehicle.odometerKm = 1500;

    const result = await svc.update(serviceId, parse({ odometerKm: 1500 }));

    expect(tx.serviceRecord.updateMany.mock.calls[0]?.[0].data).toMatchObject({ odometerKm: 1500 });
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(result.vehicleAfter).toEqual(result.vehicleBefore);
  });

  it('brisanje km i rokova čisti snapshot/rokove, ali ne mijenja trenutnu km vozila', async () => {
    const { svc, tx, setLatestDue } = setup();
    setLatestDue({ nextServiceDueDate: null, nextServiceDueKm: null });

    const result = await svc.update(
      serviceId,
      parse({ odometerKm: null, nextServiceDueDate: null, nextServiceDueKm: null }),
    );

    expect(tx.serviceRecord.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      odometerKm: null,
      nextServiceDueDate: null,
      nextServiceDueKm: null,
    });
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: vehicleId },
      data: { nextServiceDueDate: null, nextServiceDueKm: null, version: { increment: 1 } },
    });
    expect(result.vehicleAfter).toMatchObject({ odometerKm: 1000, nextServiceDueDate: null });
  });

  it('efektivni rokovi i budući datum odbijaju se prije zaključavanja i upisa', async () => {
    const { svc, tx } = setup();

    await expect(svc.update(serviceId, parse({ nextServiceDueDate: '2026-01-19' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(svc.update(serviceId, parse({ nextServiceDueKm: 900 }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(svc.update(serviceId, parse({ serviceDate: '2099-01-01' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('arhivirano vozilo blokira izmjenu rasporeda prije CAS upisa', async () => {
    const { svc, tx, vehicle } = setup();
    vehicle.status = 'ARCHIVED';

    await expect(svc.update(serviceId, parse({ nextServiceDueKm: 12000 }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('CAS konflikt nakon zaključavanja ne upisuje očitanje ni vozilo', async () => {
    const { svc, tx } = setup({ casConflict: true });

    await expect(svc.update(serviceId, parse({ serviceDate: '2026-02-01' }))).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('kontroler prosljeđuje aktera i vozilo prije/poslije u audit meta', async () => {
    const vehicleBefore = { id: vehicleId, odometerKm: 1000, nextServiceDueKm: 11000 };
    const vehicleAfter = { id: vehicleId, odometerKm: 1500, nextServiceDueKm: 11500 };
    const update = vi.fn().mockResolvedValue({
      data: { id: serviceId, vehicleId },
      before: { odometerKm: 1000 },
      after: { odometerKm: 1500 },
      vehicleBefore,
      vehicleAfter,
    });
    const controller = new ServicesController({ update } as unknown as ServicesService);
    const request = {} as VfmRequest;
    const input = parse({ odometerKm: 1500 });

    await controller.update(serviceId, input, { id: actorId } as AuthenticatedUser, request);

    expect(update).toHaveBeenCalledWith(serviceId, input, actorId);
    expect(AuditContext.from(request).meta).toMatchObject({ vehicleBefore, vehicleAfter });
  });
});
