/**
 * `FormMigrationsService` — eksplicitna migracija zapisa između verzija forme
 * (docs/04 §10, P12).
 *
 * Zašto ovako:
 *
 * 1. **Nikad automatski.** Bere se `preview` → Super Admin pregleda diff →
 *    `apply` s bilješkom. Ništa se ne mijenja dok čovjek ne potvrdi.
 * 2. **Zapis koji ne prolazi novu verziju se preskače**, ne prepisuje se. Stara
 *    verzija ostaje, pa podaci nisu izgubljeni (`skipped` u summary-ju).
 * 3. **`before` snapshot ide u `FormMigrationItem`** prije izmjene, a
 *    `unique(jobId, entityId)` čini ponovni `apply` idempotentnim.
 * 4. **Batch od 500 zapisa u jednoj transakciji** — velika migracija ne drži
 *    zaključanu cijelu bazu, a djelimični pad ostavlja job u `RUNNING` s tačnim
 *    brojem obrađenih.
 * 5. **Rollback vraća `before`** (i `formData` i `formSchemaVersionId`) i piše
 *    `FormMigrationItem.status = 'ROLLED_BACK'`.
 *
 * Ograničenje: `apply` prvo učita ID-eve kandidata (jedan `SELECT id`), pa radi
 * u batch-evima. Za milionske tabele to bi bio keyset pagination posao; u VFM-u
 * su zapisi po formi hiljade, ne milioni.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { MigrationTargetEntity } from '@vfm/shared';
import { toLocalDateString } from '@vfm/shared';
import {
  NORMALIZATION_COLUMNS,
  parseDefinition,
  validateRecord,
  type FormDefinition,
  type RecordFieldError,
} from '@vfm/form-engine';
import type {
  CreateFormMigrationInput,
  FormMigrationJob,
  FormMigrationPreview,
  MigrationItemPreview,
  MigrationSummary,
  RollbackFormMigrationInput,
  RunFormMigrationInput,
} from '@vfm/shared/schemas';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Batch veličina (docs/04 §10, tačka 4). */
export const MIGRATION_BATCH_SIZE = 500;
/** Koliko zapisa preview vraća kao uzorak. */
export const PREVIEW_SAMPLE_SIZE = 50;

interface TargetSpec {
  /** Ime Prisma delegata. */
  readonly model: string;
  /** Dozvoljene normalizovane kolone (`04` §7). */
  readonly columns: readonly string[];
}

/**
 * Whitelist ciljeva migracije — model mora imati `formData`,
 * `formSchemaVersionId` i normalizovane kolone koje forma može mapirati.
 */
export const MIGRATION_TARGETS: Readonly<Record<MigrationTargetEntity, TargetSpec>> = {
  TASK: { model: 'task', columns: NORMALIZATION_COLUMNS['TASK'] ?? [] },
  VEHICLE: { model: 'vehicle', columns: NORMALIZATION_COLUMNS['VEHICLE'] ?? [] },
  SERVICE: { model: 'serviceRecord', columns: NORMALIZATION_COLUMNS['SERVICE'] ?? [] },
  REGISTRATION: {
    model: 'registrationRecord',
    columns: NORMALIZATION_COLUMNS['REGISTRATION'] ?? [],
  },
  INSURANCE: { model: 'insuranceRecord', columns: NORMALIZATION_COLUMNS['INSURANCE'] ?? [] },
  TIRE_INSTALLATION: {
    model: 'tireInstallation',
    columns: NORMALIZATION_COLUMNS['TIRE_INSTALLATION'] ?? [],
  },
  DRIVER: { model: 'driver', columns: [] },
  TIRE_SET: { model: 'tireSet', columns: [] },
};

/** Red zapisa koji migracija dira (podskup kolona svih modela). */
interface RecordRow {
  readonly id: string;
  readonly formSchemaId: string;
  readonly formSchemaVersionId: string | null;
  readonly formData: Prisma.JsonValue;
  readonly createdAt: Date;
  readonly [column: string]: unknown;
}

interface RecordDelegate {
  findMany: (args: {
    where: Record<string, unknown>;
    select?: Record<string, boolean>;
    take?: number;
    skip?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }) => Promise<RecordRow[]>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<RecordRow>;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

@Injectable()
export class FormMigrationsService {
  private readonly logger = new Logger(FormMigrationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Kreiranje i čitanje
  // ---------------------------------------------------------------------------

  async create(input: CreateFormMigrationInput, actorId?: string): Promise<FormMigrationJob> {
    const [from, to] = await Promise.all([
      this.prisma.formSchemaVersion.findFirst({
        where: { id: input.fromVersionId, formSchemaId: input.formSchemaId },
      }),
      this.prisma.formSchemaVersion.findFirst({
        where: { id: input.toVersionId, formSchemaId: input.formSchemaId },
      }),
    ]);

    if (!from) throw VfmErrors.notFound('Izvorna verzija forme ne postoji u ovoj formi.');
    if (!to) throw VfmErrors.notFound('Ciljna verzija forme ne postoji u ovoj formi.');
    if (from.status === 'DRAFT') {
      throw new VfmException('FORM_VERSION_NOT_PUBLISHED', 'Zapisi se migriraju samo s objavljene verzije.');
    }
    if (to.status !== 'PUBLISHED') {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Ciljna verzija mora biti objavljena (objavi je prije migracije).',
      );
    }

    const job = await this.prisma.formMigrationJob.create({
      data: {
        id: randomUUID(),
        formSchemaId: input.formSchemaId,
        fromVersionId: input.fromVersionId,
        toVersionId: input.toVersionId,
        targetEntityType: input.targetEntityType,
        targetEntityIds: input.entityIds ?? [],
        filter: input.filter ? asJson(input.filter) : undefined,
        status: 'PENDING',
        notes: input.notes ?? null,
        requestedById: actorId ?? null,
      },
    });

    return this.toJob(job);
  }

  async list(formSchemaId?: string): Promise<FormMigrationJob[]> {
    const rows = await this.prisma.formMigrationJob.findMany({
      where: formSchemaId ? { formSchemaId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toJob(row));
  }

  async get(jobId: string): Promise<FormMigrationPreview> {
    const job = await this.loadJobOrThrow(jobId);
    const items = await this.prisma.formMigrationItem.findMany({
      where: { jobId },
      take: PREVIEW_SAMPLE_SIZE,
    });

    return {
      ...this.toJob(job),
      summary: (job.summary as MigrationSummary | null) ?? this.emptySummary(),
      items: items.map((item) => ({
        entityId: item.entityId,
        before: item.before as Record<string, unknown> | null,
        after: item.after as Record<string, unknown> | null,
        status: item.status,
        errors: [],
      })),
    };
  }

  // ---------------------------------------------------------------------------
  //  Preview
  // ---------------------------------------------------------------------------

  async preview(jobId: string): Promise<FormMigrationPreview> {
    const job = await this.loadJobOrThrow(jobId);
    if (job.status === 'RUNNING' || job.status === 'COMPLETED' || job.status === 'ROLLED_BACK') {
      throw new VfmException('VALIDATION_ERROR', `Migracija je u stanju ${job.status} — preview nije moguć.`);
    }

    const { fromVersion, toVersion, definition } = await this.loadVersionsOrThrow(job);
    const records = await this.loadCandidateRecords(job, fromVersion.id);

    const items: MigrationItemPreview[] = [];
    let ok = 0;
    let failed = 0;

    for (const record of records) {
      const result = this.evaluateRecord(definition, toVersion, record);
      if (result.errors.length === 0) ok += 1;
      else failed += 1;

      if (items.length < PREVIEW_SAMPLE_SIZE) {
        items.push({
          entityId: record.id,
          before: asRecord(record.formData),
          after: result.errors.length === 0 ? result.after : null,
          status: result.errors.length === 0 ? 'OK' : 'ERROR',
          errors: result.errors.map((error) => ({ ...error })),
        });
      }
    }

    const summary: MigrationSummary = { total: records.length, ok, failed, skipped: 0 };
    const previewUpdate = await this.prisma.formMigrationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: {
        status: 'PREVIEW',
        previewResult: asJson({ summary, sample: items.length }),
        summary: asJson(summary),
      },
    });
    if (previewUpdate.count !== 1) {
      throw new VfmException(
        'VALIDATION_ERROR',
        'Stanje migracije se promijenilo tokom pregleda; pokrenite preview ponovo.',
      );
    }

    this.logger.log(`Migracija ${job.id}: preview ${ok}/${records.length} prolazi.`);
    return {
      ...this.toJob({ ...job, status: 'PREVIEW', summary: summary as unknown as Prisma.JsonValue }),
      summary,
      items,
    };
  }

  // ---------------------------------------------------------------------------
  //  Apply i rollback
  // ---------------------------------------------------------------------------

  async apply(jobId: string, input: RunFormMigrationInput): Promise<FormMigrationJob> {
    const job = await this.loadJobOrThrow(jobId);
    if (job.status !== 'PREVIEW') {
      throw new VfmException(
        'VALIDATION_ERROR',
        `Migracija mora imati pregled prije primjene (trenutno stanje: ${job.status}).`,
      );
    }
    if (input.changeNote.trim().length < 5) {
      throw VfmErrors.validationError([{ path: ['changeNote'], message: 'Bilješka je obavezna.' }]);
    }

    const { fromVersion, toVersion, definition } = await this.loadVersionsOrThrow(job);
    const target = MIGRATION_TARGETS[job.targetEntityType as MigrationTargetEntity];
    const records = await this.loadCandidateRecords(job, fromVersion.id);

    const startedAt = new Date();
    const claim = await this.prisma.formMigrationJob.updateMany({
      where: { id: job.id, status: 'PREVIEW' },
      data: { status: 'RUNNING', startedAt, notes: input.changeNote.trim() },
    });
    if (claim.count !== 1) {
      throw new VfmException(
        'VALIDATION_ERROR',
        'Migracija je već pokrenuta ili više nije u stanju PREVIEW.',
      );
    }

    let ok = 0;
    let skipped = 0;

    for (let offset = 0; offset < records.length; offset += MIGRATION_BATCH_SIZE) {
      const batch = records.slice(offset, offset + MIGRATION_BATCH_SIZE);

      await this.prisma.$transaction(async (tx) => {
        for (const record of batch) {
          const result = this.evaluateRecord(definition, toVersion, record);

          if (result.errors.length > 0) {
            // Neuspjeli zapis ostaje na staroj verziji — nikad se ne gubi podatak.
            await tx.formMigrationItem.upsert({
              where: { jobId_entityId: { jobId: job.id, entityId: record.id } },
              create: {
                id: randomUUID(),
                jobId: job.id,
                entityId: record.id,
                before: asJson(this.snapshot(record, target)),
                status: 'SKIPPED',
                error: result.errors.map((error) => `${error.key}: ${error.code}`).join('; '),
                processedAt: new Date(),
              },
              update: {
                status: 'SKIPPED',
                error: result.errors.map((error) => `${error.key}: ${error.code}`).join('; '),
                processedAt: new Date(),
              },
            });
            skipped += 1;
            continue;
          }

          await tx.formMigrationItem.upsert({
            where: { jobId_entityId: { jobId: job.id, entityId: record.id } },
            create: {
              id: randomUUID(),
              jobId: job.id,
              entityId: record.id,
              before: asJson(this.snapshot(record, target)),
              after: asJson({ formData: result.after, normalized: result.normalized }),
              status: 'APPLIED',
              processedAt: new Date(),
            },
            update: {
              status: 'APPLIED',
              after: asJson({ formData: result.after, normalized: result.normalized }),
              error: null,
              processedAt: new Date(),
            },
          });

          const txDelegate = (tx as unknown as Record<string, RecordDelegate>)[target.model]!;
          await txDelegate.update({
            where: { id: record.id },
            data: {
              formData: asJson(result.after),
              formSchemaVersionId: toVersion.id,
              ...this.normalizedColumns(target, result.normalized),
            },
          });
          ok += 1;
        }
      });
    }

    const summary: MigrationSummary = { total: records.length, ok, failed: skipped, skipped };
    const finishedAt = new Date();
    await this.prisma.formMigrationJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt,
        summary: asJson(summary),
        previewResult: job.previewResult ?? undefined,
      },
    });

    this.logger.log(`Migracija ${job.id}: primijenjeno ${ok}, preskočeno ${skipped}.`);
    return this.toJob({
      ...job,
      status: 'COMPLETED',
      summary: summary as unknown as Prisma.JsonValue,
      finishedAt,
    });
  }

  async rollback(jobId: string, input: RollbackFormMigrationInput): Promise<FormMigrationJob> {
    const job = await this.loadJobOrThrow(jobId);
    if (job.status !== 'COMPLETED') {
      throw new VfmException(
        'VALIDATION_ERROR',
        `Rollback je moguć samo za završenu migraciju (stanje: ${job.status}).`,
      );
    }

    const target = MIGRATION_TARGETS[job.targetEntityType as MigrationTargetEntity];
    const delegate = this.recordDelegate(target);

    const appliedItems = await this.prisma.formMigrationItem.findMany({
      where: { jobId: job.id, status: 'APPLIED' },
    });
    const requestedIds = input.entityIds?.length ? new Set(input.entityIds) : null;
    const items = requestedIds
      ? appliedItems.filter((item) => requestedIds.has(item.entityId))
      : appliedItems;
    if (items.length === 0) {
      throw new VfmException('VALIDATION_ERROR', 'Nema primijenjenih zapisa za rollback u ovom izboru.');
    }

    let restored = 0;
    for (let offset = 0; offset < items.length; offset += MIGRATION_BATCH_SIZE) {
      const batch = items.slice(offset, offset + MIGRATION_BATCH_SIZE);

      await this.prisma.$transaction(async (tx) => {
        for (const item of batch) {
          const snapshot = item.before as Record<string, unknown> | null;
          if (!snapshot) continue;

          await delegate.update({
            where: { id: item.entityId },
            data: {
              formData: asJson(snapshot['formData'] ?? {}),
              formSchemaVersionId: snapshot['formSchemaVersionId'] ?? null,
              ...this.normalizedColumns(target, (snapshot['normalized'] as Record<string, unknown>) ?? {}),
            },
          });

          await tx.formMigrationItem.update({
            where: { id: item.id },
            data: { status: 'ROLLED_BACK', processedAt: new Date() },
          });
          restored += 1;
        }
      });
    }

    const remaining = appliedItems.length - restored;
    const fullyRolledBack = remaining === 0;
    const finishedAt = fullyRolledBack ? new Date() : job.finishedAt;
    await this.prisma.formMigrationJob.update({
      where: { id: job.id },
      data: {
        status: fullyRolledBack ? 'ROLLED_BACK' : 'COMPLETED',
        ...(fullyRolledBack ? { finishedAt } : {}),
        notes: input.changeNote.trim(),
      },
    });

    this.logger.log(`Migracija ${job.id}: vraćeno ${restored}; preostalo primijenjeno ${remaining}.`);
    return this.toJob({
      ...job,
      status: fullyRolledBack ? 'ROLLED_BACK' : 'COMPLETED',
      finishedAt: finishedAt ?? null,
      notes: input.changeNote.trim(),
    });
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne metode
  // ---------------------------------------------------------------------------

  private async loadJobOrThrow(jobId: string) {
    const job = await this.prisma.formMigrationJob.findUnique({ where: { id: jobId } });
    if (!job) throw VfmErrors.notFound('Migracija ne postoji.');
    return job;
  }

  private async loadVersionsOrThrow(job: {
    formSchemaId: string;
    fromVersionId: string;
    toVersionId: string;
  }): Promise<{
    fromVersion: { id: string; version: number };
    toVersion: { id: string; version: number; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' };
    definition: FormDefinition;
  }> {
    const [fromVersion, toVersion] = await Promise.all([
      this.prisma.formSchemaVersion.findUnique({ where: { id: job.fromVersionId } }),
      this.prisma.formSchemaVersion.findUnique({ where: { id: job.toVersionId } }),
    ]);
    if (!fromVersion || !toVersion) throw VfmErrors.notFound('Verzija forme ne postoji.');

    const parsed = parseDefinition(toVersion.definition);
    if (!parsed.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Ciljna verzija u bazi nije ispravna.',
        parsed.issues.map((issue) => ({ path: [issue.path], message: issue.message })),
      );
    }

    return {
      fromVersion: { id: fromVersion.id, version: fromVersion.version },
      toVersion: {
        id: toVersion.id,
        version: toVersion.version,
        status: toVersion.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
      },
      definition: parsed.definition,
    };
  }

  private recordDelegate(target: TargetSpec): RecordDelegate {
    return (this.prisma as unknown as Record<string, RecordDelegate>)[target.model]!;
  }

  private async loadCandidateRecords(
    job: {
      formSchemaId: string;
      targetEntityType: string;
      targetEntityIds: string[];
      filter: Prisma.JsonValue | null;
    },
    fromVersionId: string,
  ): Promise<RecordRow[]> {
    const target = MIGRATION_TARGETS[job.targetEntityType as MigrationTargetEntity];
    const delegate = this.recordDelegate(target);
    const filter = asRecord(job.filter);

    const where: Record<string, unknown> = {
      formSchemaId: job.formSchemaId,
      formSchemaVersionId: fromVersionId,
    };
    if (job.targetEntityIds.length > 0) where['id'] = { in: job.targetEntityIds };
    if (filter['createdFrom'] || filter['createdTo']) {
      where['createdAt'] = {
        ...(filter['createdFrom'] ? { gte: new Date(String(filter['createdFrom'])) } : {}),
        ...(filter['createdTo'] ? { lte: new Date(String(filter['createdTo'])) } : {}),
      };
    }

    return delegate.findMany({ where, orderBy: { id: 'asc' } });
  }

  /** Validira zapis prema ciljnoj verziji — isti engine kao P11. */
  private evaluateRecord(
    definition: FormDefinition,
    toVersion: { id: string; version: number; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' },
    record: RecordRow,
  ): {
    errors: readonly RecordFieldError[];
    after: Record<string, unknown>;
    normalized: Record<string, unknown>;
  } {
    const result = validateRecord({
      version: {
        id: toVersion.id,
        version: toVersion.version,
        status: toVersion.status,
        definition,
      },
      values: asRecord(record.formData),
      isNew: false,
      today: toLocalDateString(new Date()),
    });

    return { errors: result.errors, after: { ...result.values }, normalized: { ...result.normalized } };
  }

  private snapshot(record: RecordRow, target: TargetSpec): Record<string, unknown> {
    const normalized = Object.fromEntries(
      target.columns
        .filter((column) => Object.prototype.hasOwnProperty.call(record, column))
        .map((column) => [column, record[column]]),
    );
    return {
      formData: asRecord(record.formData),
      formSchemaVersionId: record.formSchemaVersionId,
      normalized,
    };
  }

  /**
   * Samo kolone koje model stvarno ima (whitelist iz `04` §7) — migracija ne
   * smije pisati u proizvoljnu kolonu, čak ni ako je definicija tako mapirana.
   */
  private normalizedColumns(
    target: TargetSpec,
    normalized: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(normalized)) {
      if (!target.columns.includes(column)) continue;
      data[column] = value;
    }
    return data;
  }

  private emptySummary(): MigrationSummary {
    return { total: 0, ok: 0, failed: 0, skipped: 0 };
  }

  private toJob(row: {
    id: string;
    formSchemaId: string;
    fromVersionId: string;
    toVersionId: string;
    targetEntityType: string;
    status: string;
    summary: Prisma.JsonValue | null;
    notes: string | null;
    requestedById: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): FormMigrationJob {
    return {
      id: row.id,
      formSchemaId: row.formSchemaId,
      fromVersionId: row.fromVersionId,
      toVersionId: row.toVersionId,
      targetEntityType: row.targetEntityType as MigrationTargetEntity,
      status: row.status as FormMigrationJob['status'],
      summary: (row.summary as MigrationSummary | null) ?? null,
      notes: row.notes,
      requestedById: row.requestedById,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
