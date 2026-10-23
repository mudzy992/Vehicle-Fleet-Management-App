/** Kompleti guma — lista, verzionisani unos, jedinstveni kod i permisije. */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { createTireSetSchema, tireSetListQuerySchema, tireSetViewSchema } from '@vfm/shared/schemas';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { TiresService } from '../../src/modules/tires/tires.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const actorId = '11111111-1111-4111-8111-111111111111';
const formSchemaId = '22222222-2222-4222-8222-222222222222';
const formVersionId = '33333333-3333-4333-8333-333333333333';
const vehicleId = '44444444-4444-4444-8444-444444444444';
const otherVehicleId = '66666666-6666-4666-8666-666666666666';

function scopeActor(
  permission: string,
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  scopeVehicleIds: string[] = [],
  id = actorId,
): AuthenticatedUser {
  return {
    id,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeVehicleIds }],
    },
  } as unknown as AuthenticatedUser;
}

function setup({ versionStatus = 'PUBLISHED' } = {}) {
  const row = {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'G-Z-001',
    brand: 'Izmišljena marka',
    model: 'Zimska proba',
    size: '205/55 R16',
    season: 'WINTER',
    tireCount: 4,
    purchaseDate: new Date('2026-01-15T00:00:00Z'),
    purchasePrice: 60000,
    currency: 'BAM',
    status: 'MOUNTED',
    currentLocation: null,
    notes: null,
    formSchemaId,
    formSchemaVersionId: formVersionId,
    version: 0,
    installations: [
      {
        vehicleId,
        vehicle: { internalNo: 'V-001', plateNumber: 'A01-K-001' },
      },
    ],
  };
  const tireSet = {
    count: vi.fn().mockResolvedValue(30),
    findMany: vi.fn().mockResolvedValue([row]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      version: 0,
      installations: [],
    })),
  };
  const prisma = {
    tireSet,
    formSchema: { findFirst: vi.fn().mockResolvedValue({ currentPublishedVersionId: formVersionId }) },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id: formVersionId,
        formSchemaId,
        version: 1,
        status: versionStatus,
        formSchema: { subject: 'TIRE_SET' },
        definition: SEED_FORMS.find((form) => form.subject === 'TIRE_SET')!.definition,
      }),
    },
  };
  const svc = new TiresService(prisma as unknown as PrismaService);
  const input = createTireSetSchema.parse({
    code: 'G-Z-001',
    brand: 'Izmišljena marka',
    model: 'Zimska proba',
    size: '205/55 R16',
    season: 'WINTER',
    purchaseDate: '2026-01-15',
    purchasePrice: 60000,
    currentLocation: 'Skladište A',
    formData: { supplier: 'Izmišljeni dobavljač', invoiceNumber: 'F-001' },
  });
  return { svc, tireSet, prisma, row, input };
}

describe('Gume — kompleti', () => {
  it('spaja dostupnost s tire:view VEHICLE_IDS scope-om i ne vraća tuđe aktivno vozilo', async () => {
    const { svc, tireSet } = setup();
    const result = await svc.listSets(
      tireSetListQuerySchema.parse({ availableOnly: 'true' }),
      scopeActor('tire:view', 'VEHICLE_IDS', [otherVehicleId]),
    );
    const query = tireSet.findMany.mock.calls[0]?.[0];
    expect(query.where.AND).toEqual([
      { status: 'IN_STOCK' },
      { installations: { none: { dismountedAt: null, deletedAt: null } } },
      { installations: { some: { vehicleId: { in: [otherVehicleId] }, deletedAt: null } } },
    ]);
    expect(result.items[0]?.mountedVehicleId).toBeNull();
  });

  it('odbija kreiranje kompleta pod opsegom VEHICLE_IDS', async () => {
    const { svc, input } = setup();
    await expect(
      svc.createSet(input, actorId, scopeActor('tire:create', 'VEHICLE_IDS', [vehicleId])),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('odbija čitanje guma ako korisnik nema pristup roditeljskom kompletu', async () => {
    const { svc, tireSet, row } = setup();
    tireSet.findFirst.mockResolvedValue({ ...row, createdById: actorId });
    await expect(
      svc.listTires(row.id, scopeActor('tire:view', 'OWN', [], otherVehicleId)),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('filtrira pretragu, sezonu, status i dostupnost na serveru', async () => {
    const { svc, tireSet } = setup();
    await svc.listSets(
      tireSetListQuerySchema.parse({
        q: ' zimska ',
        season: 'WINTER',
        status: 'IN_STOCK',
        availableOnly: 'true',
        page: 2,
      }),
    );
    const contains = { contains: 'zimska', mode: 'insensitive' };
    expect(tireSet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: {
          deletedAt: null,
          season: 'WINTER',
          status: 'IN_STOCK',
          AND: [{ status: 'IN_STOCK' }, { installations: { none: { dismountedAt: null, deletedAt: null } } }],
          OR: [
            { code: contains },
            { brand: contains },
            { model: contains },
            { size: contains },
            { currentLocation: contains },
          ],
        },
      }),
    );
  });

  it('serijalizuje datum i vozilo aktivne montaže po API ugovoru', async () => {
    const { svc } = setup();
    const result = await svc.listSets(tireSetListQuerySchema.parse({}));
    expect(tireSetViewSchema.parse(result.items[0])).toMatchObject({
      purchaseDate: '2026-01-15',
      mountedVehicleId: vehicleId,
      mountedVehicleInternalNo: 'V-001',
      mountedVehiclePlateNumber: 'A01-K-001',
    });
    expect(result).toMatchObject({ total: 30, totalPages: 2 });
  });

  it('nepoznat sort ne ide u bazu; prazna lista ima nula stranica', async () => {
    const { svc, tireSet } = setup();
    tireSet.count.mockResolvedValue(0);
    tireSet.findMany.mockResolvedValue([]);
    const result = await svc.listSets(tireSetListQuerySchema.parse({ sortBy: 'nepostojeća' }));
    expect(tireSet.findMany.mock.calls[0]?.[0].orderBy).toEqual([{ code: 'asc' }, { id: 'asc' }]);
    expect(result).toMatchObject({ total: 0, totalPages: 0, items: [] });
  });

  it('kreira komplet na skladištu kroz objavljenu TIRE_SET formu', async () => {
    const { svc, tireSet, input } = setup();
    const result = await svc.createSet(input, actorId);
    const data = tireSet.create.mock.calls[0]?.[0].data;
    expect(data?.purchaseDate).toBeInstanceOf(Date);
    expect(data).toMatchObject({
      code: 'G-Z-001',
      season: 'WINTER',
      tireCount: 4,
      purchasePrice: 60000,
      status: 'IN_STOCK',
      formSchemaId,
      formSchemaVersionId: formVersionId,
      createdById: actorId,
      formData: { supplier: 'Izmišljeni dobavljač', invoiceNumber: 'F-001' },
    });
    expect(result.data).toMatchObject({
      status: 'IN_STOCK',
      mountedVehicleId: null,
      formSchemaVersionId: formVersionId,
    });
    expect(result.after).toEqual(result.data);
  });

  it('postojeći aktivni kod odbija unos prije kreiranja', async () => {
    const { svc, tireSet, input } = setup();
    tireSet.findFirst.mockResolvedValue({ id: actorId });
    await expect(svc.createSet(input)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
    expect(tireSet.create).not.toHaveBeenCalled();
  });

  it('konkurentno kršenje jedinstvenog koda mapira na 409 DUPLICATE_ENTRY', async () => {
    const { svc, tireSet, input } = setup();
    tireSet.create.mockRejectedValue(Object.assign(new Error('P2002'), { code: 'P2002' }));
    await expect(svc.createSet(input)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('povučena forma i budući datum nabavke ne dolaze do upisa', async () => {
    const retired = setup({ versionStatus: 'RETIRED' });
    await expect(retired.svc.createSet(retired.input)).rejects.toMatchObject({
      code: 'FORM_VERSION_NOT_PUBLISHED',
    });
    expect(retired.tireSet.create).not.toHaveBeenCalled();

    const future = setup();
    await expect(future.svc.createSet({ ...future.input, purchaseDate: '2099-01-01' })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
    expect(future.tireSet.findFirst).not.toHaveBeenCalled();
    expect(future.tireSet.create).not.toHaveBeenCalled();
  });

  it('dodatna polja forme se stvarno validiraju', async () => {
    const { svc, tireSet, input } = setup();
    await expect(svc.createSet({ ...input, formData: { supplier: 'x'.repeat(121) } })).rejects.toMatchObject({
      code: 'FORM_VALIDATION_FAILED',
    });
    expect(tireSet.findFirst).not.toHaveBeenCalled();
    expect(tireSet.create).not.toHaveBeenCalled();
  });

  it('DTO odbija prazan kod, broj guma izvan opsega, negativnu cijenu i status iz zahtjeva', () => {
    const { input } = setup();
    for (const patch of [
      { code: '  ' },
      { season: 'PROLJETNE' },
      { tireCount: 0 },
      { tireCount: 9 },
      { tireCount: 1.5 },
      { purchasePrice: -1 },
      { purchasePrice: 2147483648 },
      { status: 'MOUNTED' },
    ]) {
      expect(createTireSetSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
    expect(tireSetListQuerySchema.safeParse({ availableOnly: 'yes' }).success).toBe(false);
  });

  it('kontroler razdvaja pregled i unos po permisijama i auditu', () => {
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', TireSetsController.prototype.listSets).permissions,
    ).toEqual(['tire:view']);
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', TireSetsController.prototype.createSet).permissions,
    ).toEqual(['tire:create']);
    expect(Reflect.getMetadata('vfm:audit', TireSetsController.prototype.createSet)).toMatchObject({
      action: 'CREATE',
      resource: 'TireSet',
    });
  });
});

describe('P14 — tire-set scope through HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const scenarioActor = (scenario: 'ASSIGNED' | 'UNASSIGNED' | 'NO_VIEW'): AuthenticatedUser => {
    const grants: readonly PermissionGrant[] =
      scenario === 'NO_VIEW'
        ? []
        : [
            {
              permission: 'tire:view',
              scope: 'VEHICLE_IDS',
              scopeVehicleIds: [scenario === 'ASSIGNED' ? vehicleId : otherVehicleId],
            },
          ];
    return {
      id: `p14-tire-${scenario.toLowerCase()}`,
      roles: ['CUSTOM'],
      roleIds: [],
      clientType: 'WEB',
      sessionId: 'p14-tire-session',
      jti: 'p14-tire-token',
      tokenVersion: 1,
      permissionsVersion: 0,
      isSuperAdmin: false,
      mustChangePassword: false,
      status: 'ACTIVE',
      allowedClientTypes: ['WEB'],
      permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
    };
  };

  beforeAll(async () => {
    const { svc, tireSet, prisma, row } = setup();
    tireSet.findFirst.mockResolvedValue({ ...row, formData: {}, createdById: null });
    Object.assign(prisma, {
      tireInstallation: {
        findFirst: vi.fn(async ({ where }: { where: { vehicleId: { in?: readonly string[] } } }) =>
          where.vehicleId.in?.includes(vehicleId) ? { id: actorId } : null,
        ),
      },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [TireSetsController],
      providers: [
        Reflector,
        PermissionsGuard,
        { provide: TiresService, useValue: svc },
        {
          provide: PermissionsService,
          useValue: {
            snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
            currentPermissionsVersion: vi.fn(async () => 0),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser },
        _response: unknown,
        next: () => void,
      ) => {
        const rawScenario = request.headers['x-sweep-role'];
        const scenario = Array.isArray(rawScenario) ? rawScenario[0] : rawScenario;
        if (scenario) request.user = scenarioActor(scenario as 'ASSIGNED' | 'UNASSIGNED' | 'NO_VIEW');
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('dodijeljeni tire:view VEHICLE_IDS korisnik vidi komplet, a drugi dobija scope denial', async () => {
    const assigned = await fetch(`${baseUrl}/tire-sets/55555555-5555-4555-8555-555555555555`, {
      headers: { 'x-sweep-role': 'ASSIGNED' },
    });
    expect(assigned.status).toBe(200);

    const unassigned = await fetch(`${baseUrl}/tire-sets/55555555-5555-4555-8555-555555555555`, {
      headers: { 'x-sweep-role': 'UNASSIGNED' },
    });
    expect(unassigned.status).toBe(403);
    expect(((await unassigned.json()) as { error: { code: string } }).error.code).toBe('SCOPE_DENIED');
  });

  it('bez tire:view endpoint odbija zahtjev na guardu', async () => {
    const response = await fetch(`${baseUrl}/tire-sets/55555555-5555-4555-8555-555555555555`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
  });
});
