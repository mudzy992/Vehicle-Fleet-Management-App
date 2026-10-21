/** Unos servisa: stvarna validacija forme, transakcija i zaključavanje vozila. */
import { describe, expect, it, vi } from 'vitest';
import { createServiceSchema } from '@vfm/shared/schemas';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const id = '11111111-1111-4111-8111-111111111111';
function setup({ km = 1000, status = 'ACTIVE', versionStatus = 'PUBLISHED' } = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => {
      calls.push('zakljucavanje');
      return [{ id, odometerKm: km, status }];
    }),
    serviceRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('servis');
        return { ...data, currency: 'BAM', status: 'ACTIVE', version: 0 };
      }),
      findFirst: vi
        .fn()
        .mockResolvedValue({ nextServiceDueDate: new Date('2027-10-20T00:00:00Z'), nextServiceDueKm: 20000 }),
    },
    odometerReading: {
      create: vi.fn(async () => {
        calls.push('km');
      }),
    },
    vehicle: {
      update: vi.fn(async (_args: unknown) => {
        calls.push('vozilo');
      }),
    },
  };
  const prisma = {
    formSchema: { findFirst: vi.fn().mockResolvedValue({ currentPublishedVersionId: id }) },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id,
        formSchemaId: id,
        version: 1,
        status: versionStatus,
        formSchema: { subject: 'SERVICE' },
        definition: SEED_FORMS.find((form) => form.subject === 'SERVICE')!.definition,
      }),
    },
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const svc = new ServicesService(prisma as unknown as PrismaService);
  const input = createServiceSchema.parse({
    vehicleId: id,
    serviceDate: '2026-01-20',
    serviceType: 'Mali servis',
    totalCost: 15550,
    odometerKm: 1500,
  });
  return { svc, tx, prisma, calls, input };
}

describe('Servisi — unos', () => {
  it('zaključava vozilo pa upisuje servis, očitanje i denormalizovane vrijednosti', async () => {
    const { svc, tx, input, calls } = setup();
    const result = await svc.create(input, id);
    expect(calls).toEqual(['zakljucavanje', 'servis', 'km', 'vozilo']);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(result.data).toMatchObject({
      totalCost: 15550,
      serviceDate: '2026-01-20',
      formSchemaVersionId: id,
    });
    expect(tx.odometerReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'SERVICE',
        referenceId: result.data.id,
        valueKm: 1500,
        recordedById: id,
      }),
    });
    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          odometerKm: 1500,
          nextServiceDueKm: 20000,
          version: { increment: 1 },
        }),
      }),
    );
    expect(result.after.previousOdometerKm).toBe(1000);
    expect(tx.serviceRecord.create.mock.calls[0]?.[0].data.serviceDate).toBeInstanceOf(Date);
  });
  it('regresija km se provjerava nakon zaključavanja i prije bilo kojeg upisa', async () => {
    const { svc, input, calls } = setup({ km: 2000 });
    await expect(svc.create(input)).rejects.toMatchObject({ code: 'ODOMETER_REGRESSION' });
    expect(calls).toEqual(['zakljucavanje']);
  });
  it('bez km ne stvara očitanje niti mijenja trenutnu kilometražu', async () => {
    const { svc, input, tx } = setup();
    const { odometerKm: _km, ...withoutKm } = input;
    await svc.create(withoutKm);
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update.mock.calls[0]?.[0]).not.toHaveProperty('data.odometerKm');
  });
  it('arhivirano vozilo odbija unos', async () => {
    const { svc, input, calls } = setup({ status: 'ARCHIVED' });
    await expect(svc.create(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls).toEqual(['zakljucavanje']);
  });
  it('nepostojeće vozilo nema upisa', async () => {
    const { svc, tx, input } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(svc.create(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.serviceRecord.create).not.toHaveBeenCalled();
  });
  it('nova evidencija ne koristi povučenu verziju forme', async () => {
    const { svc, input, prisma } = setup({ versionStatus: 'RETIRED' });
    await expect(svc.create(input)).rejects.toMatchObject({ code: 'FORM_VERSION_NOT_PUBLISHED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('datum iz budućnosti odbija prije transakcije', async () => {
    const { svc, input, prisma } = setup();
    await expect(svc.create({ ...input, serviceDate: '2099-01-01' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('greška očitanja propagira se iz iste transakcije; vozilo se ne ažurira', async () => {
    const { svc, tx, input } = setup();
    tx.odometerReading.create.mockRejectedValue(new Error('kvar upisa'));
    await expect(svc.create(input)).rejects.toThrow('kvar upisa');
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });
  it('rok vozila dolazi iz najnovijeg aktivnog servisa, ne iz starog unosa', async () => {
    const { svc, tx, input } = setup();
    await svc.create({ ...input, nextServiceDueKm: 5000 });
    expect(tx.vehicle.update.mock.calls[0]?.[0]).toHaveProperty('data.nextServiceDueKm', 20000);
    expect(tx.serviceRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vehicleId: id, deletedAt: null, status: 'ACTIVE' } }),
    );
  });
  it('DTO odbija negativan novac, decimale km, prevelik iznos i rok prije servisa', () => {
    const { input } = setup();
    for (const patch of [
      { totalCost: -1 },
      { totalCost: 2147483648 },
      { odometerKm: 1.5 },
      { nextServiceDueDate: '2020-01-01' },
      { nextServiceDueKm: 1 },
    ]) {
      expect(createServiceSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
});
