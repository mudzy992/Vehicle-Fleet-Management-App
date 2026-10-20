/**
 * `VehiclesService` — vozila kao zapisi dinamičke forme (docs/07 §2.5, P10/P11).
 *
 * Provjerava ono što bi u produkciji skupo koštalo:
 * - `formData` se validira prema **tačnoj** verziji forme, a normalizovane
 *   kolone se pune samo s whitelist-a vozila (`NORMALIZATION_MISMATCH` inače);
 * - `internalNo`/`vin` su jedinstveni među aktivnim zapisima (`DUPLICATE_VALUE`);
 * - `PATCH` je optimistički zaključan (`version` → `VERSION_CONFLICT`);
 * - status mašina ne dozvoljava „preskok" u `ARCHIVED` mimo `/archive`;
 * - arhiviranje i brisanje ne uklanjaju zapis (arhiva/brisanje su mekа).
 */
import { describe, expect, it } from 'vitest';
import type { VehicleDetail } from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';
import { VEHICLE_STATUS_TRANSITIONS, VehiclesService } from '../../src/modules/vehicles/vehicles.service.js';

// ---------------------------------------------------------------------------
//  Minimalna `VEHICLE` forma (prolazi meta-shemu; mapira kolone vozila)
// ---------------------------------------------------------------------------

const SEED_VEHICLE = SEED_FORMS.find((form) => form.key === 'vehicle')?.definition;
if (!SEED_VEHICLE) throw new Error('seed forma `vehicle` nedostaje');

/**
 * Definicija iz seed-a (ista koja ide u produkciju) uz mogućnost da test
 * namjerno pokvari mapiranje kolona.
 */
function vehicleForm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return structuredClone({ ...SEED_VEHICLE, ...overrides });
}

interface FakeVehicleRow {
  id: string;
  internalNo: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  plateNumber: string | null;
  fuelType: string;
  transmission: string | null;
  color: string | null;
  bodyType: string | null;
  engineCcm: number | null;
  enginePowerKw: number | null;
  seats: number | null;
  ownershipType: string;
  acquisitionDate: Date | null;
  acquisitionPrice: number | null;
  costCenter: string | null;
  odometerKm: number;
  odometerUpdatedAt: Date | null;
  status: string;
  registrationExpiresAt: Date | null;
  insuranceExpiresAt: Date | null;
  nextServiceDueDate: Date | null;
  nextServiceDueKm: number | null;
  photoAttachmentId: string | null;
  notes: string | null;
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
  createdById: string | null;
}

/** Minimalni fake Prisma — samo metode koje servis stvarno zove. */
class FakeVehiclePrisma {
  readonly vehicles: FakeVehicleRow[] = [];
  readonly schemas: Array<{
    id: string;
    subject: string;
    currentPublishedVersionId: string | null;
    deletedAt: Date | null;
    updatedAt: Date;
  }> = [];
  readonly versions: Array<{
    id: string;
    formSchemaId: string;
    version: number;
    status: string;
    definition: Record<string, unknown>;
    formSchema?: { subject: string };
  }> = [];

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  addForm(options: { subject?: string; definition?: Record<string, unknown>; status?: string } = {}): {
    formSchemaId: string;
    versionId: string;
  } {
    const formSchemaId = this.nextId('form');
    const versionId = this.nextId('ver');
    this.versions.push({
      id: versionId,
      formSchemaId,
      version: 1,
      status: options.status ?? 'PUBLISHED',
      definition: options.definition ?? vehicleForm(),
    });
    this.schemas.push({
      id: formSchemaId,
      subject: options.subject ?? 'VEHICLE',
      currentPublishedVersionId: versionId,
      deletedAt: null,
      updatedAt: new Date(),
    });
    return { formSchemaId, versionId };
  }

  vehicle = {
    count: async (args: { where: Record<string, unknown> }) => this.filter(args.where).length,
    findMany: async (args: { where?: Record<string, unknown>; skip?: number; take?: number }) => {
      const rows = this.filter(args.where ?? {});
      return rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
    },
    findFirst: async (args: { where: Record<string, unknown> }) => this.filter(args.where)[0] ?? null,
    create: async (args: { data: Partial<FakeVehicleRow> }) => {
      const now = new Date();
      const row: FakeVehicleRow = {
        transmission: null,
        color: null,
        bodyType: null,
        engineCcm: null,
        enginePowerKw: null,
        seats: null,
        vin: null,
        year: null,
        plateNumber: null,
        acquisitionDate: null,
        acquisitionPrice: null,
        costCenter: null,
        odometerUpdatedAt: null,
        registrationExpiresAt: null,
        insuranceExpiresAt: null,
        nextServiceDueDate: null,
        nextServiceDueKm: null,
        photoAttachmentId: null,
        notes: null,
        archivedAt: null,
        deletedAt: null,
        createdById: null,
        ...args.data,
        id: this.nextId('veh'),
        ownershipType: args.data.ownershipType ?? 'OWNED',
        odometerKm: args.data.odometerKm ?? 0,
        status: args.data.status ?? 'ACTIVE',
        version: 0,
        createdAt: now,
        updatedAt: now,
      } as FakeVehicleRow;
      this.vehicles.push(row);
      return row;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const index = this.vehicles.findIndex((item) => item.id === args.where.id);
      if (index < 0) throw new Error('nema reda');
      const next = { ...this.vehicles[index]!, ...args.data, updatedAt: new Date() } as FakeVehicleRow;
      this.vehicles[index] = next;
      return next;
    },
    updateMany: async (args: {
      where: { id: string; version: number; deletedAt: null };
      data: Record<string, unknown> & { version?: { increment: number } };
    }) => {
      const index = this.vehicles.findIndex(
        (item) => item.id === args.where.id && item.deletedAt === null && item.version === args.where.version,
      );
      if (index < 0) return { count: 0 };
      const { version, ...rest } = args.data;
      const current = this.vehicles[index]!;
      this.vehicles[index] = {
        ...current,
        ...rest,
        version: current.version + (version?.increment ?? 1),
        updatedAt: new Date(),
      } as FakeVehicleRow;
      return { count: 1 };
    },
  };

  formSchema = {
    findFirst: async (args: { where: Record<string, unknown>; orderBy?: unknown }) => {
      const rows = this.schemas.filter((schema) => {
        const where = args.where;
        if (where.subject && schema.subject !== where.subject) return false;
        if (where.deletedAt === null && schema.deletedAt !== null) return false;
        if (
          where.currentPublishedVersionId &&
          (where.currentPublishedVersionId as { not: null }).not === null &&
          schema.currentPublishedVersionId === null
        ) {
          return false;
        }
        return true;
      });
      return rows[0] ?? null;
    },
  };

  formSchemaVersion = {
    findUnique: async (args: { where: { id: string }; include?: { formSchema?: boolean } }) => {
      const version = this.versions.find((item) => item.id === args.where.id);
      if (!version) return null;
      const schema = this.schemas.find((item) => item.id === version.formSchemaId);
      return {
        ...version,
        ...(args.include?.formSchema ? { formSchema: { subject: schema?.subject ?? 'VEHICLE' } } : {}),
      };
    },
  };

  $transaction = async <T>(fn: (tx: FakeVehiclePrisma) => Promise<T>): Promise<T> => fn(this);

  // --- filter koji servis koristi (status, q, expiringInDays, deletedAt) ------

  private filter(where: Record<string, unknown>): FakeVehicleRow[] {
    return this.vehicles.filter((row) => {
      if (where.deletedAt === null && row.deletedAt !== null) return false;
      if (typeof where.id === 'string' && row.id !== where.id) return false;
      if (where.id && typeof where.id === 'object') {
        const not = (where.id as { not?: string }).not;
        if (not && row.id === not) return false;
      }

      const status = where.status;
      if (typeof status === 'string' && row.status !== status) return false;
      if (status && typeof status === 'object' && (status as { not: string }).not) {
        if (row.status === (status as { not: string }).not) return false;
      }

      if (where.fuelType && row.fuelType !== where.fuelType) return false;

      const or = where.OR as ReadonlyArray<Record<string, unknown>> | undefined;
      if (or) {
        const hit = or.some((condition) => {
          const [key, value] = Object.entries(condition)[0] ?? [];
          if (!key) return false;
          if (value === null) return row[key as keyof FakeVehicleRow] === null;
          if (typeof value === 'object' && value !== null && 'contains' in value) {
            const needle = String((value as { contains: unknown }).contains).toLowerCase();
            const haystack = row[key as keyof FakeVehicleRow];
            return typeof haystack === 'string' && haystack.toLowerCase().includes(needle);
          }
          return row[key as keyof FakeVehicleRow] === value;
        });
        if (!hit) return false;
      }

      const and = where.AND as ReadonlyArray<{ OR: ReadonlyArray<Record<string, unknown>> }> | undefined;
      if (and) {
        const hit = and.every((clause) =>
          clause.OR.some((condition) => {
            const [key, value] = Object.entries(condition)[0] ?? [];
            const rowValue = row[key as keyof FakeVehicleRow];
            if (value && typeof value === 'object' && 'lte' in value) {
              return rowValue instanceof Date && rowValue <= (value as { lte: Date }).lte;
            }
            return false;
          }),
        );
        if (!hit) return false;
      }

      return true;
    });
  }
}

function asPrisma(fake: FakeVehiclePrisma): never {
  return fake as unknown as never;
}

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    internalNo: 'V-001',
    make: 'Volkswagen',
    model: 'Golf 7',
    fuelType: 'DIESEL',
    year: 2019,
    formData: { plateNumber: 'A12-M-345', odometerKm: 120_000 },
    ...overrides,
  };
}

function getCurrentVersion(error: VfmException): unknown {
  return error.extra?.currentVersion;
}

async function catchVfm(promise: Promise<unknown>): Promise<VfmException> {
  try {
    await promise;
  } catch (error) {
    return error as VfmException;
  }
  throw new Error('očekivana greška nije bačena');
}

describe('VehiclesService — create', () => {
  it('puni normalizovane kolone iz forme i čuva verziju forme (P10)', async () => {
    const fake = new FakeVehiclePrisma();
    const { formSchemaId, versionId } = fake.addForm();
    const service = new VehiclesService(asPrisma(fake));

    const outcome = await service.create(baseInput() as never, 'actor-1');

    expect(outcome.data.internalNo).toBe('V-001');
    expect(outcome.data.year).toBe(2019);
    expect(outcome.data.odometerKm).toBe(120_000);
    expect(outcome.data.fuelType).toBe('DIESEL');
    expect(outcome.data.formSchemaId).toBe(formSchemaId);
    expect(outcome.data.formSchemaVersionId).toBe(versionId);
    expect(outcome.data.status).toBe('ACTIVE');
    expect(outcome.data.version).toBe(0);
    expect(fake.vehicles[0]?.createdById).toBe('actor-1');
    expect(outcome.after?.status).toBe('ACTIVE');
  });

  it('bez objavljene VEHICLE forme ne kreira zapis', async () => {
    const fake = new FakeVehiclePrisma();
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('FORM_VERSION_NOT_PUBLISHED');
  });

  it('odbija verziju forme drugog subjecta', async () => {
    const fake = new FakeVehiclePrisma();
    const { versionId } = fake.addForm({ subject: 'TASK', definition: vehicleForm() });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(
      service.create({ formData: baseInput().formData as object, formSchemaVersionId: versionId } as never),
    );
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('P11: nedostajuće obavezno polje daje grešku po ključu forme', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));

    const { make: _make, ...withoutMake } = baseInput();

    const error = await catchVfm(service.create(withoutMake as never));
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect((error.details ?? []).some((item) => item.path?.join('.') === 'formData.make')).toBe(true);
    expect(fake.vehicles).toHaveLength(0);
  });

  it('dupli internalNo među aktivnim vozilima → DUPLICATE_VALUE', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    await service.create(baseInput() as never);

    const error = await catchVfm(
      service.create({ ...baseInput(), formData: { plateNumber: 'B99-M-999' } } as never),
    );
    expect(error.code).toBe('DUPLICATE_ENTRY');
    expect(error.httpStatus).toBe(409);
  });

  it('mapiranje na kolonu koja nije dozvoljena se odbija već pri parsiranju definicije', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm({
      definition: vehicleForm({
        normalizedName: [
          ...(vehicleForm().normalizedName as unknown[]),
          { fieldKey: 'make', column: 'modelYear', transform: 'TO_INT' },
        ],
      }),
    });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
  });

  it('normalizovana vrijednost koja nije cijeli broj → NORMALIZATION_MISMATCH', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm({
      definition: vehicleForm({
        normalizedName: [{ fieldKey: 'plateNumber', column: 'odometerKm', transform: 'TO_TEXT' }],
      }),
    });
    const service = new VehiclesService(asPrisma(fake));

    const error = await catchVfm(service.create(baseInput() as never));
    expect(error.code).toBe('NORMALIZATION_MISMATCH');
  });
});

describe('VehiclesService — list', () => {
  async function seeded(): Promise<{ service: VehiclesService; fake: FakeVehiclePrisma }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    await service.create(baseInput() as never);
    await service.create({
      internalNo: 'V-002',
      make: 'Renault',
      model: 'Clio',
      fuelType: 'PETROL',
      formData: { plateNumber: 'B22-M-222' },
    } as never);
    return { service, fake };
  }

  it('podrazumijevano skriva arhivirana vozila', async () => {
    const { service } = await seeded();
    const first = (
      await service.list({ page: 1, pageSize: 25, sortOrder: 'asc', includeArchived: false } as never)
    ).items[0];
    await service.archive(first!.id, {} as never);

    const visible = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: false,
    } as never);
    expect(visible.total).toBe(1);

    const all = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: true,
    } as never);
    expect(all.total).toBe(2);
  });

  it('paginacija vraća `totalPages` i filtrira po `q`', async () => {
    const { service } = await seeded();

    const page = await service.list({
      page: 1,
      pageSize: 1,
      sortOrder: 'asc',
      includeArchived: false,
    } as never);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);

    const search = await service.list({
      page: 1,
      pageSize: 25,
      sortOrder: 'asc',
      includeArchived: false,
      q: 'clio',
    } as never);
    expect(search.items.map((item) => item.internalNo)).toEqual(['V-002']);
  });
});

describe('VehiclesService — update / status', () => {
  async function seed(): Promise<{
    service: VehiclesService;
    fake: FakeVehiclePrisma;
    vehicle: VehicleDetail;
  }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const created = await service.create(baseInput() as never);
    return { service, fake, vehicle: created.data };
  }

  it('pogrešna `version` → VERSION_CONFLICT s trenutnom verzijom', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.update(vehicle.id, { version: 99, notes: 'x' } as never));
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(getCurrentVersion(error)).toBe(0);
  });

  it('uspješna promjena diže verziju i vraća before/after za audit', async () => {
    const { service, vehicle } = await seed();

    const outcome = await service.update(vehicle.id, {
      version: 0,
      status: 'IN_SERVICE',
      notes: 'Servis u toku',
    } as never);

    expect(outcome.data.status).toBe('IN_SERVICE');
    expect(outcome.data.version).toBe(1);
    expect(outcome.data.notes).toBe('Servis u toku');
    expect(outcome.before?.status).toBe('ACTIVE');
    expect(outcome.after?.status).toBe('IN_SERVICE');
  });

  it('nedozvoljen prelaz statusa → VALIDATION_ERROR', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.update(vehicle.id, { version: 0, status: 'ARCHIVED' } as never));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(VEHICLE_STATUS_TRANSITIONS.ACTIVE).not.toContain('ARCHIVED');
  });

  it('arhivirano vozilo se ne mijenja (samo /restore)', async () => {
    const { service, vehicle } = await seed();
    await service.archive(vehicle.id, { reason: 'prodato' } as never);

    const error = await catchVfm(service.update(vehicle.id, { version: 0, notes: 'x' } as never));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('izmjena formData koristi verziju koju zapis nosi (i RETIRED je dozvoljena)', async () => {
    const { service, fake, vehicle } = await seed();
    // Verzija je u međuvremenu povučena — postojeći zapis se i dalje validira njome (P10).
    const version = fake.versions.find((item) => item.id === vehicle.formSchemaVersionId);
    if (version) version.status = 'RETIRED';

    const outcome = await service.update(vehicle.id, {
      version: 0,
      formData: { plateNumber: 'A12-M-345', odometerKm: 130_000 },
    } as never);

    expect(outcome.data.odometerKm).toBe(130_000);
    expect(outcome.data.formSchemaVersionId).toBe(vehicle.formSchemaVersionId);
  });

  it('dupli `vin` pri izmjeni, uz izuzimanje samog sebe', async () => {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const VIN_A = 'WVWZZZ1KZAW000001';
    const VIN_B = 'WVWZZZ1KZAW000002';

    const first = await service.create({ ...baseInput(), vin: VIN_A } as never);
    const second = await service.create({ ...baseInput(), internalNo: 'V-002', vin: VIN_B } as never);

    // Isti zapis smije zadržati svoj VIN.
    const same = await service.update(first.data.id, { version: 0, vin: VIN_A } as never);
    expect(same.data.vin).toBe(VIN_A);

    const error = await catchVfm(service.update(second.data.id, { version: 0, vin: VIN_A } as never));
    expect(error.code).toBe('DUPLICATE_ENTRY');
  });
});

describe('VehiclesService — arhiva i brisanje', () => {
  async function seed(): Promise<{
    service: VehiclesService;
    fake: FakeVehiclePrisma;
    vehicle: VehicleDetail;
  }> {
    const fake = new FakeVehiclePrisma();
    fake.addForm();
    const service = new VehiclesService(asPrisma(fake));
    const created = await service.create(baseInput() as never);
    return { service, fake, vehicle: created.data };
  }

  it('arhiviranje čuva zapis i postavlja `archivedAt`', async () => {
    const { service, fake, vehicle } = await seed();

    const outcome = await service.archive(vehicle.id, { reason: 'prodato' } as never);

    expect(outcome.data.status).toBe('ARCHIVED');
    expect(outcome.data.archivedAt).not.toBeNull();
    expect(fake.vehicles[0]?.notes).toBe('prodato');
    expect(fake.vehicles[0]?.deletedAt).toBeNull();
  });

  it('restore vraća u `INACTIVE` i briše `archivedAt`', async () => {
    const { service, vehicle } = await seed();
    await service.archive(vehicle.id, {} as never);

    const outcome = await service.restore(vehicle.id);
    expect(outcome.data.status).toBe('INACTIVE');
    expect(outcome.data.archivedAt).toBeNull();
  });

  it('restore nad ne-arhiviranim vozilom → VALIDATION_ERROR', async () => {
    const { service, vehicle } = await seed();

    const error = await catchVfm(service.restore(vehicle.id));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('brisanje je soft-delete: zapis ostaje, `GET` ga više ne vraća', async () => {
    const { service, fake, vehicle } = await seed();

    await service.remove(vehicle.id, 'actor-1');

    expect(fake.vehicles).toHaveLength(1);
    expect(fake.vehicles[0]?.deletedAt).not.toBeNull();
    const error = await catchVfm(service.get(vehicle.id));
    expect(error.code).toBe('NOT_FOUND');
  });
});
