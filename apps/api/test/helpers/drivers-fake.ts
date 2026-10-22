/**
 * Fake Prisma za testove vozača.
 *
 * Minimalan, ali s ponašanjem bitnim za pravila: `update`/`updateMany` vraćaju
 * nove objekte, `updateMany` poštuje `version` u `where`, a filter podržava
 * `status`, `OR` s `contains`, `categories.some` i raspone datuma.
 */
import { toLocalDateString } from '@vfm/shared';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

/** Definicija iz seed-a (ista koja ide u produkciju). */
const SEED_DRIVER = SEED_FORMS.find((form) => form.key === 'vozac')?.definition;
if (!SEED_DRIVER) throw new Error('seed forma `vozac` nedostaje');

function driverForm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return structuredClone({ ...SEED_DRIVER, ...overrides });
}

export interface FakeDriverRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: Date | null;
  address: string | null;
  employeeNumber: string | null;
  employmentStatus: string | null;
  licenseNumber: string | null;
  licenseIssuedAt: Date | null;
  licenseExpiresAt: Date | null;
  licenseIssuingAuthority: string | null;
  restrictions: string | null;
  notes: string | null;
  status: string;
  photoAttachmentId: string | null;
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: Record<string, unknown>;
  version: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeLicenseRow {
  id: string;
  driverId: string;
  category: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  restrictions: string | null;
  notes: string | null;
}

type Where = Record<string, unknown>;

class FakeDriverPrisma {
  readonly drivers: FakeDriverRow[] = [];
  readonly licenses: FakeLicenseRow[] = [];
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

  addForm(): { formSchemaId: string; versionId: string } {
    const formSchemaId = this.nextId('form');
    const versionId = this.nextId('ver');
    this.versions.push({
      id: versionId,
      formSchemaId,
      version: 1,
      status: 'PUBLISHED',
      definition: driverForm(),
    });
    this.schemas.push({
      id: formSchemaId,
      subject: 'DRIVER',
      currentPublishedVersionId: versionId,
      deletedAt: null,
      updatedAt: new Date(),
    });
    return { formSchemaId, versionId };
  }

  /** Ubaci vozača direktno (bez servisa) — za list/filter/arhivu testove. */
  addDriver(overrides: Partial<FakeDriverRow> = {}): FakeDriverRow {
    const form = this.addForm();
    const now = new Date();
    const row: FakeDriverRow = {
      id: this.nextId('drv'),
      firstName: 'Fikret',
      lastName: 'Hodžić',
      phone: '+387 61 111 222',
      email: 'fikret.hodzic@example.ba',
      dateOfBirth: new Date('1985-04-12T00:00:00.000Z'),
      address: 'Ulica 1, Sarajevo',
      employeeNumber: null,
      employmentStatus: null,
      licenseNumber: 'BA-123456',
      licenseIssuedAt: null,
      licenseExpiresAt: null,
      licenseIssuingAuthority: null,
      restrictions: null,
      notes: null,
      status: 'ACTIVE',
      photoAttachmentId: null,
      formSchemaId: form.formSchemaId,
      formSchemaVersionId: form.versionId,
      formData: {},
      version: 0,
      createdById: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides,
    };
    this.drivers.push(row);
    return row;
  }

  driver = {
    count: async (args: { where?: Where }) => this.filter(args.where ?? {}).length,
    findMany: async (args: { where?: Where; skip?: number; take?: number; select?: unknown }) => {
      const rows = this.filter(args.where ?? {});
      return rows
        .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length))
        .map((row) => this.withCategories(row));
    },
    findFirst: async (args: { where?: Where; select?: unknown }) => {
      const row = this.filter(args.where ?? {})[0];
      return row ? this.withCategories(row) : null;
    },
    create: async (args: { data: Partial<FakeDriverRow> }) => {
      assertDates(args.data, ['dateOfBirth', 'licenseIssuedAt', 'licenseExpiresAt']);
      const now = new Date();
      const row: FakeDriverRow = {
        id: this.nextId('drv'),
        firstName: 'N',
        lastName: 'N',
        phone: null,
        email: null,
        dateOfBirth: null,
        address: null,
        employeeNumber: null,
        employmentStatus: null,
        licenseNumber: null,
        licenseIssuedAt: null,
        licenseExpiresAt: null,
        licenseIssuingAuthority: null,
        restrictions: null,
        notes: null,
        status: 'ACTIVE',
        photoAttachmentId: null,
        formSchemaId: 'form-x',
        formSchemaVersionId: 'ver-x',
        formData: {},
        version: 0,
        createdById: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...args.data,
      } as FakeDriverRow;
      this.drivers.push(row);
      return this.withCategories(row);
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      assertDates(args.data, ['dateOfBirth', 'licenseIssuedAt', 'licenseExpiresAt']);
      const index = this.drivers.findIndex((item) => item.id === args.where.id);
      if (index < 0) throw new Error('nema reda');
      const next = { ...this.drivers[index]!, ...args.data, updatedAt: new Date() } as FakeDriverRow;
      this.drivers[index] = next;
      return this.withCategories(next);
    },
    updateMany: async (args: {
      where: { id: string; version?: number; deletedAt?: null };
      data: Record<string, unknown> & { version?: { increment: number } };
    }) => {
      const index = this.drivers.findIndex(
        (item) =>
          item.id === args.where.id &&
          (args.where.deletedAt === undefined || item.deletedAt === null) &&
          (args.where.version === undefined || item.version === args.where.version),
      );
      if (index < 0) return { count: 0 };
      const { version, ...rest } = args.data;
      const current = this.drivers[index]!;
      this.drivers[index] = {
        ...current,
        ...rest,
        version: current.version + (version?.increment ?? 1),
        updatedAt: new Date(),
      } as FakeDriverRow;
      return { count: 1 };
    },
  };

  driverLicenseCategory = {
    findMany: async (args: { where: { driverId: string } }) =>
      this.licenses
        .filter((row) => row.driverId === args.where.driverId)
        .sort((a, b) => a.category.localeCompare(b.category)),
    findFirst: async (args: { where: { id?: string; driverId?: string; category?: string } }) =>
      this.licenses.find(
        (row) =>
          (args.where.id === undefined || row.id === args.where.id) &&
          (args.where.driverId === undefined || row.driverId === args.where.driverId) &&
          (args.where.category === undefined || row.category === args.where.category),
      ) ?? null,
    create: async (args: { data: Partial<FakeLicenseRow> }) => {
      assertDates(args.data as Record<string, unknown>, ['issuedAt', 'expiresAt']);
      const row: FakeLicenseRow = {
        id: this.nextId('cat'),
        driverId: String(args.data.driverId),
        category: String(args.data.category),
        issuedAt: (args.data.issuedAt as Date | null) ?? null,
        expiresAt: (args.data.expiresAt as Date | null) ?? null,
        restrictions: (args.data.restrictions as string | null) ?? null,
        notes: (args.data.notes as string | null) ?? null,
      };
      this.licenses.push(row);
      return row;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      assertDates(args.data, ['issuedAt', 'expiresAt']);
      const index = this.licenses.findIndex((item) => item.id === args.where.id);
      if (index < 0) throw new Error('nema reda');
      const next = { ...this.licenses[index]!, ...args.data } as FakeLicenseRow;
      this.licenses[index] = next;
      return next;
    },
    delete: async (args: { where: { id: string } }) => {
      const index = this.licenses.findIndex((item) => item.id === args.where.id);
      if (index < 0) throw new Error('nema reda');
      const [removed] = this.licenses.splice(index, 1);
      return removed;
    },
  };

  formSchema = {
    findFirst: async (args: { where: Where; orderBy?: unknown }) => {
      const rows = this.schemas.filter((schema) => {
        const where = args.where;
        if (where.subject && schema.subject !== where.subject) return false;
        if (where.deletedAt === null && schema.deletedAt !== null) return false;
        if (where.currentPublishedVersionId && schema.currentPublishedVersionId === null) {
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
        ...(args.include?.formSchema ? { formSchema: { subject: schema?.subject ?? 'DRIVER' } } : {}),
      };
    },
  };

  $transaction = async <T>(fn: (tx: FakeDriverPrisma) => Promise<T>): Promise<T> => fn(this);

  private withCategories(row: FakeDriverRow): FakeDriverRow & {
    categories: Array<{ category: string }>;
  } {
    return {
      ...row,
      categories: this.licenses
        .filter((license) => license.driverId === row.id)
        .map((license) => ({ category: license.category })),
    };
  }

  // --- filter koji servis koristi --------------------------------------------

  private filter(where: Where): FakeDriverRow[] {
    return this.drivers.filter((row) => {
      if (where.deletedAt === null && row.deletedAt !== null) return false;
      if (typeof where.id === 'string' && row.id !== where.id) return false;
      if (where.id && typeof where.id === 'object') {
        const idFilter = where.id as { in?: readonly string[] };
        if (idFilter.in && !idFilter.in.includes(row.id)) return false;
      }
      if (typeof where.createdById === 'string' && row.createdById !== where.createdById) return false;

      const status = where.status;
      if (typeof status === 'string' && row.status !== status) return false;
      if (status && typeof status === 'object' && (status as { not?: string }).not) {
        if (row.status === (status as { not: string }).not) return false;
      }

      const categories = where.categories as
        { some?: { category?: string; expiresAt?: { gte: Date; lte: Date } } } | undefined;
      if (categories?.some) {
        const some = categories.some;
        const hit = this.licenses.some(
          (license) =>
            license.driverId === row.id &&
            (some.category === undefined || license.category === some.category) &&
            (some.expiresAt === undefined ||
              (license.expiresAt !== null &&
                license.expiresAt >= some.expiresAt.gte &&
                license.expiresAt <= some.expiresAt.lte)),
        );
        if (!hit) return false;
      }

      const or = where.OR as ReadonlyArray<Where> | undefined;
      if (or) {
        const hit = or.some((condition) => {
          const [key, value] = Object.entries(condition)[0] ?? [];
          if (!key) return false;
          if (typeof value === 'object' && value !== null && 'contains' in value) {
            const needle = String((value as { contains: unknown }).contains).toLowerCase();
            const haystack = row[key as keyof FakeDriverRow];
            return typeof haystack === 'string' && haystack.toLowerCase().includes(needle);
          }
          return row[key as keyof FakeDriverRow] === value;
        });
        if (!hit) return false;
      }

      const and = where.AND as ReadonlyArray<{ OR: ReadonlyArray<Where> }> | undefined;
      if (and) {
        const hit = and.every((clause) =>
          clause.OR.some((condition) => {
            const [key, value] = Object.entries(condition)[0] ?? [];
            const range = value as { gte?: Date; lte?: Date } | undefined;
            if (key === 'licenseExpiresAt' && range) {
              return (
                row.licenseExpiresAt !== null &&
                row.licenseExpiresAt >= range.gte! &&
                row.licenseExpiresAt <= range.lte!
              );
            }
            if (key === 'categories') {
              const window = (value as { some?: { expiresAt?: { gte: Date; lte: Date } } }).some?.expiresAt;
              if (!window) return false;
              return this.licenses.some(
                (license) =>
                  license.driverId === row.id &&
                  license.expiresAt !== null &&
                  license.expiresAt >= window.gte &&
                  license.expiresAt <= window.lte,
              );
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

/**
 * `@db.Date` kolone moraju dobiti `Date`, ne `YYYY-MM-DD` — ista greška koju bi
 * Prisma bacila na deployu („premature end of input").
 */
function assertDates(data: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && !(value instanceof Date)) {
      throw new Error(`FakePrisma(@db.Date): \`${key}\` mora biti Date, dobijen ${JSON.stringify(value)}.`);
    }
  }
}

function asPrisma(fake: FakeDriverPrisma): never {
  return fake as unknown as never;
}

/**
 * Lokalni „danas” (`Europe/Sarajevo`) + N dana kao `@db.Date`.
 *
 * Servis granicu `expiringInDays` računa po lokalnom datumu, pa helper ne
 * smije koristiti UTC datum: između lokalne ponoći i UTC ponoći ta dva
 * datuma nisu ista.
 */
function inDays(days: number): Date {
  const date = new Date(`${toLocalDateString(new Date())}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function baseDriverInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Fikret',
    lastName: 'Hodžić',
    phone: '+387 61 111 222',
    email: 'fikret.hodzic@example.ba',
    dateOfBirth: '1985-04-12',
    address: 'Ulica 1, Sarajevo',
    licenseNumber: 'BA-123456',
    licenseExpiresAt: '2027-03-01',
    formData: { emergencyContact: 'Selma 061 000 000' },
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

export { FakeDriverPrisma, asPrisma, baseDriverInput, catchVfm, driverForm, inDays };
