/** DELETE servisa: soft-delete, zaključavanje vozila i ponovni obračun rokova. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { AuditContext } from '../../src/common/audit/audit.types.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

const serviceId = '11111111-1111-4111-8111-111111111111';
const vehicleId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const formSchemaId = '44444444-4444-4444-8444-444444444444';
const formVersionId = '55555555-5555-4555-8555-555555555555';

function setup(options: { casOutcome?: 'conflict' | 'missing' } = {}) {
  const calls: string[] = [];
  const row = {
    id: serviceId,
    vehicleId,
    serviceDate: new Date('2026-02-01T00:00:00Z'),
    serviceType: 'Veliki servis',
    workshopName: 'Radionica A',
    description: 'Opis',
    odometerKm: 1500,
    totalCost: 25000,
    currency: 'BAM',
    nextServiceDueDate: new Date('2026-08-01T00:00:00Z'),
    nextServiceDueKm: 11500,
    status: 'ACTIVE',
    formSchemaId,
    formSchemaVersionId: formVersionId,
    version: 3,
  };
  const vehicle = {
    id: vehicleId,
    odometerKm: 1500,
    status: 'ACTIVE',
    nextServiceDueDate: new Date('2026-08-01T00:00:00Z'),
    nextServiceDueKm: 11500,
    version: 7,
  };
  let latestDue: { nextServiceDueDate: Date | null; nextServiceDueKm: number | null } = {
    nextServiceDueDate: new Date('2026-08-01T00:00:00Z'),
    nextServiceDueKm: 11500,
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
          if (serviceByIdReads > 1 && options.casOutcome === 'conflict') return { version: 4 };
          if (serviceByIdReads > 1 && options.casOutcome === 'missing') return null;
          return row;
        }
        return latestDue;
      }),
      updateMany: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => {
        calls.push('brisanje');
        return { count: options.casOutcome ? 0 : 1 };
      }),
    },
    vehicle: {
      update: vi.fn(async () => {
        calls.push('vozilo');
      }),
    },
    serviceItem: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    odometerReading: {
      create: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
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

describe('DELETE servisa', () => {
  it('soft-briše najnoviji aktivni servis i vraća rok prethodnog servisa na vozilo', async () => {
    const { calls, svc, tx, setLatestDue } = setup();
    setLatestDue({ nextServiceDueDate: new Date('2026-07-20T00:00:00Z'), nextServiceDueKm: 11000 });

    const result = await svc.remove(serviceId, actorId);

    expect(calls).toEqual(['zakljucavanje', 'brisanje', 'vozilo']);
    const update = tx.serviceRecord.updateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toMatchObject({ id: serviceId, version: 3, deletedAt: null });
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    expect(update.data.version).toEqual({ increment: 1 });
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: vehicleId },
      data: {
        nextServiceDueDate: new Date('2026-07-20T00:00:00Z'),
        nextServiceDueKm: 11000,
        version: { increment: 1 },
      },
    });
    expect(tx.serviceItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.serviceItem.updateMany).not.toHaveBeenCalled();
    expect(tx.odometerReading.create).not.toHaveBeenCalled();
    expect(tx.odometerReading.deleteMany).not.toHaveBeenCalled();
    expect(tx.odometerReading.updateMany).not.toHaveBeenCalled();
    expect(result.data).toEqual({ id: serviceId });
    expect(result.before).toMatchObject({ id: serviceId, serviceDate: '2026-02-01', version: 3 });
    expect(result.after).toMatchObject({ id: serviceId, deletedById: actorId });
    expect(result.after.deletedAt).toBe((update.data.deletedAt as Date).toISOString());
    expect(result.vehicleBefore).toMatchObject({ odometerKm: 1500, nextServiceDueKm: 11500, version: 7 });
    expect(result.vehicleAfter).toMatchObject({
      odometerKm: 1500,
      nextServiceDueDate: '2026-07-20',
      nextServiceDueKm: 11000,
      version: 8,
    });
  });

  it('brisanje starijeg servisa ne mijenja vozilo ako najnoviji rok ostaje isti', async () => {
    const { svc, tx } = setup();

    const result = await svc.remove(serviceId);

    expect(tx.serviceRecord.updateMany).toHaveBeenCalledOnce();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(result.vehicleAfter).toEqual(result.vehicleBefore);
  });

  it('brisanje zadnjeg aktivnog servisa čisti oba roka vozila', async () => {
    const { svc, tx, setLatestDue } = setup();
    setLatestDue({ nextServiceDueDate: null, nextServiceDueKm: null });

    const result = await svc.remove(serviceId);

    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: vehicleId },
      data: { nextServiceDueDate: null, nextServiceDueKm: null, version: { increment: 1 } },
    });
    expect(result.vehicleAfter).toMatchObject({ nextServiceDueDate: null, nextServiceDueKm: null });
  });

  it('neaktivni servis se može obrisati bez ponovnog obračuna rokova', async () => {
    const { row, svc, tx } = setup();
    row.status = 'CANCELLED';

    await svc.remove(serviceId);

    expect(tx.serviceRecord.updateMany).toHaveBeenCalledOnce();
    expect(tx.serviceRecord.findFirst).toHaveBeenCalledOnce();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('nepostojeći ili već obrisani servis vraća 404 bez zaključavanja', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.findFirst.mockResolvedValue(null);

    await expect(svc.remove(serviceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('arhivirano vozilo blokira brisanje prije upisa', async () => {
    const { svc, tx, vehicle } = setup();
    vehicle.status = 'ARCHIVED';

    await expect(svc.remove(serviceId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('konkurentna izmjena servisa odbija brisanje CAS-om', async () => {
    const { svc, tx } = setup({ casOutcome: 'conflict' });

    await expect(svc.remove(serviceId)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      extra: { currentVersion: 4 },
    });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('konkurentno brisanje drugog zahtjeva završava kao 404', async () => {
    const { svc, tx } = setup({ casOutcome: 'missing' });

    await expect(svc.remove(serviceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('kontroler koristi service:delete, kritični audit, 204 i prosljeđuje aktera', async () => {
    const vehicleBefore = { id: vehicleId, odometerKm: 1500, nextServiceDueKm: 11500, version: 7 };
    const vehicleAfter = { id: vehicleId, odometerKm: 1500, nextServiceDueKm: 11000, version: 8 };
    const remove = vi.fn().mockResolvedValue({
      data: { id: serviceId },
      before: { id: serviceId, vehicleId },
      after: { id: serviceId, deletedAt: '2026-10-21T00:00:00.000Z', deletedById: actorId },
      vehicleBefore,
      vehicleAfter,
    });
    const controller = new ServicesController({ remove } as unknown as ServicesService);
    const request = {} as VfmRequest;

    await expect(
      controller.remove(serviceId, { id: actorId } as AuthenticatedUser, request),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(serviceId, actorId);
    expect(AuditContext.from(request).meta).toMatchObject({ vehicleId, vehicleBefore, vehicleAfter });
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', ServicesController.prototype.remove).permissions,
    ).toEqual(['service:delete']);
    expect(Reflect.getMetadata('vfm:audit', ServicesController.prototype.remove)).toMatchObject({
      action: 'DELETE',
      severity: 'CRITICAL',
      resource: 'ServiceRecord',
    });
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ServicesController.prototype.remove)).toBe(204);
  });
});
