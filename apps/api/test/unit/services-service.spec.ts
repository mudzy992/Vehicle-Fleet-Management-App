/** Faza 4 — pregled servisa, granice upita i dozvole. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { serviceListQuerySchema, serviceRecordSchema } from '@vfm/shared/schemas';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';

function scopedActor(
  permission: string,
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  id = 'viewer-1',
  vehicleIds: string[] = [],
): AuthenticatedUser {
  return {
    id,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeVehicleIds: vehicleIds }],
    },
  } as unknown as AuthenticatedUser;
}

function serviceViewer(
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  id = 'viewer-1',
  vehicleIds: string[] = [],
): AuthenticatedUser {
  const permission = 'service:view' as const;
  return {
    id,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeVehicleIds: vehicleIds }],
    },
  } as unknown as AuthenticatedUser;
}

function fixture() {
  const id = '11111111-1111-4111-8111-111111111111';
  const row = {
    id,
    vehicleId: id,
    serviceDate: new Date('2026-10-21T00:00:00Z'),
    serviceType: 'MALI_SERVIS',
    workshopName: null,
    description: null,
    odometerKm: 12000,
    totalCost: 12345,
    currency: 'BAM',
    nextServiceDueDate: new Date('2027-10-21T00:00:00Z'),
    nextServiceDueKm: 27000,
    status: 'ACTIVE',
    formSchemaId: id,
    formSchemaVersionId: id,
    version: 0,
  };
  const delegate = {
    count: vi.fn().mockResolvedValue(51),
    findMany: vi.fn().mockResolvedValue([row]),
    findFirst: vi.fn().mockResolvedValue(row),
  };
  const service = new ServicesService({ serviceRecord: delegate } as unknown as PrismaService);
  return { service, delegate, row, id };
}

describe('Servisi — pregled', () => {
  it('create VEHICLE_IDS odbija vozilo izvan dodijeljenog opsega', async () => {
    const { service, id } = fixture();
    await expect(
      service.create(
        { vehicleId: id } as never,
        'viewer-1',
        scopedActor('service:create', 'VEHICLE_IDS', 'viewer-1', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('šalje filtere i paginaciju na server, skriva soft-delete', async () => {
    const { service, delegate, id } = fixture();
    const result = await service.list(
      serviceListQuerySchema.parse({
        page: 2,
        vehicleId: id,
        q: ' ulje ',
        status: 'ACTIVE',
        serviceType: 'MALI_SERVIS',
      }),
      serviceViewer('ALL'),
    );
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: expect.objectContaining({
          deletedAt: null,
          vehicleId: id,
          status: 'ACTIVE',
          serviceType: 'MALI_SERVIS',
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result).toMatchObject({ total: 51, totalPages: 3, page: 2 });
    expect(serviceRecordSchema.parse(result.items[0]).totalCost).toBe(12345);
  });
  it('spaja korisnički vehicleId filter sa VEHICLE_IDS scope-om i odbija direktni GET izvan opsega', async () => {
    const { service, delegate, id } = fixture();
    const otherVehicleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await service.list(
      serviceListQuerySchema.parse({ vehicleId: id }),
      serviceViewer('VEHICLE_IDS', 'viewer-1', [otherVehicleId]),
    );
    const where = delegate.findMany.mock.calls[0]?.[0].where;
    expect(where.AND).toEqual([
      expect.objectContaining({ deletedAt: null, vehicleId: id }),
      { vehicleId: { in: [otherVehicleId] } },
    ]);

    await expect(
      service.get(id, serviceViewer('VEHICLE_IDS', 'viewer-1', [otherVehicleId])),
    ).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
  });

  it('datumi su lokalni datumi, ne timestampovi', async () => {
    const { service, id } = fixture();
    expect(await service.get(id, serviceViewer('ALL'))).toMatchObject({
      serviceDate: '2026-10-21',
      nextServiceDueDate: '2027-10-21',
    });
  });
  it('nepostojeći ili obrisan zapis vraća NOT_FOUND', async () => {
    const { service, delegate, id } = fixture();
    delegate.findFirst.mockResolvedValue(null);
    await expect(service.get(id, serviceViewer('ALL'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, deletedAt: null } }),
    );
  });
  it('nepoznato sortiranje ne ide u Prisma upit', async () => {
    const { service, delegate } = fixture();
    await service.list(serviceListQuerySchema.parse({ sortBy: 'nepostojecaKolona' }), serviceViewer('ALL'));
    expect(delegate.findMany.mock.calls[0]?.[0].orderBy[0]).toHaveProperty('serviceDate');
  });
  it('validira UUID, status i veličinu stranice', () => {
    for (const query of [{ vehicleId: 'nije-uuid' }, { status: 'NEPOZNAT' }, { pageSize: 1000 }]) {
      expect(serviceListQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it('prazna lista nema izmišljenih stranica', async () => {
    const { service, delegate } = fixture();
    delegate.count.mockResolvedValue(0);
    delegate.findMany.mockResolvedValue([]);
    expect(await service.list(serviceListQuerySchema.parse({}), serviceViewer('ALL'))).toMatchObject({
      items: [],
      total: 0,
      totalPages: 0,
    });
  });
  it('oba endpointa imaju oznaku permisije', () => {
    for (const method of [ServicesController.prototype.list, ServicesController.prototype.get]) {
      expect(Reflect.getMetadata('vfm:requiredPermissions', method)).toEqual({
        permissions: ['service:view'],
        mode: 'ALL',
        scope: 'OWN',
      });
    }
  });
});
