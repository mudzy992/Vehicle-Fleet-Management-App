/** Montaže guma — zaključavanje, jedinstvena aktivna montaža, km i zamjena. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import {
  dismountTireSetSchema,
  mountTireSetSchema,
  swapTireSetSchema,
  tireInstallationViewSchema,
  tireSwapResponseSchema,
} from '@vfm/shared/schemas';
import { TireInstallationsController } from '../../src/modules/tires/tire-installations.controller.js';
import { TireInstallationsService } from '../../src/modules/tires/tire-installations.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const vehicleId = '22222222-2222-4222-8222-222222222222';
const otherVehicleId = '33333333-3333-4333-8333-333333333333';
const newSetId = '44444444-4444-4444-8444-444444444444';
const oldSetId = '55555555-5555-4555-8555-555555555555';
const conflictSetId = '66666666-6666-4666-8666-666666666666';
const oldInstallationId = '77777777-7777-4777-8777-777777777777';
const formSchemaId = '88888888-8888-4888-8888-888888888888';
const formVersionId = '99999999-9999-4999-8999-999999999999';

function scopeActor(
  permission: string,
  scope: 'ALL' | 'OWN' | 'VEHICLE_IDS',
  scopeVehicleIds: string[] = [],
): AuthenticatedUser {
  return {
    id: actorId,
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeVehicleIds }],
    },
  } as unknown as AuthenticatedUser;
}

type UnknownRecord = Record<string, unknown>;

interface VehicleState {
  id: string;
  internalNo: string;
  plateNumber: string | null;
  odometerKm: number;
  odometerUpdatedAt?: Date;
  status: string;
  version: number;
  deletedAt: Date | null;
  createdById: string | null;
}

interface SetState {
  id: string;
  code: string;
  brand: string | null;
  model: string | null;
  size: string | null;
  season: string;
  tireCount: number;
  purchaseDate: Date | null;
  purchasePrice: number | null;
  currency: string;
  status: string;
  currentLocation: string | null;
  notes: string | null;
  version: number;
  deletedAt: Date | null;
}

interface InstallationState {
  id: string;
  setId: string;
  vehicleId: string;
  mountedAt: Date;
  mountedOdometerKm: number;
  dismountedAt: Date | null;
  dismountedOdometerKm: number | null;
  reason: string | null;
  positions: string[];
  storageLocationOnDismount: string | null;
  daysInUse: number | null;
  kmDriven: number | null;
  formSchemaId: string | null;
  formSchemaVersionId: string | null;
  formData: UnknownRecord;
  version: number;
  createdById: string | null;
  deletedAt: Date | null;
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: vehicleId,
    internalNo: 'V-001',
    plateNumber: 'A01-K-001',
    odometerKm: 1000,
    status: 'ACTIVE',
    version: 3,
    deletedAt: null,
    createdById: null,
    ...overrides,
  };
}

function makeSet(overrides: Partial<SetState> = {}): SetState {
  return {
    id: oldSetId,
    code: 'G-L-001',
    brand: 'Izmišljena marka',
    model: 'Ljetna proba',
    size: '205/55 R16',
    season: 'SUMMER',
    tireCount: 4,
    purchaseDate: new Date('2025-01-01T00:00:00Z'),
    purchasePrice: 50000,
    currency: 'BAM',
    status: 'IN_STOCK',
    currentLocation: 'Skladište A',
    notes: null,
    version: 2,
    deletedAt: null,
    ...overrides,
  };
}

function makeInstallation(overrides: Partial<InstallationState> = {}): InstallationState {
  return {
    id: oldInstallationId,
    setId: oldSetId,
    vehicleId,
    mountedAt: new Date('2026-01-01T00:00:00Z'),
    mountedOdometerKm: 900,
    dismountedAt: null,
    dismountedOdometerKm: null,
    reason: null,
    positions: ['FL', 'FR', 'RL', 'RR'],
    storageLocationOnDismount: null,
    daysInUse: null,
    kmDriven: null,
    formSchemaId,
    formSchemaVersionId: formVersionId,
    formData: {
      mountedAt: '2026-01-01',
      mountedOdometerKm: 900,
      workshopName: 'Izmišljena radionica',
    },
    version: 4,
    createdById: actorId,
    deletedAt: null,
    ...overrides,
  };
}

function setup({
  withOld = false,
  oldVehicleId = vehicleId,
  versionStatus = 'PUBLISHED',
}: { withOld?: boolean; oldVehicleId?: string; versionStatus?: string } = {}) {
  const calls: string[] = [];
  const vehicles = new Map<string, VehicleState>([
    [vehicleId, makeVehicle()],
    [
      otherVehicleId,
      makeVehicle({
        id: otherVehicleId,
        internalNo: 'V-002',
        plateNumber: 'A01-K-002',
        odometerKm: 500,
        version: 1,
      }),
    ],
  ]);
  const sets = new Map<string, SetState>([
    [oldSetId, makeSet({ status: withOld ? 'MOUNTED' : 'IN_STOCK' })],
    [
      newSetId,
      makeSet({
        id: newSetId,
        code: 'G-Z-001',
        model: 'Zimska proba',
        season: 'WINTER',
        version: 5,
      }),
    ],
    [conflictSetId, makeSet({ id: conflictSetId, code: 'G-X-001', status: 'MOUNTED', version: 1 })],
  ]);
  const installations = new Map<string, InstallationState>();
  if (withOld) installations.set(oldInstallationId, makeInstallation({ vehicleId: oldVehicleId }));

  const odometerReadings: UnknownRecord[] = [];
  const outboxEvents: UnknownRecord[] = [];

  const withSet = (row: InstallationState) => {
    const set = sets.get(row.setId)!;
    return {
      ...clone(row),
      set: {
        code: set.code,
        brand: set.brand,
        model: set.model,
        size: set.size,
        season: set.season,
      },
    };
  };

  const matches = (row: InstallationState, whereValue: unknown): boolean => {
    const where = asRecord(whereValue);
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    const idFilter = asRecord(where.id);
    if (typeof idFilter.not === 'string' && row.id === idFilter.not) return false;
    if (typeof where.setId === 'string' && row.setId !== where.setId) return false;
    if (typeof where.vehicleId === 'string' && row.vehicleId !== where.vehicleId) return false;
    if ('deletedAt' in where && row.deletedAt !== where.deletedAt) return false;
    if ('dismountedAt' in where) {
      const filter = where.dismountedAt;
      if (filter === null && row.dismountedAt !== null) return false;
      const record = asRecord(filter);
      if ('not' in record && record.not === null && row.dismountedAt === null) return false;
      if (record.gt instanceof Date && (!row.dismountedAt || row.dismountedAt <= record.gt)) return false;
    }
    const positions = asRecord(where.positions);
    if (Array.isArray(positions.hasSome)) {
      if (!positions.hasSome.some((position) => row.positions.includes(String(position)))) return false;
    }
    if (Array.isArray(where.OR) && !where.OR.some((condition) => matches(row, condition))) return false;
    return true;
  };

  const applyData = (row: { version: number }, dataValue: unknown) => {
    const data = asRecord(dataValue);
    for (const [key, value] of Object.entries(data)) {
      if (key === 'version') {
        const increment = asRecord(value).increment;
        row.version += typeof increment === 'number' ? increment : 0;
      } else {
        (row as unknown as UnknownRecord)[key] = value;
      }
    }
  };

  const tireInstallation = {
    count: vi.fn(
      async (args: { where?: unknown }) =>
        [...installations.values()].filter((row) => matches(row, args.where)).length,
    ),
    findFirst: vi.fn(
      async (args: { where?: unknown; select?: UnknownRecord; include?: unknown; orderBy?: unknown }) => {
        let rows = [...installations.values()].filter((row) => matches(row, args.where));
        if (args.orderBy) {
          rows = rows.sort((a, b) => (b.dismountedAt?.getTime() ?? 0) - (a.dismountedAt?.getTime() ?? 0));
        }
        const row = rows[0];
        if (!row) return null;
        if (args.include) return withSet(row);
        if (args.select?.vehicle) {
          const vehicle = vehicles.get(row.vehicleId)!;
          return {
            id: row.id,
            vehicleId: row.vehicleId,
            vehicle: { internalNo: vehicle.internalNo, plateNumber: vehicle.plateNumber },
          };
        }
        if (args.select) {
          const picked: UnknownRecord = {};
          for (const [key, enabled] of Object.entries(args.select)) {
            if (enabled === true) picked[key] = clone((row as unknown as UnknownRecord)[key]);
          }
          return picked;
        }
        return clone(row);
      },
    ),
    findMany: vi.fn(async (args: { where?: unknown }) =>
      [...installations.values()]
        .filter((row) => matches(row, args.where))
        .map((row) => ({
          id: row.id,
          setId: row.setId,
          positions: [...row.positions],
          dismountedAt: row.dismountedAt,
          set: { code: sets.get(row.setId)!.code },
        })),
    ),
    create: vi.fn(async (args: { data: UnknownRecord }) => {
      calls.push('create-installation');
      const row = {
        dismountedAt: null,
        dismountedOdometerKm: null,
        reason: null,
        storageLocationOnDismount: null,
        daysInUse: null,
        kmDriven: null,
        version: 0,
        deletedAt: null,
        ...(args.data as Partial<InstallationState>),
      } as InstallationState;
      installations.set(row.id, clone(row));
      return withSet(row);
    }),
    updateMany: vi.fn(async (args: { where: UnknownRecord; data: UnknownRecord }) => {
      calls.push('dismount-installation');
      const row = installations.get(String(args.where.id));
      if (
        !row ||
        row.version !== args.where.version ||
        row.dismountedAt !== args.where.dismountedAt ||
        row.deletedAt !== args.where.deletedAt
      ) {
        return { count: 0 };
      }
      applyData(row, args.data);
      return { count: 1 };
    }),
  };

  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      const id = String(values[0]);
      if (sql.includes('"Vehicle"')) {
        calls.push(`lock:Vehicle:${id}`);
        const row = vehicles.get(id);
        return row ? [clone(row)] : [];
      }
      calls.push(`lock:TireSet:${id}`);
      const row = sets.get(id);
      return row ? [clone(row)] : [];
    }),
    tireInstallation,
    tireSet: {
      updateMany: vi.fn(async (args: { where: UnknownRecord; data: UnknownRecord }) => {
        calls.push('update-set');
        const row = sets.get(String(args.where.id));
        if (!row || row.version !== args.where.version) return { count: 0 };
        if (typeof args.where.status === 'string' && row.status !== args.where.status) return { count: 0 };
        if ('deletedAt' in args.where && row.deletedAt !== args.where.deletedAt) return { count: 0 };
        applyData(row, args.data);
        return { count: 1 };
      }),
    },
    tire: { updateMany: vi.fn(async () => ({ count: 0 })) },
    vehicle: {
      update: vi.fn(async (args: { where: { id: string }; data: UnknownRecord }) => {
        calls.push('update-vehicle');
        const row = vehicles.get(args.where.id)!;
        applyData(row, args.data);
        return clone(row);
      }),
    },
    odometerReading: {
      create: vi.fn(async (args: { data: UnknownRecord }) => {
        calls.push('odometer');
        odometerReadings.push(clone(args.data));
        return args.data;
      }),
    },
    outboxEvent: {
      create: vi.fn(async (args: { data: UnknownRecord }) => {
        calls.push('outbox');
        outboxEvents.push(clone(args.data));
        return args.data;
      }),
    },
    formSchema: {
      findFirst: vi.fn().mockResolvedValue({ currentPublishedVersionId: formVersionId }),
    },
    formSchemaVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id: formVersionId,
        formSchemaId,
        version: 1,
        status: versionStatus,
        formSchema: { subject: 'TIRE_INSTALLATION' },
        definition: SEED_FORMS.find((form) => form.subject === 'TIRE_INSTALLATION')!.definition,
      }),
    },
  };

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const svc = new TireInstallationsService(prisma as unknown as PrismaService);

  const mountInput = mountTireSetSchema.parse({
    setId: oldSetId,
    vehicleId,
    mountedAt: '2026-01-15',
    mountedOdometerKm: 1500,
    positions: ['FL', 'FR', 'RL', 'RR'],
    formData: { workshopName: 'Izmišljena radionica' },
  });
  const dismountInput = dismountTireSetSchema.parse({
    version: 4,
    dismountedAt: '2026-01-31',
    dismountedOdometerKm: 1500,
    reason: 'SEASONAL_SWAP',
    storageLocationOnDismount: 'Regala 3',
  });
  const swapInput = swapTireSetSchema.parse({
    vehicleId,
    currentInstallationId: oldInstallationId,
    currentVersion: 4,
    newSetId,
    swappedAt: '2026-01-31',
    odometerKm: 1500,
    positions: ['FL', 'FR', 'RL', 'RR'],
    storageLocationOnDismount: 'Regala 3',
    formData: { workshopName: 'Izmišljena radionica' },
  });

  return {
    svc,
    tx,
    prisma,
    calls,
    vehicles,
    sets,
    installations,
    odometerReadings,
    outboxEvents,
    mountInput,
    dismountInput,
    swapInput,
    addInstallation: (row: InstallationState) => installations.set(row.id, row),
  };
}

describe('Gume — montaža, demontaža i zamjena', () => {
  it('lista kombinuje query vehicleId sa VEHICLE_IDS scope-om', async () => {
    const state = setup();
    await state.svc.list(
      { page: 1, pageSize: 25, sortOrder: 'desc', vehicleId } as never,
      scopeActor('tire:view', 'VEHICLE_IDS', [otherVehicleId]),
    );
    expect(state.tx.tireInstallation.count).toHaveBeenCalledWith({
      where: {
        AND: [{ deletedAt: null, vehicleId }, { vehicleId: { in: [otherVehicleId] } }],
      },
    });
  });

  it('odbija montažu na vozilo izvan tire:mount scope-a prije upisa', async () => {
    const state = setup();
    await expect(
      state.svc.mount(state.mountInput, actorId, scopeActor('tire:mount', 'VEHICLE_IDS', [otherVehicleId])),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect(state.calls).not.toContain('lock:TireSet:' + oldSetId);
    expect(state.calls).not.toContain('create-installation');
  });

  it('montaža zaključava vozilo pa komplet i u istoj transakciji piše km i outbox', async () => {
    const state = setup();
    const result = await state.svc.mount(state.mountInput, actorId);

    expect(state.calls.slice(0, 2)).toEqual([`lock:Vehicle:${vehicleId}`, `lock:TireSet:${oldSetId}`]);
    expect(tireInstallationViewSchema.parse(result.data)).toMatchObject({
      setCode: 'G-L-001',
      mountedAt: '2026-01-15',
      mountedOdometerKm: 1500,
      dismountedAt: null,
      formSchemaVersionId: formVersionId,
    });
    expect(state.tx.tireInstallation.create.mock.calls[0]?.[0].data.mountedAt).toBeInstanceOf(Date);
    expect(state.sets.get(oldSetId)).toMatchObject({ status: 'MOUNTED', version: 3 });
    expect(state.vehicles.get(vehicleId)).toMatchObject({ odometerKm: 1500, version: 4 });
    expect(state.odometerReadings).toEqual([
      expect.objectContaining({
        vehicleId,
        valueKm: 1500,
        source: 'TIRE',
        referenceType: 'TireInstallation',
        referenceId: result.data.id,
        recordedById: actorId,
      }),
    ]);
    expect(state.outboxEvents).toEqual([
      expect.objectContaining({ eventType: 'TIRE_SET_MOUNTED', aggregateId: result.data.id }),
    ]);
    expect(state.tx.tire.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'MOUNTED' } }),
    );
  });

  it('isti komplet na drugom vozilu vraća vozilo u 409 i ne piše ništa', async () => {
    const state = setup({ withOld: true, oldVehicleId: otherVehicleId });
    await expect(state.svc.mount(state.mountInput, actorId)).rejects.toMatchObject({
      code: 'TIRE_ALREADY_MOUNTED',
      extra: expect.objectContaining({ mountedVehicleInternalNo: 'V-002' }),
    });
    expect(state.tx.tireInstallation.create).not.toHaveBeenCalled();
    expect(state.odometerReadings).toEqual([]);
    expect(state.outboxEvents).toEqual([]);
  });

  it('zauzeta pozicija drugog kompleta sprječava montažu', async () => {
    const state = setup();
    state.addInstallation(
      makeInstallation({
        id: '12121212-1212-4121-8121-121212121212',
        setId: conflictSetId,
        positions: ['FL'],
      }),
    );
    await expect(
      state.svc.mount({ ...state.mountInput, setId: newSetId, positions: ['FL'] }, actorId),
    ).rejects.toMatchObject({
      code: 'TIRE_ALREADY_MOUNTED',
      extra: expect.objectContaining({ conflictingSetCode: 'G-X-001', position: 'FL' }),
    });
    expect(state.tx.tireInstallation.create).not.toHaveBeenCalled();
  });

  it('regresija km i povučena forma ne dolaze do upisa montaže', async () => {
    const regression = setup();
    await expect(
      regression.svc.mount({ ...regression.mountInput, mountedOdometerKm: 999 }, actorId),
    ).rejects.toMatchObject({ code: 'ODOMETER_REGRESSION' });
    expect(regression.tx.tireInstallation.create).not.toHaveBeenCalled();

    const retired = setup({ versionStatus: 'RETIRED' });
    await expect(retired.svc.mount(retired.mountInput, actorId)).rejects.toMatchObject({
      code: 'FORM_VERSION_NOT_PUBLISHED',
    });
    expect(retired.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('partial unique iz baze mapira konkurentnu montažu na TIRE_ALREADY_MOUNTED', async () => {
    const state = setup();
    state.tx.tireInstallation.create.mockRejectedValueOnce(
      Object.assign(new Error('P2002'), { code: 'P2002' }),
    );
    await expect(state.svc.mount(state.mountInput, actorId)).rejects.toMatchObject({
      code: 'TIRE_ALREADY_MOUNTED',
    });
    expect(state.odometerReadings).toEqual([]);
  });

  it('demontaža računa snapshot, oslobađa komplet i ažurira vozilo', async () => {
    const state = setup({ withOld: true });
    const result = await state.svc.dismount(oldInstallationId, state.dismountInput, actorId);

    expect(tireInstallationViewSchema.parse(result.data)).toMatchObject({
      dismountedAt: '2026-01-31',
      dismountedOdometerKm: 1500,
      kmDriven: 600,
      daysInUse: 30,
      version: 5,
    });
    expect(result.before.dismountedAt).toBeNull();
    expect(state.sets.get(oldSetId)).toMatchObject({
      status: 'IN_STOCK',
      currentLocation: 'Regala 3',
      version: 3,
    });
    expect(state.vehicles.get(vehicleId)).toMatchObject({ odometerKm: 1500, version: 4 });
    expect(state.odometerReadings).toHaveLength(1);
    expect(state.outboxEvents).toEqual([
      expect.objectContaining({ eventType: 'TIRE_SET_DISMOUNTED', aggregateId: oldInstallationId }),
    ]);
  });

  it('demontaža poštuje verziju, aktivno stanje, datum i kilometražu montaže', async () => {
    const stale = setup({ withOld: true });
    await expect(
      stale.svc.dismount(oldInstallationId, { ...stale.dismountInput, version: 3 }, actorId),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', extra: { currentVersion: 4 } });

    const invalidDate = setup({ withOld: true });
    await expect(
      invalidDate.svc.dismount(
        oldInstallationId,
        { ...invalidDate.dismountInput, dismountedAt: '2025-12-31' },
        actorId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const regression = setup({ withOld: true });
    await expect(
      regression.svc.dismount(
        oldInstallationId,
        { ...regression.dismountInput, dismountedOdometerKm: 899 },
        actorId,
      ),
    ).rejects.toMatchObject({ code: 'ODOMETER_REGRESSION' });
    expect(regression.tx.tireInstallation.updateMany).not.toHaveBeenCalled();
  });

  it('zamjena demontira stari i montira novi komplet uz jedno očitanje km', async () => {
    const state = setup({ withOld: true });
    const result = await state.svc.swap(state.swapInput, actorId);

    expect(state.calls.slice(0, 3)).toEqual([
      `lock:Vehicle:${vehicleId}`,
      `lock:TireSet:${newSetId}`,
      `lock:TireSet:${oldSetId}`,
    ]);
    expect(tireSwapResponseSchema.parse(result.data)).toMatchObject({
      dismounted: { id: oldInstallationId, kmDriven: 600, daysInUse: 30 },
      mounted: { setId: newSetId, mountedOdometerKm: 1500, dismountedAt: null },
    });
    expect(state.sets.get(oldSetId)).toMatchObject({ status: 'IN_STOCK', currentLocation: 'Regala 3' });
    expect(state.sets.get(newSetId)).toMatchObject({ status: 'MOUNTED', version: 6 });
    expect(state.vehicles.get(vehicleId)).toMatchObject({ odometerKm: 1500, version: 4 });
    expect(state.odometerReadings).toEqual([
      expect.objectContaining({ referenceId: result.data.mounted.id, valueKm: 1500 }),
    ]);
    expect(state.outboxEvents).toEqual([
      expect.objectContaining({ eventType: 'TIRE_SET_SWAPPED', aggregateId: vehicleId }),
    ]);
  });

  it('zamjena validira novi komplet prije demontaže starog', async () => {
    const state = setup({ withOld: true });
    state.addInstallation(
      makeInstallation({
        id: '34343434-3434-4343-8343-343434343434',
        setId: newSetId,
        vehicleId: otherVehicleId,
      }),
    );
    await expect(state.svc.swap(state.swapInput, actorId)).rejects.toMatchObject({
      code: 'TIRE_ALREADY_MOUNTED',
    });
    expect(state.installations.get(oldInstallationId)?.dismountedAt).toBeNull();
    expect(state.tx.tireInstallation.updateMany).not.toHaveBeenCalled();
    expect(state.tx.tireInstallation.create).not.toHaveBeenCalled();
    expect(state.odometerReadings).toEqual([]);
    expect(state.outboxEvents).toEqual([]);
  });

  it('zamjena istim kompletom je validacijska greška bez upisa', async () => {
    const state = setup({ withOld: true });
    await expect(state.svc.swap({ ...state.swapInput, newSetId: oldSetId }, actorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(state.tx.tireInstallation.updateMany).not.toHaveBeenCalled();
    expect(state.tx.tireInstallation.create).not.toHaveBeenCalled();
  });

  it('DTO odbija duplikat pozicija, nepoznat razlog i status iz zahtjeva', () => {
    const state = setup();
    for (const patch of [
      { positions: [] },
      { positions: ['FL', 'FL'] },
      { positions: ['FRONT_LEFT'] },
      { mountedOdometerKm: -1 },
      { status: 'MOUNTED' },
    ]) {
      expect(mountTireSetSchema.safeParse({ ...state.mountInput, ...patch }).success).toBe(false);
    }
    expect(dismountTireSetSchema.safeParse({ ...state.dismountInput, reason: 'NEPOZNAT' }).success).toBe(
      false,
    );
    expect(swapTireSetSchema.safeParse({ ...state.swapInput, currentVersion: -1 }).success).toBe(false);
  });

  it('kontroler razdvaja mount/dismount/swap permisije i audit akcije', () => {
    const permissions = (method: unknown) =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;
    expect(permissions(TireInstallationsController.prototype.mount)).toEqual(['tire:mount']);
    expect(permissions(TireInstallationsController.prototype.dismount)).toEqual(['tire:dismount']);
    expect(permissions(TireInstallationsController.prototype.swap)).toEqual(['tire:swap']);
    expect(Reflect.getMetadata('vfm:audit', TireInstallationsController.prototype.mount)).toMatchObject({
      action: 'CREATE',
      resource: 'TireInstallation',
    });
    expect(Reflect.getMetadata('vfm:audit', TireInstallationsController.prototype.swap)).toMatchObject({
      action: 'UPDATE',
      resource: 'TireInstallation',
    });
  });
});
