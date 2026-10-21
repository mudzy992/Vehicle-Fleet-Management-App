/** Životni ciklus kompleta — detalj, CAS izmjena, statusi i soft-delete. */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { tireSetDetailSchema, updateTireSetSchema } from '@vfm/shared/schemas';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { TiresService } from '../../src/modules/tires/tires.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const setId = '22222222-2222-4222-8222-222222222222';
const otherSetId = '33333333-3333-4333-8333-333333333333';
const vehicleId = '44444444-4444-4444-8444-444444444444';
const installationId = '55555555-5555-4555-8555-555555555555';
const formSchemaId = '66666666-6666-4666-8666-666666666666';
const formVersionId = '77777777-7777-4777-8777-777777777777';

type UnknownRecord = Record<string, unknown>;

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
  formSchemaId: string | null;
  formSchemaVersionId: string | null;
  formData: UnknownRecord;
  version: number;
  deletedAt: Date | null;
}

interface InstallationState {
  id: string;
  setId: string;
  vehicleId: string;
  mountedAt: Date;
  dismountedAt: Date | null;
  positions: string[];
  deletedAt: Date | null;
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function makeSet(overrides: Partial<SetState> = {}): SetState {
  return {
    id: setId,
    code: 'G-Z-001',
    brand: 'Izmišljena marka',
    model: 'Zimska proba',
    size: '205/55 R16',
    season: 'WINTER',
    tireCount: 4,
    purchaseDate: new Date('2025-10-01T00:00:00Z'),
    purchasePrice: 60000,
    currency: 'BAM',
    status: 'IN_STOCK',
    currentLocation: 'Skladište A',
    notes: null,
    formSchemaId,
    formSchemaVersionId: formVersionId,
    formData: { supplier: 'Stari dobavljač', invoiceNumber: 'F-001' },
    version: 2,
    deletedAt: null,
    ...overrides,
  };
}

function makeInstallation(overrides: Partial<InstallationState> = {}): InstallationState {
  return {
    id: installationId,
    setId,
    vehicleId,
    mountedAt: new Date('2026-01-10T00:00:00Z'),
    dismountedAt: null,
    positions: ['FL', 'FR', 'RL', 'RR'],
    deletedAt: null,
    ...overrides,
  };
}

function setup({
  status,
  withActive = false,
  withHistory = false,
  formSchemaVersionId = formVersionId,
  versionStatus = 'RETIRED',
}: {
  status?: string;
  withActive?: boolean;
  withHistory?: boolean;
  formSchemaVersionId?: string | null;
  versionStatus?: string;
} = {}) {
  const calls: string[] = [];
  const sets = new Map<string, SetState>([
    [
      setId,
      makeSet({
        status: status ?? (withActive ? 'MOUNTED' : 'IN_STOCK'),
        formSchemaId: formSchemaVersionId ? formSchemaId : null,
        formSchemaVersionId,
      }),
    ],
    [otherSetId, makeSet({ id: otherSetId, code: 'G-Z-002', version: 0 })],
  ]);
  const installations: InstallationState[] = [];
  if (withActive) installations.push(makeInstallation());
  if (withHistory) {
    installations.push(
      makeInstallation({
        id: '88888888-8888-4888-8888-888888888888',
        dismountedAt: new Date('2026-03-01T00:00:00Z'),
      }),
    );
  }
  const tires = [
    { setId, status: withActive ? 'MOUNTED' : 'IN_STOCK', deletedAt: null as Date | null },
    { setId, status: withActive ? 'MOUNTED' : 'IN_STOCK', deletedAt: null as Date | null },
  ];

  const detailRow = (row: SetState) => {
    const active = installations.find(
      (item) => item.setId === row.id && item.dismountedAt === null && item.deletedAt === null,
    );
    return {
      ...structuredClone(row),
      installations: active
        ? [
            {
              vehicleId: active.vehicleId,
              vehicle: { internalNo: 'V-001', plateNumber: 'A01-K-001' },
            },
          ]
        : [],
    };
  };

  const applyData = (row: SetState, dataValue: unknown) => {
    const data = asRecord(dataValue);
    for (const [key, value] of Object.entries(data)) {
      if (key === 'version') {
        const increment = asRecord(value).increment;
        row.version += typeof increment === 'number' ? increment : 0;
      } else {
        Object.assign(row, { [key]: value });
      }
    }
  };

  const tx = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const id = String(values[0]);
      calls.push(`lock:TireSet:${id}`);
      const row = sets.get(id);
      return row ? [{ id: row.id, status: row.status, version: row.version, deletedAt: row.deletedAt }] : [];
    }),
    tireSet: {
      findFirst: vi.fn(async (args: { where?: UnknownRecord; select?: UnknownRecord }) => {
        const where = args.where ?? {};
        let row: SetState | undefined;
        if (typeof where.code === 'string') {
          const excluded = asRecord(where.id).not;
          row = [...sets.values()].find(
            (item) => item.code === where.code && item.deletedAt === null && item.id !== excluded,
          );
          return row ? { id: row.id } : null;
        }
        row = typeof where.id === 'string' ? sets.get(where.id) : undefined;
        if (!row || ('deletedAt' in where && row.deletedAt !== where.deletedAt)) return null;
        if (args.select && Object.keys(args.select).length === 1 && args.select.version === true) {
          return { version: row.version };
        }
        if (args.select && Object.keys(args.select).length === 1 && args.select.id === true) {
          return { id: row.id };
        }
        return detailRow(row);
      }),
      updateMany: vi.fn(async (args: { where: UnknownRecord; data: UnknownRecord }) => {
        calls.push('update-set');
        const row = sets.get(String(args.where.id));
        if (!row || row.version !== args.where.version || row.deletedAt !== args.where.deletedAt) {
          return { count: 0 };
        }
        applyData(row, args.data);
        return { count: 1 };
      }),
    },
    tireInstallation: {
      findFirst: vi.fn(async (args: { where?: UnknownRecord; orderBy?: unknown }) => {
        const where = args.where ?? {};
        let rows = installations.filter(
          (row) =>
            row.setId === where.setId &&
            row.deletedAt === null &&
            (!('dismountedAt' in where) ||
              (where.dismountedAt === null ? row.dismountedAt === null : row.dismountedAt !== null)),
        );
        if (args.orderBy) rows = rows.sort((a, b) => a.mountedAt.getTime() - b.mountedAt.getTime());
        const row = rows[0];
        if (!row) return null;
        if (args.orderBy) return { mountedAt: row.mountedAt };
        return {
          id: row.id,
          vehicleId: row.vehicleId,
          positions: [...row.positions],
          vehicle: { internalNo: 'V-001', plateNumber: 'A01-K-001' },
        };
      }),
    },
    tire: {
      count: vi.fn(
        async (args: { where: UnknownRecord }) =>
          tires.filter((tire) => tire.setId === args.where.setId && tire.deletedAt === null).length,
      ),
      updateMany: vi.fn(async (args: { where: UnknownRecord; data: UnknownRecord }) => {
        let count = 0;
        for (const tire of tires) {
          if (tire.setId !== args.where.setId || tire.deletedAt !== null) continue;
          if (typeof args.data.status === 'string') tire.status = args.data.status;
          if (args.data.deletedAt instanceof Date) tire.deletedAt = args.data.deletedAt;
          count += 1;
        }
        return { count };
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
        formSchema: { subject: 'TIRE_SET' },
        definition: SEED_FORMS.find((form) => form.subject === 'TIRE_SET')!.definition,
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const svc = new TiresService(prisma as unknown as PrismaService);
  const updateInput = updateTireSetSchema.parse({
    version: 2,
    code: 'G-Z-101',
    brand: 'Nova marka',
    status: 'IN_REPAIR',
    formData: { supplier: 'Novi dobavljač' },
  });

  return { svc, tx, prisma, calls, sets, installations, tires, updateInput };
}

describe('Kompleti guma — detalj, izmjena i brisanje', () => {
  it('detalj vraća formData i aktivno vozilo; obrisan komplet je 404', async () => {
    const active = setup({ withActive: true });
    const detail = await active.svc.getSet(setId);
    expect(tireSetDetailSchema.parse(detail)).toMatchObject({
      code: 'G-Z-001',
      mountedVehicleId: vehicleId,
      formData: { supplier: 'Stari dobavljač' },
    });

    const deleted = setup();
    deleted.sets.get(setId)!.deletedAt = new Date();
    await expect(deleted.svc.getSet(setId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('izmjena zaključava komplet, koristi zapisnu RETIRED formu i sinhronizuje pojedinačne gume', async () => {
    const state = setup();
    const result = await state.svc.updateSet(setId, state.updateInput);

    expect(state.calls[0]).toBe(`lock:TireSet:${setId}`);
    expect(result.data).toMatchObject({
      code: 'G-Z-101',
      brand: 'Nova marka',
      status: 'IN_REPAIR',
      version: 3,
      formData: { supplier: 'Novi dobavljač', invoiceNumber: 'F-001' },
    });
    expect(result.before).toMatchObject({ code: 'G-Z-001', status: 'IN_STOCK', version: 2 });
    expect(state.tires.every((tire) => tire.status === 'IN_REPAIR')).toBe(true);
    expect(state.sets.get(setId)?.formSchemaVersionId).toBe(formVersionId);
  });

  it('zastarjela verzija, dupli kod i nabavka nakon prve montaže ne pišu izmjenu', async () => {
    const stale = setup();
    await expect(stale.svc.updateSet(setId, { ...stale.updateInput, version: 1 })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      extra: { currentVersion: 2 },
    });
    expect(stale.tx.tireSet.updateMany).not.toHaveBeenCalled();

    const duplicate = setup();
    await expect(
      duplicate.svc.updateSet(setId, { ...duplicate.updateInput, code: 'G-Z-002' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
    expect(duplicate.tx.tireSet.updateMany).not.toHaveBeenCalled();

    const purchase = setup({ withHistory: true });
    await expect(
      purchase.svc.updateSet(setId, { version: 2, purchaseDate: '2026-01-11' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(purchase.tx.tireSet.updateMany).not.toHaveBeenCalled();
  });

  it('montiran komplet dozvoljava opisnu ispravku, ali ne ručnu promjenu statusa ni premali broj guma', async () => {
    const descriptive = setup({ withActive: true });
    await expect(
      descriptive.svc.updateSet(setId, { version: 2, brand: 'Ispravljena marka' }),
    ).resolves.toMatchObject({ data: { brand: 'Ispravljena marka', status: 'MOUNTED' } });

    const statusChange = setup({ withActive: true });
    await expect(statusChange.svc.updateSet(setId, { version: 2, status: 'IN_STOCK' })).rejects.toMatchObject(
      { code: 'TIRE_ALREADY_MOUNTED' },
    );

    const count = setup({ withActive: true });
    await expect(count.svc.updateSet(setId, { version: 2, tireCount: 2 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('deklarisani broj ne može pasti ispod broja evidentiranih pojedinačnih guma', async () => {
    const state = setup();
    await expect(state.svc.updateSet(setId, { version: 2, tireCount: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(state.tx.tire.count).toHaveBeenCalledWith({ where: { setId, deletedAt: null } });
    expect(state.tx.tireSet.updateMany).not.toHaveBeenCalled();
  });

  it('SCRAPPED je terminalan, a nekonzistentan MOUNTED bez aktivne montaže može se ispraviti', async () => {
    const scrapped = setup({ status: 'SCRAPPED' });
    await expect(scrapped.svc.updateSet(setId, { version: 2, status: 'IN_STOCK' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const inconsistent = setup({ status: 'MOUNTED' });
    await expect(
      inconsistent.svc.updateSet(setId, { version: 2, status: 'IN_STOCK' }),
    ).resolves.toMatchObject({ data: { status: 'IN_STOCK' } });
  });

  it('legacy zapis bez forme može mijenjati strukturirana polja, ali ne i formData', async () => {
    const legacy = setup({ formSchemaVersionId: null });
    await expect(legacy.svc.updateSet(setId, { version: 2, brand: 'Legacy marka' })).resolves.toMatchObject({
      data: { brand: 'Legacy marka', formSchemaVersionId: null },
    });

    const withFormData = setup({ formSchemaVersionId: null });
    await expect(
      withFormData.svc.updateSet(setId, { version: 2, formData: { supplier: 'Novi' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('konkurentno P2002 pri preimenovanju mapira na DUPLICATE_ENTRY', async () => {
    const state = setup();
    state.tx.tireSet.updateMany.mockRejectedValueOnce(Object.assign(new Error('P2002'), { code: 'P2002' }));
    await expect(state.svc.updateSet(setId, state.updateInput)).rejects.toMatchObject({
      code: 'DUPLICATE_ENTRY',
    });
  });

  it('brisanje montiranog kompleta je blokirano aktivnom montažom', async () => {
    const state = setup({ withActive: true });
    await expect(state.svc.removeSet(setId, actorId)).rejects.toMatchObject({
      code: 'TIRE_ALREADY_MOUNTED',
      extra: expect.objectContaining({ mountedVehicleInternalNo: 'V-001' }),
    });
    expect(state.sets.get(setId)?.deletedAt).toBeNull();
    expect(state.tx.tireSet.updateMany).not.toHaveBeenCalled();
  });

  it('brisanje je soft-delete kompleta i pojedinačnih guma, historija ostaje u bazi', async () => {
    const state = setup({ withHistory: true });
    const result = await state.svc.removeSet(setId, actorId);

    expect(result.before.code).toBe('G-Z-001');
    expect(result.after).toMatchObject({ id: setId, deletedById: actorId });
    expect(state.sets.get(setId)?.deletedAt).toBeInstanceOf(Date);
    expect(state.sets.get(setId)?.version).toBe(3);
    expect(state.tires.every((tire) => tire.deletedAt instanceof Date)).toBe(true);
    expect(state.installations).toHaveLength(1);
    await expect(state.svc.getSet(setId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('DTO odbija MOUNTED kao ručni status, praznu izmjenu i nepoznata polja', () => {
    for (const input of [
      { version: 2 },
      { version: 2, status: 'MOUNTED' },
      { version: -1, brand: 'X' },
      { version: 2, tireCount: 9 },
      { version: 2, purchasePrice: -1 },
      { version: 2, deletedAt: null },
    ]) {
      expect(updateTireSetSchema.safeParse(input).success).toBe(false);
    }
  });

  it('kontroler razdvaja view/update/delete permisije i audit težinu', () => {
    const permissions = (method: unknown) =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;
    expect(permissions(TireSetsController.prototype.getSet)).toEqual(['tire:view']);
    expect(permissions(TireSetsController.prototype.updateSet)).toEqual(['tire:update']);
    expect(permissions(TireSetsController.prototype.removeSet)).toEqual(['tire:delete']);
    expect(Reflect.getMetadata('vfm:audit', TireSetsController.prototype.updateSet)).toMatchObject({
      action: 'UPDATE',
      resource: 'TireSet',
    });
    expect(Reflect.getMetadata('vfm:audit', TireSetsController.prototype.removeSet)).toMatchObject({
      action: 'DELETE',
      severity: 'CRITICAL',
      resource: 'TireSet',
    });
  });
});
