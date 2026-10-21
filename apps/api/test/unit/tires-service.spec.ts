/** Pregled montaža — filtriranje, datumi, neizmišljeni brojači i permisije. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { tireInstallationListQuerySchema, tireInstallationViewSchema } from '@vfm/shared/schemas';
import { TiresService } from '../../src/modules/tires/tires.service.js';
import { TiresController } from '../../src/modules/tires/tires.controller.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  const row = {
    id,
    vehicleId: id,
    setId: id,
    mountedAt: new Date('2026-01-10T00:00:00Z'),
    mountedOdometerKm: 1000,
    dismountedAt: null,
    dismountedOdometerKm: null,
    positions: ['FRONT_LEFT'],
    kmDriven: null,
    daysInUse: null,
    storageLocationOnDismount: null,
    reason: null,
    version: 0,
    formSchemaVersionId: null,
    set: { code: 'G-001', brand: 'Izmišljeni', model: null, size: '205/55 R16', season: 'WINTER' },
  };
  const delegate = { count: vi.fn().mockResolvedValue(30), findMany: vi.fn().mockResolvedValue([row]) };
  const svc = new TiresService({ tireInstallation: delegate } as unknown as PrismaService);
  return { svc, delegate, row };
}
describe('Gume — historija montaža', () => {
  it('filtrira vozilo, komplet, kod i samo aktivne montaže na serveru', async () => {
    const { svc, delegate } = setup();
    await svc.listInstallations(
      tireInstallationListQuerySchema.parse({
        vehicleId: id,
        setId: id,
        q: ' G-001 ',
        activeOnly: 'true',
        page: 2,
      }),
    );
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: {
          deletedAt: null,
          vehicleId: id,
          setId: id,
          dismountedAt: null,
          set: { code: { contains: 'G-001', mode: 'insensitive' } },
        },
      }),
    );
  });
  it('vraća datum bez vremena i čuva null brojače za aktivnu montažu', async () => {
    const { svc } = setup();
    const result = await svc.listInstallations(tireInstallationListQuerySchema.parse({}));
    expect(tireInstallationViewSchema.parse(result.items[0])).toMatchObject({
      mountedAt: '2026-01-10',
      dismountedAt: null,
      kmDriven: null,
      daysInUse: null,
    });
    expect(result).toMatchObject({ total: 30, totalPages: 2 });
  });
  it('false uključuje i demontirane zapise, ne pretvara string u true', async () => {
    const { svc, delegate } = setup();
    await svc.listInstallations(tireInstallationListQuerySchema.parse({ activeOnly: 'false' }));
    expect(delegate.findMany.mock.calls[0]?.[0].where).not.toHaveProperty('dismountedAt');
  });
  it('nepoznat sort ne ide u Prisma upit; drugi ključ je stabilni ID', async () => {
    const { svc, delegate } = setup();
    await svc.listInstallations(tireInstallationListQuerySchema.parse({ sortBy: 'nepostojecaKolona' }));
    expect(delegate.findMany.mock.calls[0]?.[0].orderBy).toEqual([{ mountedAt: 'asc' }, { id: 'asc' }]);
  });
  it('prazna lista vraća nula stranica', async () => {
    const { svc, delegate } = setup();
    delegate.count.mockResolvedValue(0);
    delegate.findMany.mockResolvedValue([]);
    expect(await svc.listInstallations(tireInstallationListQuerySchema.parse({}))).toMatchObject({
      total: 0,
      totalPages: 0,
      items: [],
    });
  });
  it('validira UUID, veličinu stranice i boolean query', () => {
    for (const input of [
      { vehicleId: 'abc' },
      { pageSize: 1000 },
      { activeOnly: 'yes' },
      { nepotrebno: true },
    ])
      expect(tireInstallationListQuerySchema.safeParse(input).success).toBe(false);
  });
  it('kontroler zahtijeva tire:view', () => {
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', TiresController.prototype.list).permissions,
    ).toEqual(['tire:view']);
  });
});
