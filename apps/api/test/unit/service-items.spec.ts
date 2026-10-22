/** Stavke računa: cijeli feninzi, atomski CAS i zapisna verzija forme. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { replaceServiceItemsSchema, type ServiceItemInput } from '@vfm/shared/schemas';
import { ServiceItemsService, serviceItemTotals } from '../../src/modules/services/service-items.service.js';
import { ServiceItemsController } from '../../src/modules/services/service-items.controller.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';
const item: ServiceItemInput = { kind: 'PART', name: 'Filter', quantityHundredths: 150, unitPrice: 101 };
const id = '11111111-1111-4111-8111-111111111111';
function serviceActor(
  scope: 'OWN' | 'ALL',
  id = 'owner-1',
  permission: 'service:update' | 'service:view' = 'service:update',
): AuthenticatedUser {
  return {
    id,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope }],
    },
  } as unknown as AuthenticatedUser;
}

function setup() {
  const record = {
    id,
    vehicleId: id,
    createdById: 'owner-1',
    version: 4,
    totalCost: 5000,
    formSchemaVersionId: id,
    formData: { serviceDate: '2026-01-20', totalCost: { amount: 5000, currency: 'BAM' } },
    items: [],
  };
  const tx = {
    serviceRecord: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(record),
      findUniqueOrThrow: vi.fn().mockResolvedValue(record),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id,
        formSchemaId: id,
        version: 1,
        status: 'RETIRED',
        formSchema: { subject: 'SERVICE' },
        definition: SEED_FORMS.find((form) => form.subject === 'SERVICE')!.definition,
      }),
    },
    formSchema: { findFirst: vi.fn() },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { tx, svc: new ServiceItemsService(prisma as unknown as PrismaService), record };
}
describe('Servisne stavke', () => {
  it('računa svaku stavku u feningama, pola feninga zaokružuje naviše', () => {
    expect(
      serviceItemTotals([item, { ...item, kind: 'LABOR', quantityHundredths: 100, unitPrice: 200 }]),
    ).toEqual({ totals: [152, 200], totalCost: 352, partsCost: 152, laborCost: 200 });
  });
  it('prazna lista daje nulu', () => {
    expect(serviceItemTotals([]).totalCost).toBe(0);
  });
  it('prekoračenje PostgreSQL integer granice se odbija', () => {
    expect(() =>
      serviceItemTotals([{ ...item, quantityHundredths: 1000000, unitPrice: 2147483647 }]),
    ).toThrow();
  });
  it('DTO odbija decimalne stotinke, negativnu cijenu i više od 100 stavki', () => {
    for (const items of [
      [{ ...item, quantityHundredths: 1.5 }],
      [{ ...item, unitPrice: -1 }],
      Array.from({ length: 101 }, () => item),
    ]) {
      expect(replaceServiceItemsSchema.safeParse({ version: 3, items }).success).toBe(false);
    }
  });
  it('zamjena koristi CAS, zapisnu RETIRED formu i ažurira zbir i formData', async () => {
    const { svc, tx } = setup();
    const result = await svc.replace(id, { version: 3, items: [item] });
    expect(tx.serviceRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 3, deletedAt: null, status: 'ACTIVE' }),
        data: { version: { increment: 1 } },
      }),
    );
    expect(tx.formSchemaVersion.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id } }));
    expect(tx.formSchema.findFirst).not.toHaveBeenCalled();
    expect(tx.serviceItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quantity: '1.50', unitPrice: 101, totalPrice: 152, position: 0 })],
    });
    expect(tx.serviceRecord.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({
        totalCost: 152,
        partsCost: 152,
        laborCost: 0,
        formData: expect.objectContaining({ totalCost: { amount: 152, currency: 'BAM' } }),
      }),
    });
    expect(result.before.totalCost).toBe(5000);
    expect(result.data).toEqual({ id, version: 4, totalCost: 152 });
  });
  it('service:update OWN blokira zamjenu stavki tuđeg servisa prije CAS-a', async () => {
    const { svc, tx } = setup();
    await expect(
      svc.replace(id, { version: 3, items: [item] }, serviceActor('OWN', 'other-user')),
    ).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
    expect(tx.serviceRecord.updateMany).not.toHaveBeenCalled();
  });
  it('service:view OWN blokira čitanje stavki tuđeg servisa', async () => {
    const { svc } = setup();
    await expect(svc.get(id, serviceActor('OWN', 'other-user', 'service:view'))).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
  });
  it('zastarjela verzija ne briše stavke', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.replace(id, { version: 2, items: [item] })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(tx.serviceItem.deleteMany).not.toHaveBeenCalled();
  });
  it('nedostajući servis vraća NOT_FOUND', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.updateMany.mockResolvedValue({ count: 0 });
    tx.serviceRecord.findFirst.mockResolvedValue(null);
    await expect(svc.replace(id, { version: 3, items: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('neaktivni servis ili arhivirano vozilo se odbija bez brisanja', async () => {
    const { svc, tx } = setup();
    tx.serviceRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.replace(id, { version: 4, items: [] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tx.serviceItem.deleteMany).not.toHaveBeenCalled();
  });
  it('prazna zamjena ne poziva createMany, ali postavlja zbir na nulu', async () => {
    const { svc, tx } = setup();
    await svc.replace(id, { version: 3, items: [] });
    expect(tx.serviceItem.createMany).not.toHaveBeenCalled();
    expect(tx.serviceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalCost: 0 }) }),
    );
  });
  it('greška upisa propagira se iz transakcije i sprečava završni update', async () => {
    const { svc, tx } = setup();
    tx.serviceItem.createMany.mockRejectedValue(new Error('kvar upisa'));
    await expect(svc.replace(id, { version: 3, items: [item] })).rejects.toThrow('kvar upisa');
    expect(tx.serviceRecord.update).not.toHaveBeenCalled();
  });
  it('GET normalizuje decimalnu količinu bez promjene feninga', async () => {
    const { svc, tx, record } = setup();
    tx.serviceRecord.findFirst.mockResolvedValue({
      ...record,
      items: [{ ...item, id, quantity: '1.50', totalPrice: 152, partNumber: null, notes: null }],
    });
    expect(await svc.get(id)).toMatchObject({
      version: 4,
      items: [{ quantityHundredths: 150, totalPrice: 152 }],
    });
  });
  it('GET i PUT zahtijevaju odgovarajuće permisije', () => {
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', ServiceItemsController.prototype.get).permissions,
    ).toEqual(['service:view']);
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', ServiceItemsController.prototype.replace).permissions,
    ).toEqual(['service:update']);
  });
});
