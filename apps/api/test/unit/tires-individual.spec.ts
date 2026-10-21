/** Pojedinačne gume kompleta — lista, transakcijski unos i izvedeni status. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { createTireSchema, tireViewSchema } from '@vfm/shared/schemas';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { TiresService } from '../../src/modules/tires/tires.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

const setId = '22222222-2222-4222-8222-222222222222';
const otherSetId = '33333333-3333-4333-8333-333333333333';

type UnknownRecord = Record<string, unknown>;

interface DecimalLike {
  toNumber: () => number;
  toString: () => string;
}

interface TireState {
  id: string;
  setId: string | null;
  serialNumber: string | null;
  dot: string | null;
  productionWeek: number | null;
  productionYear: number | null;
  position: string | null;
  treadDepthMm: DecimalLike | null;
  status: string;
  purchaseDate: Date | null;
  purchasePrice: number | null;
  notes: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

function decimal(value: number): DecimalLike {
  return { toNumber: () => value, toString: () => value.toFixed(1) };
}

let tireSequence = 0;
function makeTire(overrides: Partial<TireState> = {}): TireState {
  tireSequence += 1;
  return {
    id: `44444444-4444-4444-8444-${String(tireSequence).padStart(12, '0')}`,
    setId,
    serialNumber: null,
    dot: null,
    productionWeek: null,
    productionYear: null,
    position: null,
    treadDepthMm: null,
    status: 'IN_STOCK',
    purchaseDate: null,
    purchasePrice: null,
    notes: null,
    createdAt: new Date(`2026-01-${String(Math.min(tireSequence, 28)).padStart(2, '0')}T00:00:00Z`),
    deletedAt: null,
    ...overrides,
  };
}

function setup({
  status = 'IN_STOCK',
  tireCount = 4,
  deleted = false,
  activePositions = null,
  tires = [],
}: {
  status?: string;
  tireCount?: number;
  deleted?: boolean;
  activePositions?: string[] | null;
  tires?: TireState[];
} = {}) {
  const calls: string[] = [];
  const set = {
    id: setId,
    code: 'G-Z-001',
    tireCount,
    status,
    version: 2,
    deletedAt: deleted ? new Date('2026-01-01T00:00:00Z') : null,
  };
  const tireRows = [...tires];

  const tx = {
    $queryRaw: vi.fn(async () => {
      calls.push(`lock:TireSet:${setId}`);
      return [{ id: set.id, status: set.status, version: set.version, deletedAt: set.deletedAt }];
    }),
    tireSet: {
      findFirst: vi.fn(async (args: { where?: UnknownRecord }) => {
        if (args.where?.id !== setId || set.deletedAt !== null) return null;
        return { ...set };
      }),
    },
    tireInstallation: {
      findFirst: vi.fn(async () => (activePositions ? { positions: [...activePositions] } : null)),
    },
    tire: {
      count: vi.fn(
        async (args: { where?: UnknownRecord }) =>
          tireRows.filter((row) => row.setId === args.where?.setId && row.deletedAt === null).length,
      ),
      findFirst: vi.fn(async (args: { where?: UnknownRecord }) => {
        const row = tireRows.find(
          (item) =>
            item.setId === args.where?.setId &&
            item.position === args.where?.position &&
            item.deletedAt === null,
        );
        return row ? { id: row.id } : null;
      }),
      findMany: vi.fn(async (args: { where?: UnknownRecord }) =>
        tireRows
          .filter((row) => row.setId === args.where?.setId && row.deletedAt === null)
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
          )
          .map((row) => ({ ...row })),
      ),
      create: vi.fn(async (args: { data: UnknownRecord }) => {
        calls.push('create-tire');
        const data = args.data;
        const tread = data.treadDepthMm;
        const row: TireState = {
          id: String(data.id),
          setId: typeof data.setId === 'string' ? data.setId : null,
          serialNumber: typeof data.serialNumber === 'string' ? data.serialNumber : null,
          dot: typeof data.dot === 'string' ? data.dot : null,
          productionWeek: typeof data.productionWeek === 'number' ? data.productionWeek : null,
          productionYear: typeof data.productionYear === 'number' ? data.productionYear : null,
          position: typeof data.position === 'string' ? data.position : null,
          treadDepthMm: tread === null || tread === undefined ? null : decimal(Number(tread)),
          status: String(data.status),
          purchaseDate: data.purchaseDate instanceof Date ? data.purchaseDate : null,
          purchasePrice: typeof data.purchasePrice === 'number' ? data.purchasePrice : null,
          notes: typeof data.notes === 'string' ? data.notes : null,
          createdAt: new Date(Date.UTC(2026, 1, tireRows.length + 1)),
          deletedAt: null,
        };
        tireRows.push(row);
        return { ...row };
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const svc = new TiresService(prisma as unknown as PrismaService);
  const input = createTireSchema.parse({
    serialNumber: 'SN-001',
    dot: 'DOT-1225',
    productionWeek: 12,
    productionYear: 2025,
    position: 'FL',
    treadDepthTenthsMm: 75,
    purchaseDate: '2025-10-01',
    purchasePrice: 15000,
    notes: 'Nova guma',
  });

  return { svc, tx, prisma, calls, set, tireRows, input };
}

describe('Pojedinačne gume kompleta', () => {
  it('lista isključuje obrisane i tuđe gume te sortira po kanonskoj poziciji', async () => {
    tireSequence = 0;
    const rearRight = makeTire({ position: 'RR', treadDepthMm: decimal(7.5) });
    const withoutPosition = makeTire({ serialNumber: 'BEZ-POZICIJE' });
    const frontLeft = makeTire({ position: 'FL' });
    const spare = makeTire({ position: 'SPARE' });
    const deletedTire = makeTire({ position: 'FR', deletedAt: new Date() });
    const otherSetTire = makeTire({ setId: otherSetId, position: 'FR' });
    const state = setup({
      tires: [rearRight, withoutPosition, frontLeft, spare, deletedTire, otherSetTire],
    });

    const result = await state.svc.listTires(setId);

    expect(result.items.map((item) => item.id)).toEqual([
      frontLeft.id,
      rearRight.id,
      spare.id,
      withoutPosition.id,
    ]);
    expect(tireViewSchema.parse(result.items[1])).toMatchObject({
      position: 'RR',
      treadDepthTenthsMm: 75,
    });
  });

  it('lista za obrisan ili nepostojeći komplet vraća 404 bez čitanja guma', async () => {
    const state = setup({ deleted: true });
    await expect(state.svc.listTires(setId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(state.tx.tire.findMany).not.toHaveBeenCalled();
  });

  it('unos zaključava komplet, nasljeđuje status i tačno pretvara dubinu profila', async () => {
    const state = setup({ status: 'IN_REPAIR' });
    const result = await state.svc.createTire(setId, state.input);

    expect(state.calls[0]).toBe(`lock:TireSet:${setId}`);
    expect(result.setCode).toBe('G-Z-001');
    expect(tireViewSchema.parse(result.data)).toMatchObject({
      setId,
      serialNumber: 'SN-001',
      position: 'FL',
      treadDepthTenthsMm: 75,
      status: 'IN_REPAIR',
      purchaseDate: '2025-10-01',
      purchasePrice: 15000,
    });
    expect(state.tireRows[0]?.treadDepthMm?.toNumber()).toBe(7.5);
    expect(state.tireRows[0]?.purchaseDate).toBeInstanceOf(Date);
  });

  it('u montiranom kompletu samo aktivna pozicija dobija status MOUNTED', async () => {
    const state = setup({ status: 'MOUNTED', activePositions: ['FL', 'FR'] });

    const mounted = await state.svc.createTire(setId, state.input);
    const spare = await state.svc.createTire(setId, { position: 'SPARE', serialNumber: 'REZERVA' });

    expect(mounted.data.status).toBe('MOUNTED');
    expect(spare.data.status).toBe('IN_STOCK');
  });

  it('nekonzistentan MOUNTED komplet bez aktivne montaže novu gumu vodi kao skladišnu', async () => {
    const state = setup({ status: 'MOUNTED' });
    await expect(state.svc.createTire(setId, state.input)).resolves.toMatchObject({
      data: { status: 'IN_STOCK' },
    });
  });

  it('deklarisani broj guma kompleta je gornja granica pojedinačne evidencije', async () => {
    tireSequence = 0;
    const state = setup({ tireCount: 2, tires: [makeTire(), makeTire()] });

    await expect(state.svc.createTire(setId, state.input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(state.tx.tire.create).not.toHaveBeenCalled();
  });

  it('zauzeta pozicija i konkurentno P2002 vraćaju DUPLICATE_ENTRY', async () => {
    tireSequence = 0;
    const duplicate = setup({ tires: [makeTire({ position: 'FL' })] });
    await expect(duplicate.svc.createTire(setId, duplicate.input)).rejects.toMatchObject({
      code: 'DUPLICATE_ENTRY',
    });
    expect(duplicate.tx.tire.create).not.toHaveBeenCalled();

    const race = setup();
    race.tx.tire.create.mockRejectedValueOnce(Object.assign(new Error('P2002'), { code: 'P2002' }));
    await expect(race.svc.createTire(setId, race.input)).rejects.toMatchObject({
      code: 'DUPLICATE_ENTRY',
    });
  });

  it('budući datum nabavke odbija prije otvaranja transakcije', async () => {
    const state = setup();
    await expect(
      state.svc.createTire(setId, { ...state.input, purchaseDate: '2099-01-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(state.prisma.$transaction).not.toHaveBeenCalled();
    expect(state.tx.tire.create).not.toHaveBeenCalled();
  });

  it('DTO odbija prazan zapis, ručni status i vrijednosti izvan opsega', () => {
    for (const input of [
      {},
      { serialNumber: '   ' },
      { serialNumber: null },
      { status: 'IN_STOCK' },
      { setId, serialNumber: 'SN' },
      { formData: {}, serialNumber: 'SN' },
      { productionWeek: 54 },
      { productionYear: 1899 },
      { treadDepthTenthsMm: 10000 },
      { treadDepthTenthsMm: 7.5 },
      { purchasePrice: -1 },
      { productionYear: 2026, purchaseDate: '2025-12-31' },
    ]) {
      expect(createTireSchema.safeParse(input).success).toBe(false);
    }
    expect(createTireSchema.safeParse({ position: 'SPARE' }).success).toBe(true);
    expect(createTireSchema.safeParse({ treadDepthTenthsMm: 0 }).success).toBe(true);
  });

  it('kontroler koristi tire:view/create i audit CREATE na Tire resursu', () => {
    const permissions = (method: unknown) =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;
    expect(permissions(TireSetsController.prototype.listTires)).toEqual(['tire:view']);
    expect(permissions(TireSetsController.prototype.createTire)).toEqual(['tire:create']);
    expect(Reflect.getMetadata('vfm:audit', TireSetsController.prototype.createTire)).toMatchObject({
      action: 'CREATE',
      severity: 'INFO',
      resource: 'Tire',
    });
  });
});
