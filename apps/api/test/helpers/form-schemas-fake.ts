/**
 * In-memory baza za testove forms modula.
 *
 * Zašto zaseban fake (a ne `FakePrismaClient`): form servis radi `findFirst` s
 * `include` (aktivna verzija, broj verzija), `groupBy` nad osam modela zapisa i
 * transakcije nad dvije tabele. Zajednički fake je građen za auth/RBAC upite i
 * bio bi zatrpan metodama koje niko drugi ne koristi.
 *
 * Fake **poštuje poslovna pravila koja test provjerava**: verzija mora pripadati
 * formi, `include` vraća stvarnu aktivnu verziju, a `_count.versions` se računa.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export interface FakeSchemaRow {
  id: string;
  key: string;
  name: string;
  subject: string;
  taskTypeId: string | null;
  description: string | null;
  ownerModule: string | null;
  status: string;
  currentPublishedVersionId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeVersionRow {
  id: string;
  formSchemaId: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  definition: unknown;
  contentHash: string | null;
  changeNote: string | null;
  mobileCompatible: boolean;
  normalizedName: unknown;
  publishedAt: Date | null;
  publishedById: string | null;
  retiredAt: Date | null;
  retiredById: string | null;
  createdAt: Date;
  createdById: string | null;
}

export interface FakeFieldKeyRow {
  id: string;
  key: string;
  dataType: string;
  unit: string | null;
  normalizedColumn: string | null;
  usedByFormSchemaIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Delegate za modele zapisa: broj zapisa po verziji + čitanje/izmjena zapisa. */
interface RecordDelegate {
  groupBy: (args: {
    by: readonly string[];
    where: { formSchemaVersionId: { in: readonly string[] } };
  }) => Promise<Record<string, unknown>[]>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    select?: Record<string, boolean>;
    take?: number;
    skip?: number;
  }) => Promise<FakeRecordRow[]>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<FakeRecordRow>;
}

export interface FakeMigrationJobRow {
  id: string;
  formSchemaId: string;
  fromVersionId: string;
  toVersionId: string;
  targetEntityType: string;
  targetEntityIds: string[];
  filter: unknown;
  status: string;
  previewResult: unknown;
  summary: unknown;
  notes: string | null;
  requestedById: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface FakeMigrationItemRow {
  id: string;
  jobId: string;
  entityId: string;
  before: unknown;
  after: unknown;
  status: string;
  error: string | null;
  processedAt: Date | null;
}

export interface FakeRecordRow {
  id: string;
  formSchemaId: string;
  formSchemaVersionId: string | null;
  formData: Record<string, unknown>;
  createdAt: Date;
  [column: string]: unknown;
}

export class FakeFormPrisma {
  readonly schemas = new Map<string, FakeSchemaRow>();
  readonly versions = new Map<string, FakeVersionRow>();
  readonly fieldKeys = new Map<string, FakeFieldKeyRow>();
  readonly migrationJobs = new Map<string, FakeMigrationJobRow>();
  readonly migrationItems = new Map<string, FakeMigrationItemRow>();
  /** Zapisi po modelu (`task`, `vehicle`, …) — migracija ih čita i mijenja. */
  readonly records = new Map<string, FakeRecordRow[]>();
  private readonly recordCounts = new Map<string, number>();

  /** Ubacuje zapis (npr. `task`) u store. */
  addRecord(model: string, row: FakeRecordRow): void {
    const rows = this.records.get(model) ?? [];
    rows.push(row);
    this.records.set(model, rows);
  }

  /** Broj zapisa koji koriste datu verziju (za `recordCount` u odgovoru). */
  setRecordCount(versionId: string, count: number): void {
    this.recordCounts.set(versionId, count);
  }

  /** Dodaje zapis za svaki od osam modela (testira se sabiranje). */
  addRecords(versionId: string, count: number, models = 2): void {
    for (let index = 0; index < models; index += 1) {
      this.recordCounts.set(versionId, (this.recordCounts.get(versionId) ?? 0) + count / models);
    }
  }

  private versionsOf(formSchemaId: string): FakeVersionRow[] {
    return [...this.versions.values()].filter((version) => version.formSchemaId === formSchemaId);
  }

  private enrich(row: FakeSchemaRow, include?: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...row };
    if (include?.['currentPublishedVersion']) {
      const current = row.currentPublishedVersionId ? this.versions.get(row.currentPublishedVersionId) : null;
      result['currentPublishedVersion'] = current ? { id: current.id, version: current.version } : null;
    }
    if (include?.['_count']) {
      result['_count'] = { versions: this.versionsOf(row.id).length };
    }
    return result;
  }

  private matchesSchema(row: FakeSchemaRow, where: Record<string, unknown>): boolean {
    if (where['deletedAt'] === null && row.deletedAt !== null) return false;
    if (typeof where['id'] === 'string' && row.id !== where['id']) return false;
    if (typeof where['subject'] === 'string' && row.subject !== where['subject']) return false;
    if ('taskTypeId' in where && row.taskTypeId !== where['taskTypeId']) return false;
    if (where['currentPublishedVersionId'] && row.currentPublishedVersionId === null) return false;

    const or = where['OR'] as Array<Record<string, { contains?: string }>> | undefined;
    if (or) {
      const query = (or[0]?.['name']?.contains ?? or[0]?.['key']?.contains ?? '').toLowerCase();
      if (!row.name.toLowerCase().includes(query) && !row.key.toLowerCase().includes(query)) return false;
    }

    const versionFilter = (where['versions'] as { some?: { status?: string } } | undefined)?.some;
    if (versionFilter?.status) {
      if (!this.versionsOf(row.id).some((version) => version.status === versionFilter.status)) return false;
    }
    return true;
  }

  readonly formSchema = {
    findMany: async (args: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      return [...this.schemas.values()]
        .filter((row) => this.matchesSchema(row, args.where ?? {}))
        .sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name))
        .map((row) => this.enrich(row, args.include));
    },

    findFirst: async (args: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const row = [...this.schemas.values()].find((candidate) =>
        this.matchesSchema(candidate, args.where ?? {}),
      );
      return row ? this.enrich(row, args.include) : null;
    },

    findUnique: async (args: { where: { key?: string; id?: string } }) => {
      for (const row of this.schemas.values()) {
        if (args.where.key !== undefined && row.key === args.where.key) return { ...row };
        if (args.where.id !== undefined && row.id === args.where.id) return { ...row };
      }
      return null;
    },

    create: async (args: { data: Record<string, unknown> }) => {
      const now = new Date('2026-10-20T09:00:00.000Z');
      const row: FakeSchemaRow = {
        id: String(args.data['id']),
        key: String(args.data['key']),
        name: String(args.data['name']),
        subject: String(args.data['subject']),
        taskTypeId: (args.data['taskTypeId'] as string | null) ?? null,
        description: (args.data['description'] as string | null) ?? null,
        ownerModule: (args.data['ownerModule'] as string | null) ?? null,
        status: 'ACTIVE',
        currentPublishedVersionId: null,
        createdById: (args.data['createdById'] as string | null) ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.schemas.set(row.id, row);
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.schemas.get(args.where.id);
      if (!row) throw new Error(`Forma ${args.where.id} ne postoji.`);
      Object.assign(row, args.data, { updatedAt: new Date('2026-10-20T10:00:00.000Z') });
      return { ...row };
    },
  };

  readonly formSchemaVersion = {
    findMany: async (args: { where?: { formSchemaId?: string } }) => {
      return [...this.versions.values()]
        .filter((row) => !args.where?.formSchemaId || row.formSchemaId === args.where.formSchemaId)
        .sort((a, b) => b.version - a.version)
        .map((row) => ({ ...row }));
    },

    findFirst: async (args: {
      where?: { formSchemaId?: string; status?: string; id?: string | { not?: string } };
      orderBy?: { version?: 'asc' | 'desc' };
      select?: Record<string, boolean>;
    }) => {
      const rows = [...this.versions.values()].filter((row) => {
        if (args.where?.formSchemaId && row.formSchemaId !== args.where.formSchemaId) return false;
        if (args.where?.status && row.status !== args.where.status) return false;
        if (typeof args.where?.id === 'string' && row.id !== args.where.id) return false;
        if (typeof args.where?.id === 'object' && args.where.id?.not && row.id === args.where.id.not) {
          return false;
        }
        return true;
      });
      rows.sort((a, b) => (args.orderBy?.version === 'desc' ? b.version - a.version : a.version - b.version));
      const row = rows[0];
      if (!row) return null;
      if (args.select) {
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, (row as never)[key]]));
      }
      return { ...row };
    },

    findUnique: async (args: { where: { id: string } }) => {
      const row = this.versions.get(args.where.id);
      return row ? { ...row } : null;
    },

    create: async (args: { data: Record<string, unknown> }) => {
      const row: FakeVersionRow = {
        id: String(args.data['id']),
        formSchemaId: String(args.data['formSchemaId']),
        version: Number(args.data['version']),
        status: (args.data['status'] as FakeVersionRow['status']) ?? 'DRAFT',
        definition: args.data['definition'],
        contentHash: (args.data['contentHash'] as string | null) ?? null,
        changeNote: (args.data['changeNote'] as string | null) ?? null,
        mobileCompatible: (args.data['mobileCompatible'] as boolean | undefined) ?? true,
        normalizedName: args.data['normalizedName'] ?? null,
        publishedAt: null,
        publishedById: null,
        retiredAt: null,
        retiredById: null,
        createdAt: new Date('2026-10-20T09:00:00.000Z'),
        createdById: (args.data['createdById'] as string | null) ?? null,
      };
      this.versions.set(row.id, row);
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.versions.get(args.where.id);
      if (!row) throw new Error(`Verzija ${args.where.id} ne postoji.`);
      Object.assign(row, args.data);
      return { ...row };
    },

    delete: async (args: { where: { id: string } }) => {
      const row = this.versions.get(args.where.id);
      if (!row) throw new Error(`Verzija ${args.where.id} ne postoji.`);
      this.versions.delete(args.where.id);
      return { ...row };
    },
  };

  readonly fieldKeyRegistry = {
    findUnique: async (args: { where: { key: string } }) => {
      const row = this.fieldKeys.get(args.where.key);
      return row ? { ...row } : null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const now = new Date('2026-10-20T09:00:00.000Z');
      const row: FakeFieldKeyRow = {
        id: String(args.data['id'] ?? randomUUID()),
        key: String(args.data['key']),
        dataType: String(args.data['dataType']),
        unit: (args.data['unit'] as string | null) ?? null,
        normalizedColumn: (args.data['normalizedColumn'] as string | null) ?? null,
        usedByFormSchemaIds: (args.data['usedByFormSchemaIds'] as string[] | undefined) ?? [],
        createdAt: now,
        updatedAt: now,
      };
      this.fieldKeys.set(row.key, row);
      return { ...row };
    },
    update: async (args: { where: { key: string }; data: Record<string, unknown> }) => {
      const row = this.fieldKeys.get(args.where.key);
      if (!row) throw new Error(`Ključ ${args.where.key} nije u registru.`);
      Object.assign(row, args.data);
      return { ...row };
    },
  };

  /**
   * Modeli zapisa: `groupBy` (broj zapisa po verziji) + ono što migracija treba
   * (`findMany` po formi/verziji, `update` zapisa).
   */
  private recordDelegateFor(model: string): RecordDelegate {
    return {
      groupBy: async (args) => {
        const rows: Record<string, unknown>[] = [];
        for (const versionId of args.where.formSchemaVersionId.in) {
          const count = this.recordCounts.get(versionId);
          if (!count) continue;
          rows.push({ formSchemaVersionId: versionId, _count: { _all: Math.round(count) } });
        }
        return rows;
      },

      findMany: async (args) => {
        const rows = this.records.get(model) ?? [];
        return rows
          .filter((row) => {
            if (args.where['formSchemaId'] && row.formSchemaId !== args.where['formSchemaId']) return false;
            if (
              args.where['formSchemaVersionId'] &&
              row.formSchemaVersionId !== args.where['formSchemaVersionId']
            ) {
              return false;
            }
            const idFilter = args.where['id'] as { in?: readonly string[] } | undefined;
            if (idFilter?.in && !idFilter.in.includes(row.id)) return false;
            return true;
          })
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((row) => ({ ...row }));
      },

      update: async (args) => {
        const rows = this.records.get(model) ?? [];
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row) throw new Error(`FakePrisma: zapis ${args.where.id} (${model}) ne postoji.`);
        Object.assign(row, args.data);
        return { ...row };
      },
    };
  }

  readonly task = this.recordDelegateFor('task');
  readonly vehicle = this.recordDelegateFor('vehicle');
  readonly registrationRecord = this.recordDelegateFor('registrationRecord');
  readonly insuranceRecord = this.recordDelegateFor('insuranceRecord');
  readonly serviceRecord = this.recordDelegateFor('serviceRecord');
  readonly driver = this.recordDelegateFor('driver');
  readonly tireSet = this.recordDelegateFor('tireSet');
  readonly tireInstallation = this.recordDelegateFor('tireInstallation');

  readonly formMigrationJob = {
    create: async (args: { data: Record<string, unknown> }) => {
      const now = new Date('2026-10-20T11:00:00.000Z');
      const row: FakeMigrationJobRow = {
        id: String(args.data['id']),
        formSchemaId: String(args.data['formSchemaId']),
        fromVersionId: String(args.data['fromVersionId']),
        toVersionId: String(args.data['toVersionId']),
        targetEntityType: String(args.data['targetEntityType']),
        targetEntityIds: (args.data['targetEntityIds'] as string[] | undefined) ?? [],
        filter: args.data['filter'] ?? null,
        status: 'PENDING',
        previewResult: null,
        summary: null,
        notes: (args.data['notes'] as string | null) ?? null,
        requestedById: (args.data['requestedById'] as string | null) ?? null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
      };
      this.migrationJobs.set(row.id, row);
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.migrationJobs.get(args.where.id);
      if (!row) throw new Error(`FakePrisma: migracija ${args.where.id} ne postoji.`);
      const data = { ...args.data };
      if (data['filter'] === undefined) delete data['filter'];
      if (data['previewResult'] === undefined) delete data['previewResult'];
      Object.assign(row, data);
      return { ...row };
    },

    findUnique: async (args: { where: { id: string } }) => {
      const row = this.migrationJobs.get(args.where.id);
      return row ? { ...row } : null;
    },

    findMany: async (args?: { where?: { formSchemaId?: string } }) => {
      return [...this.migrationJobs.values()]
        .filter((row) => !args?.where?.formSchemaId || row.formSchemaId === args.where.formSchemaId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({ ...row }));
    },
  };

  readonly formMigrationItem = {
    upsert: async (args: {
      where: { jobId_entityId: { jobId: string; entityId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = `${args.where.jobId_entityId.jobId}:${args.where.jobId_entityId.entityId}`;
      const existing = this.migrationItems.get(key);
      if (existing) {
        Object.assign(existing, args.update);
        return { ...existing };
      }
      const row: FakeMigrationItemRow = {
        id: String(args.create['id']),
        jobId: String(args.create['jobId']),
        entityId: String(args.create['entityId']),
        before: args.create['before'] ?? null,
        after: args.create['after'] ?? null,
        status: String(args.create['status'] ?? 'PENDING'),
        error: (args.create['error'] as string | null) ?? null,
        processedAt: (args.create['processedAt'] as Date | null) ?? null,
      };
      this.migrationItems.set(key, row);
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...this.migrationItems.values()].find((item) => item.id === args.where.id);
      if (!row) throw new Error(`FakePrisma: stavka migracije ${args.where.id} ne postoji.`);
      Object.assign(row, args.data);
      return { ...row };
    },

    findMany: async (args: {
      where: { jobId: string; status?: string; entityId?: { in: readonly string[] } };
      take?: number;
    }) => {
      return [...this.migrationItems.values()]
        .filter((row) => row.jobId === args.where.jobId)
        .filter((row) => !args.where.status || row.status === args.where.status)
        .filter((row) => !args.where.entityId?.in || args.where.entityId.in.includes(row.entityId))
        .slice(0, args.take ?? undefined)
        .map((row) => ({ ...row }));
    },
  };

  readonly $transaction = async <T>(fn: (tx: FakeFormPrisma) => Promise<T>): Promise<T> => fn(this);
}

export function asPrisma(fake: FakeFormPrisma): PrismaService {
  return fake as unknown as PrismaService;
}
