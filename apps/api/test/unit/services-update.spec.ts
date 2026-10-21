/** Regresije opisne izmjene: CAS, P10 i očuvanje finansijskih/km podataka. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { updateServiceSchema } from '@vfm/shared/schemas';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';
const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  const row = {
    id,
    vehicleId: id,
    version: 3,
    serviceType: 'Mali servis',
    workshopName: 'Stara',
    description: 'Opis',
    formSchemaId: id,
    formSchemaVersionId: id,
    formData: { serviceDate: '2026-01-20', totalCost: { amount: 10000, currency: 'BAM' } },
    totalCost: 10000,
    odometerKm: 1000,
    serviceDate: new Date('2026-01-20T00:00:00Z'),
    nextServiceDueDate: null,
    nextServiceDueKm: 16000,
    status: 'ACTIVE',
    currency: 'BAM',
  };
  const tx = {
    serviceRecord: {
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi
        .fn<(args: { data: Record<string, unknown>; where: unknown }) => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...row, workshopName: 'Nova', version: 4 }),
    },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id,
        formSchemaId: id,
        version: 1,
        status: 'RETIRED',
        formSchema: { subject: 'SERVICE' },
        definition: SEED_FORMS.find((f) => f.subject === 'SERVICE')!.definition,
      }),
    },
    formSchema: { findFirst: vi.fn() },
  };
  return {
    row,
    tx,
    svc: new ServicesService({
      $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService),
  };
}
describe('Opisna izmjena servisa', () => {
  it('mijenja opisne kolone uz verziju, audit i zapisnu RETIRED formu', async () => {
    const { svc, tx } = setup();
    const result = await svc.update(id, { version: 3, workshopName: 'Nova', description: null });
    expect(tx.serviceRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id, version: 3, deletedAt: null, status: 'ACTIVE' }),
        data: expect.objectContaining({ workshopName: 'Nova', description: null, version: { increment: 1 } }),
      }),
    );
    expect(tx.formSchemaVersion.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id } }));
    expect(tx.formSchema.findFirst).not.toHaveBeenCalled();
    expect(result.before.workshopName).toBe('Stara');
    expect(result.after.workshopName).toBe('Nova');
  });
  it('ne dira km, rokove, datum, zbir, stavke ni verziju forme', async () => {
    const { svc, tx } = setup();
    await svc.update(id, { version: 3, serviceType: 'Veliki servis' });
    const data = tx.serviceRecord.updateMany.mock.calls[0]?.[0].data;
    for (const key of [
      'odometerKm',
      'serviceDate',
      'nextServiceDueKm',
      'nextServiceDueDate',
      'totalCost',
      'items',
      'formSchemaVersionId',
    ])
      expect(data).not.toHaveProperty(key);
  });
  it('zastarjela verzija odbija se prije validacije i upisa', async () => {
    const { svc, tx } = setup();
    await expect(svc.update(id, { version: 2, description: 'Novo' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
  });
  it('konkurentna izmjena tokom validacije se odbija CAS-om', async () => {
    const { row, svc, tx } = setup();
    tx.serviceRecord.updateMany.mockResolvedValue({ count: 0 });
    // Prvi read mora vidjeti v3, drugi v4.
    tx.serviceRecord.findFirst
      .mockReset()
      .mockResolvedValueOnce({ ...row })
      .mockResolvedValue({ ...row, version: 4 });
    await expect(svc.update(id, { version: 3, description: 'Novo' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });
  it('nepostojeći ili obrisani servis vraća 404', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.findFirst.mockResolvedValue(null);
    await expect(svc.update(id, { version: 3, description: null })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('neaktivni servis/arhivirano vozilo blokira izmjenu', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.update(id, { version: 3, description: 'Novo' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
  it('DTO odbija verziju bez promjene, zaštićene kolone i obrnute rokove', () => {
    for (const input of [
      { version: 3 },
      { version: 3, totalCost: 1 },
      { version: 3, vehicleId: id },
      { version: 3, serviceType: '' },
      { version: 3, serviceDate: '2026-02-01', nextServiceDueDate: '2026-01-01' },
      { version: 3, odometerKm: 2000, nextServiceDueKm: 1999 },
      { version: 3, odometerKm: 1.5 },
    ])
      expect(updateServiceSchema.safeParse(input).success).toBe(false);
    expect(
      updateServiceSchema.parse({
        version: 3,
        serviceDate: '2026-01-21',
        odometerKm: null,
        nextServiceDueDate: null,
        nextServiceDueKm: null,
        workshopName: null,
        description: null,
      }),
    ).toMatchObject({
      serviceDate: '2026-01-21',
      odometerKm: null,
      nextServiceDueDate: null,
      nextServiceDueKm: null,
      workshopName: null,
      description: null,
    });
  });
  it('PATCH zahtijeva service:update i audit', () => {
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', ServicesController.prototype.update).permissions,
    ).toEqual(['service:update']);
  });
});
