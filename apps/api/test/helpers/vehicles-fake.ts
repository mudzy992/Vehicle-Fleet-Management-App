/**
 * Fake Prisma za testove vozila i kilometraže.
 *
 * Namjerno minimalan: implementira **samo** ono što servisi zovu, ali s
 * ponašanjem koje je bitno za pravila — `update`/`updateMany` vraćaju nove
 * objekte (kao Prisma), `updateMany` poštuje `version` u `where`, a filter
 * podržava `id: { not }` i `OR` s `contains`.
 */
import type { VfmException } from '../../src/common/errors/vfm-error.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

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

export interface FakeOdometerRow {
  id: string;
  vehicleId: string;
  valueKm: number;
  source: string;
  readingAt: Date;
  recordedById: string | null;
  isCorrection: boolean;
  correctionReason: string | null;
  previousValueKm: number | null;
  createdAt: Date;
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

  nextId(prefix: string): string {
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
      where: { id: string; version?: number; deletedAt?: null };
      data: Record<string, unknown> & { version?: { increment: number } };
    }) => {
      const index = this.vehicles.findIndex(
        (item) =>
          item.id === args.where.id &&
          (args.where.deletedAt === undefined || item.deletedAt === null) &&
          (args.where.version === undefined || item.version === args.where.version),
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

  readonly readings: FakeOdometerRow[] = [];

  odometerReading = {
    create: async (args: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeOdometerRow = {
        id: this.nextId('odo'),
        vehicleId: String(args.data.vehicleId),
        valueKm: Number(args.data.valueKm),
        source: String(args.data.source ?? 'MANUAL'),
        readingAt: new Date(args.data.readingAt as Date),
        recordedById: (args.data.recordedById as string | null) ?? null,
        isCorrection: Boolean(args.data.isCorrection),
        correctionReason: (args.data.correctionReason as string | null) ?? null,
        previousValueKm: (args.data.previousValueKm as number | null) ?? null,
        createdAt: now,
      };
      this.readings.push(row);
      return row;
    },
    findMany: async (args: {
      where: { vehicleId: string };
      skip?: number;
      take?: number;
      orderBy?: unknown;
    }) => {
      const rows = this.readings
        .filter((row) => row.vehicleId === args.where.vehicleId)
        .sort((a, b) => b.readingAt.getTime() - a.readingAt.getTime());
      return rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
    },
    count: async (args: { where: { vehicleId: string } }) =>
      this.readings.filter((row) => row.vehicleId === args.where.vehicleId).length,
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

export { FakeVehiclePrisma, asPrisma, baseInput, catchVfm, getCurrentVersion, vehicleForm };
