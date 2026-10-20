/**
 * Fake Prisma za registracije i osiguranje.
 *
 * Modelira ono što servisi stvarno koriste: filtriranje po vozilu/statusu/
 * periodu, `aggregate(_max.validUntil)` nad važećim zapisima, `updateMany` s
 * `version` u `where` i `$transaction`. Datumi se vraćaju kao `Date` (Prisma
 * `@db.Date` ponašanje), jer servis radi `.toISOString()`/`toLocalDateString()`.
 */
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const SEED_REGISTRATION = SEED_FORMS.find((form) => form.key === 'registracija_vozila')?.definition;
const SEED_INSURANCE = SEED_FORMS.find((form) => form.key === 'osiguranje_vozila')?.definition;
if (!SEED_REGISTRATION || !SEED_INSURANCE) throw new Error('seed forme za periode nedostaju');

export interface FakePeriodRow {
  id: string;
  vehicleId: string;
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: Record<string, unknown>;
  validFrom: Date;
  validUntil: Date;
  status: string;
  version: number;
  notes: string | null;
  attachmentIds: string[];
  currency: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  registrationNumber?: string;
  issuedBy?: string | null;
  costAmount?: number | null;
  policyNumber?: string | null;
  insuranceCompany?: string | null;
  type?: string | null;
  premiumAmount?: number | null;
  deductibleAmount?: number | null;
}

interface FakeVehicle {
  id: string;
  registrationExpiresAt: Date | null;
  insuranceExpiresAt: Date | null;
  deletedAt: Date | null;
}

type Where = Record<string, unknown>;

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(`${String(value)}T00:00:00.000Z`);
}

function matches(row: FakePeriodRow, where: Where): boolean {
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (where.id && typeof where.id === 'object') {
    const not = (where.id as { not?: string }).not;
    if (not && row.id === not) return false;
  }
  if (typeof where.vehicleId === 'string' && row.vehicleId !== where.vehicleId) return false;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.status && typeof where.status === 'object') {
    const filter = where.status as { not?: string; notIn?: string[] };
    if (filter.not && row.status === filter.not) return false;
    if (filter.notIn?.includes(row.status)) return false;
  }
  if (typeof where.type === 'string' && row.type !== where.type) return false;

  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === 'object' && 'contains' in value) {
      const needle = String((value as { contains: unknown }).contains).toLowerCase();
      const haystack = row[key as keyof FakePeriodRow];
      if (typeof haystack !== 'string' || !haystack.toLowerCase().includes(needle)) return false;
    }
  }

  if (where.validUntil && typeof where.validUntil === 'object') {
    const range = where.validUntil as { gte?: Date; lte?: Date };
    if (range.gte && row.validUntil < range.gte) return false;
    if (range.lte && row.validUntil > range.lte) return false;
  }

  const or = where.OR as ReadonlyArray<Where> | undefined;
  if (or) {
    const hit = or.some((condition) => {
      const [key, value] = Object.entries(condition)[0] ?? [];
      if (!key) return false;
      if (typeof value === 'object' && value !== null && 'contains' in value) {
        const needle = String((value as { contains: unknown }).contains).toLowerCase();
        const haystack = row[key as keyof FakePeriodRow];
        return typeof haystack === 'string' && haystack.toLowerCase().includes(needle);
      }
      return row[key as keyof FakePeriodRow] === value;
    });
    if (!hit) return false;
  }

  return true;
}

class FakePeriodPrisma {
  readonly vehicles: FakeVehicle[] = [];
  readonly registrations: FakePeriodRow[] = [];
  readonly insurances: FakePeriodRow[] = [];
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
  }> = [];

  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  addForm(subject: 'REGISTRATION' | 'INSURANCE'): { formSchemaId: string; versionId: string } {
    const formSchemaId = this.nextId('form');
    const versionId = this.nextId('ver');
    this.versions.push({
      id: versionId,
      formSchemaId,
      version: 1,
      status: 'PUBLISHED',
      definition: structuredClone(subject === 'REGISTRATION' ? SEED_REGISTRATION : SEED_INSURANCE) as Record<
        string,
        unknown
      >,
    });
    this.schemas.push({
      id: formSchemaId,
      subject,
      currentPublishedVersionId: versionId,
      deletedAt: null,
      updatedAt: new Date(),
    });
    return { formSchemaId, versionId };
  }

  addVehicle(overrides: Partial<FakeVehicle> = {}): FakeVehicle {
    const vehicle: FakeVehicle = {
      id: this.nextId('veh'),
      registrationExpiresAt: null,
      insuranceExpiresAt: null,
      deletedAt: null,
      ...overrides,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  vehicle = {
    findFirst: async (args: { where: Where }) =>
      this.vehicles.find(
        (row) => row.id === args.where.id && (args.where.deletedAt !== null || row.deletedAt === null),
      ) ?? null,
    updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const index = this.vehicles.findIndex((row) => row.id === args.where.id);
      if (index < 0) return { count: 0 };
      this.vehicles[index] = { ...this.vehicles[index]!, ...args.data } as FakeVehicle;
      return { count: 1 };
    },
  };

  registrationRecord = this.model(this.registrations, 'reg');
  insuranceRecord = this.model(this.insurances, 'ins');

  formSchema = {
    findFirst: async (args: { where: Where }) =>
      this.schemas.find((schema) => {
        if (args.where.subject && schema.subject !== args.where.subject) return false;
        if (args.where.deletedAt === null && schema.deletedAt !== null) return false;
        if (args.where.currentPublishedVersionId && !schema.currentPublishedVersionId) return false;
        return true;
      }) ?? null,
  };

  formSchemaVersion = {
    findUnique: async (args: { where: { id: string }; include?: unknown }) => {
      const version = this.versions.find((row) => row.id === args.where.id);
      if (!version) return null;
      const schema = this.schemas.find((row) => row.id === version.formSchemaId);
      return { ...version, formSchema: { subject: schema?.subject } };
    },
  };

  $transaction = async <T>(fn: (tx: FakePeriodPrisma) => Promise<T>): Promise<T> => fn(this);

  private model(rows: FakePeriodRow[], prefix: string) {
    const find = (where: Where) => rows.filter((row) => matches(row, where));

    return {
      count: async (args: { where?: Where }) => find(args.where ?? {}).length,
      findMany: async (args: { where?: Where }) => find(args.where ?? {}),
      findFirst: async (args: { where?: Where }) => find(args.where ?? {})[0] ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row = {
          id: this.nextId(prefix),
          vehicleId: String(args.data.vehicleId),
          formSchemaId: String(args.data.formSchemaId),
          formSchemaVersionId: String(args.data.formSchemaVersionId),
          formData: (args.data.formData as Record<string, unknown>) ?? {},
          status: String(args.data.status ?? 'ACTIVE'),
          version: 0,
          notes: (args.data.notes as string | null) ?? null,
          attachmentIds: (args.data.attachmentIds as string[] | undefined) ?? [],
          currency: 'BAM',
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          ...args.data,
        } as FakePeriodRow;
        // Prisma `@db.Date` prima ISO string, a vraća `Date` — fake radi isto.
        row.validFrom = toDate(row.validFrom);
        row.validUntil = toDate(row.validUntil);
        rows.push(row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = rows.findIndex((row) => row.id === args.where.id);
        if (index < 0) throw new Error('nema reda');
        const { version, ...rest } = args.data;
        const increment = (version as { increment?: number } | undefined)?.increment ?? 0;
        const next = {
          ...rows[index]!,
          ...rest,
          version: rows[index]!.version + increment,
          updatedAt: new Date(),
        } as FakePeriodRow;
        rows[index] = next;
        return next;
      },
      updateMany: async (args: {
        where: Where;
        data: Record<string, unknown> & { version?: { increment: number } };
      }) => {
        const index = rows.findIndex(
          (row) =>
            row.id === args.where.id &&
            (args.where.deletedAt === undefined || row.deletedAt === null) &&
            (args.where.version === undefined || row.version === args.where.version),
        );
        if (index < 0) return { count: 0 };
        const { version, ...rest } = args.data;
        rows[index] = {
          ...rows[index]!,
          ...rest,
          version: rows[index]!.version + (version?.increment ?? 1),
          updatedAt: new Date(),
        } as FakePeriodRow;
        return { count: 1 };
      },
      aggregate: async (args: { where?: Where }) => {
        const found = find(args.where ?? {});
        const latest = found.reduce<Date | null>(
          (max, row) => (max === null || row.validUntil > max ? row.validUntil : max),
          null,
        );
        return { _max: { validUntil: latest } };
      },
    };
  }
}

function asPrisma(fake: FakePeriodPrisma): never {
  return fake as unknown as never;
}

function baseRegistrationInput(
  vehicleId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    vehicleId,
    registrationNumber: 'REG-001',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    costAmount: 4_500,
    ...overrides,
  };
}

function baseInsuranceInput(
  vehicleId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    vehicleId,
    policyNumber: 'POL-001',
    insuranceCompany: 'Test osiguranje',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    premiumAmount: 3_000,
    ...overrides,
  };
}

async function catchVfm(promise: Promise<unknown>): Promise<{ code: string; extra?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; extra?: unknown };
  }
  throw new Error('očekivana greška nije bačena');
}

export { asPrisma, baseInsuranceInput, baseRegistrationInput, catchVfm, FakePeriodPrisma };
