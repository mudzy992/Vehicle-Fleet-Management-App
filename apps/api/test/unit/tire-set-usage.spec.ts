/** Usage pregled kompleta — agregati ciklusa po vozilima bez procjene aktivnog ciklusa. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { tireSetUsageSchema } from '@vfm/shared/schemas';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { TiresService } from '../../src/modules/tires/tires.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

const setId = '22222222-2222-4222-8222-222222222222';
const otherSetId = '33333333-3333-4333-8333-333333333333';
const vehicleAId = '44444444-4444-4444-8444-444444444444';
const vehicleBId = '55555555-5555-4555-8555-555555555555';

type UnknownRecord = Record<string, unknown>;

interface UsageRow {
  id: string;
  setId: string;
  vehicleId: string;
  mountedAt: Date;
  mountedOdometerKm: number;
  dismountedAt: Date | null;
  dismountedOdometerKm: number | null;
  positions: string[];
  kmDriven: number | null;
  daysInUse: number | null;
  reason: string | null;
  storageLocationOnDismount: string | null;
  deletedAt: Date | null;
  vehicle: { internalNo: string; plateNumber: string | null };
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

let rowSequence = 0;
function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  rowSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(rowSequence).padStart(12, '0')}`,
    setId,
    vehicleId: vehicleAId,
    mountedAt: dateOnly('2025-01-01'),
    mountedOdometerKm: 100_000,
    dismountedAt: dateOnly('2025-03-01'),
    dismountedOdometerKm: 105_000,
    positions: ['FL', 'FR', 'RL', 'RR'],
    kmDriven: 5_000,
    daysInUse: 59,
    reason: 'SEASONAL_SWAP',
    storageLocationOnDismount: 'Skladište A',
    deletedAt: null,
    vehicle: { internalNo: 'V-001', plateNumber: 'A01-K-001' },
    ...overrides,
  };
}

function defaultRows(): UsageRow[] {
  rowSequence = 0;
  return [
    makeRow({
      mountedAt: dateOnly('2024-11-01'),
      mountedOdometerKm: 90_000,
      dismountedAt: dateOnly('2025-03-01'),
      dismountedOdometerKm: 100_000,
      kmDriven: 10_000,
      daysInUse: 120,
    }),
    makeRow({
      vehicleId: vehicleBId,
      mountedAt: dateOnly('2025-11-01'),
      mountedOdometerKm: 50_000,
      dismountedAt: dateOnly('2026-02-01'),
      dismountedOdometerKm: 56_000,
      kmDriven: 6_000,
      daysInUse: 92,
      vehicle: { internalNo: 'V-002', plateNumber: 'A02-K-002' },
    }),
    makeRow({
      mountedAt: dateOnly('2025-04-01'),
      mountedOdometerKm: 101_000,
      dismountedAt: dateOnly('2025-05-01'),
      dismountedOdometerKm: 103_000,
      kmDriven: null,
      daysInUse: null,
    }),
    makeRow({
      mountedAt: dateOnly('2026-10-01'),
      mountedOdometerKm: 120_000,
      dismountedAt: null,
      dismountedOdometerKm: null,
      positions: ['RR', 'FL'],
      kmDriven: null,
      daysInUse: null,
      reason: null,
      storageLocationOnDismount: null,
    }),
    makeRow({
      mountedAt: dateOnly('2023-01-01'),
      kmDriven: 99_999,
      daysInUse: 999,
      deletedAt: dateOnly('2026-01-01'),
    }),
    makeRow({
      setId: otherSetId,
      mountedAt: dateOnly('2026-01-01'),
      kmDriven: 88_888,
      daysInUse: 888,
    }),
  ];
}

function setup({ deleted = false, rows = defaultRows() }: { deleted?: boolean; rows?: UsageRow[] } = {}) {
  const set = {
    id: setId,
    code: 'G-Z-001',
    brand: 'Izmišljena marka',
    model: 'Zimska proba',
    size: '205/55 R16',
    season: 'WINTER',
    status: 'MOUNTED',
    deletedAt: deleted ? dateOnly('2026-01-01') : null,
  };
  const prisma = {
    tireSet: {
      findFirst: vi.fn(async (args: { where?: UnknownRecord }) =>
        args.where?.id === setId && set.deletedAt === null ? { ...set } : null,
      ),
    },
    tireInstallation: {
      findMany: vi.fn(async (args: { where?: UnknownRecord }) => {
        const where = asRecord(args.where);
        return rows
          .filter((row) => row.setId === where.setId && row.deletedAt === null)
          .sort(
            (left, right) =>
              right.mountedAt.getTime() - left.mountedAt.getTime() || left.id.localeCompare(right.id),
          )
          .map((row) => ({ ...row, positions: [...row.positions], vehicle: { ...row.vehicle } }));
      }),
    },
  };

  return {
    prisma,
    svc: new TiresService(prisma as unknown as PrismaService),
  };
}

describe('Usage pregled kompleta guma', () => {
  it('agregira završene snapshot vrijednosti i grupiše cikluse po vozilima', async () => {
    const { svc } = setup();

    const usage = tireSetUsageSchema.parse(await svc.getSetUsage(setId));

    expect(usage.set).toMatchObject({ id: setId, code: 'G-Z-001', season: 'WINTER' });
    expect(usage.summary).toEqual({
      totalCycles: 4,
      completedCycles: 3,
      activeCycles: 1,
      distinctVehicles: 2,
      totalKmDriven: 16_000,
      totalDaysInUse: 212,
      firstMountedAt: '2024-11-01',
      lastMountedAt: '2026-10-01',
    });
    expect(usage.vehicles).toEqual([
      {
        vehicleId: vehicleAId,
        vehicleInternalNo: 'V-001',
        vehiclePlateNumber: 'A01-K-001',
        totalCycles: 3,
        completedCycles: 2,
        activeCycles: 1,
        totalKmDriven: 10_000,
        totalDaysInUse: 120,
        firstMountedAt: '2024-11-01',
        lastMountedAt: '2026-10-01',
        activeSince: '2026-10-01',
        activePositions: ['FL', 'RR'],
      },
      {
        vehicleId: vehicleBId,
        vehicleInternalNo: 'V-002',
        vehiclePlateNumber: 'A02-K-002',
        totalCycles: 1,
        completedCycles: 1,
        activeCycles: 0,
        totalKmDriven: 6_000,
        totalDaysInUse: 92,
        firstMountedAt: '2025-11-01',
        lastMountedAt: '2025-11-01',
        activeSince: null,
        activePositions: [],
      },
    ]);
  });

  it('cikluse vraća od najnovije montaže, a aktivni brojači ostaju null', async () => {
    const { svc } = setup();
    const usage = await svc.getSetUsage(setId);

    expect(usage.cycles.map((cycle) => cycle.mountedAt)).toEqual([
      '2026-10-01',
      '2025-11-01',
      '2025-04-01',
      '2024-11-01',
    ]);
    expect(usage.cycles[0]).toMatchObject({
      vehicleId: vehicleAId,
      isActive: true,
      kmDriven: null,
      daysInUse: null,
      dismountedAt: null,
    });
    expect(usage.cycles[2]).toMatchObject({
      isActive: false,
      kmDriven: null,
      daysInUse: null,
    });
  });

  it('komplet bez historije vraća nulte agregate i prazne liste', async () => {
    const { svc } = setup({ rows: [] });

    await expect(svc.getSetUsage(setId)).resolves.toMatchObject({
      summary: {
        totalCycles: 0,
        completedCycles: 0,
        activeCycles: 0,
        distinctVehicles: 0,
        totalKmDriven: 0,
        totalDaysInUse: 0,
        firstMountedAt: null,
        lastMountedAt: null,
      },
      vehicles: [],
      cycles: [],
    });
  });

  it('obrisan ili nepostojeći komplet vraća 404 bez čitanja ciklusa', async () => {
    const { svc, prisma } = setup({ deleted: true });

    await expect(svc.getSetUsage(setId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.tireInstallation.findMany).not.toHaveBeenCalled();
  });

  it('vozila s istim km sortira po danima, zadnjoj montaži i internom broju', async () => {
    rowSequence = 0;
    const rows = [
      makeRow({
        vehicleId: vehicleBId,
        mountedAt: dateOnly('2025-01-01'),
        kmDriven: 1_000,
        daysInUse: 30,
        vehicle: { internalNo: 'V-002', plateNumber: null },
      }),
      makeRow({
        mountedAt: dateOnly('2025-02-01'),
        kmDriven: 1_000,
        daysInUse: 30,
      }),
      makeRow({
        vehicleId: '77777777-7777-4777-8777-777777777777',
        mountedAt: dateOnly('2025-03-01'),
        kmDriven: 1_000,
        daysInUse: 10,
        vehicle: { internalNo: 'V-003', plateNumber: null },
      }),
    ];
    const { svc } = setup({ rows });

    const usage = await svc.getSetUsage(setId);
    expect(usage.vehicles.map((vehicle) => vehicle.vehicleInternalNo)).toEqual(['V-001', 'V-002', 'V-003']);
  });

  it('kontroler traži tire:view i pregled nema audit', () => {
    expect(
      Reflect.getMetadata('vfm:requiredPermissions', TireSetsController.prototype.getSetUsage).permissions,
    ).toEqual(['tire:view']);
    expect(Reflect.getMetadata('vfm:audit', TireSetsController.prototype.getSetUsage)).toBeUndefined();
  });
});
