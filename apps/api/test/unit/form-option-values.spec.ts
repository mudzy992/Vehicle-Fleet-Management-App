import { describe, expect, it, vi } from 'vitest';
import { parseDefinition } from '@vfm/form-engine';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { resolveFormOptionValues } from '../../src/common/form-option-values.js';

const VEHICLE_ID = '018f0000-0000-7000-8000-0000000000a1';
const DRIVER_ID = '018f0000-0000-7000-8000-0000000000a2';
const TASK_TYPE_ID = '018f0000-0000-7000-8000-0000000000a3';
const TIRE_SET_ID = '018f0000-0000-7000-8000-0000000000a4';
const VEHICLE_FOR_TIRES = '018f0000-0000-7000-8000-0000000000a5';

function dynamicDefinition() {
  const parsed = parseDefinition({
    $schema: 'vfm-form/1',
    meta: { title: 'Dinamičke opcije', subject: 'TASK' },
    sections: [
      {
        key: 'izbori',
        title: 'Izbori',
        order: 1,
        fields: [
          {
            key: 'vehicle',
            type: 'DROPDOWN',
            label: 'Vozilo',
            order: 1,
            optionsSource: { kind: 'QUERY', queryId: 'ACTIVE_VEHICLES' },
          },
          {
            key: 'driver',
            type: 'DROPDOWN',
            label: 'Vozač',
            order: 2,
            optionsSource: { kind: 'QUERY', queryId: 'ACTIVE_DRIVERS' },
          },
          {
            key: 'taskType',
            type: 'DROPDOWN',
            label: 'Vrsta',
            order: 3,
            optionsSource: { kind: 'QUERY', queryId: 'OPEN_TASK_TYPES' },
          },
          {
            key: 'workshop',
            type: 'DROPDOWN',
            label: 'Radionica',
            order: 4,
            optionsSource: { kind: 'QUERY', queryId: 'WORKSHOPS' },
          },
          {
            key: 'tireSet',
            type: 'DROPDOWN',
            label: 'Gume',
            order: 5,
            optionsSource: {
              kind: 'QUERY',
              queryId: 'TIRE_SETS_BY_VEHICLE',
              params: { vehicleId: VEHICLE_FOR_TIRES },
            },
          },
          {
            key: 'listChoice',
            type: 'DROPDOWN',
            label: 'Šifarnik',
            order: 6,
            optionsSource: { kind: 'LIST', listCode: 'FUEL_TYPE' },
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}

describe('resolveFormOptionValues', () => {
  it('razrješava samo fiksne QUERY identifikatore i aktivne LIST vrijednosti', async () => {
    const tireInstallationFindMany = vi.fn(async (args: { select: { id?: true; setId?: true } }) =>
      args.select.setId ? [{ setId: TIRE_SET_ID }] : [],
    );
    const prisma = {
      vehicle: { findMany: vi.fn(async () => [{ id: VEHICLE_ID }]) },
      driver: { findMany: vi.fn(async () => [{ id: DRIVER_ID }]) },
      taskType: { findMany: vi.fn(async () => [{ id: TASK_TYPE_ID }]) },
      task: { findMany: vi.fn(async () => []) },
      registrationRecord: { findMany: vi.fn(async () => []) },
      insuranceRecord: { findMany: vi.fn(async () => []) },
      serviceRecord: { findMany: vi.fn(async () => []) },
      tireSet: { findMany: vi.fn(async () => [{ id: TIRE_SET_ID }]) },
      tireInstallation: { findMany: tireInstallationFindMany },
      list: {
        findUnique: vi.fn(async ({ where }: { where: { code: string } }) => ({
          items: [{ code: `${where.code}-1`, label: `${where.code} prva` }],
        })),
      },
    } as unknown as PrismaService;

    const values = await resolveFormOptionValues(prisma, dynamicDefinition());

    expect(values.get('vehicle')).toEqual(new Set([VEHICLE_ID]));
    expect(values.get('driver')).toEqual(new Set([DRIVER_ID]));
    expect(values.get('taskType')).toEqual(new Set([TASK_TYPE_ID]));
    expect(values.get('workshop')).toEqual(new Set(['WORKSHOP-1']));
    expect(values.get('tireSet')).toEqual(new Set([TIRE_SET_ID]));
    expect(values.get('listChoice')).toEqual(new Set(['FUEL_TYPE-1']));
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.taskType.findMany).toHaveBeenCalledWith({
      where: { active: true, deletedAt: null },
      select: { id: true },
    });
    expect(tireInstallationFindMany).toHaveBeenCalledWith({
      where: { vehicleId: VEHICLE_FOR_TIRES, dismountedAt: null, deletedAt: null },
      select: { setId: true },
    });
  });
});
