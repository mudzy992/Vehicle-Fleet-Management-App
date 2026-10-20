/**
 * `FormSchemasService` — katalog formi i životni ciklus verzija
 * (docs/04 §8, §12; docs/07 §2.9).
 *
 * Pravila koja servis sprovodi:
 *
 * 1. **Definicija se validira pri svakom upisu** (`parseDefinition`) — nevalidan
 *    JSON ne može ni u `DRAFT`, pa greška nikad ne čeka objavu.
 * 2. **`DRAFT` je jedino stanje koje se mijenja/briše.** `PUBLISHED`/`RETIRED` su
 *    nepromjenjivi (`FORM_VERSION_IMMUTABLE`), a DB trigger to čuva i mimo API-ja.
 * 3. **Objava je jedna transakcija:** prethodna `PUBLISHED` → `RETIRED`, nova
 *    verzija → `PUBLISHED` (+ `contentHash`, `changeNote`, `mobileCompatible`),
 *    `FormSchema.currentPublishedVersionId`, i registar ključeva
 *    (`FieldKeyRegistry` — U-16: isti ključ = isti tip u svim formama).
 * 4. **Tačno jedna aktivna verzija po formi** — novo objavljivanje povlači staru,
 *    pa `active` upit uvijek vraća jednu definiciju.
 * 5. **Zapisi se nikad ne prepisuju** — `validateRecord()` radi nad tačnom
 *    verzijom koju zapis nosi (P11); stara verzija ostaje za validaciju starih
 *    zapisa.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ApiErrorDetail, FormSchemaStatus } from '@vfm/shared';
import { toLocalDateString } from '@vfm/shared';
import {
  checkPublishable,
  contentHash,
  definitionETag,
  diffDefinitions,
  parseDefinition,
  validateRecord,
  type DefinitionIssue,
  type FormDefinition,
  type FormSchemaVersionStatus,
} from '@vfm/form-engine';
import type {
  ActiveFormSchema,
  ActiveFormSchemaQuery,
  CreateFormSchemaInput,
  CreateFormVersionInput,
  FormSchemaDetail,
  FormSchemaListQuery,
  FormSchemaSummary,
  FormVersionDetail,
  FormVersionDiff,
  FormVersionSummary,
  PublishFormVersionInput,
  RetireFormVersionInput,
  UpdateFormSchemaInput,
  UpdateFormVersionInput,
  ValidateFormValuesInput,
  FormValidationResponse,
} from '@vfm/shared/schemas';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import { syncFieldKeys, type FieldKeyRegistryClient } from './field-key-registry.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Rezultat mutacije + `before`/`after` za `AuditContext`. */
export interface FormSchemaMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Modeli koji nose `formSchemaVersionId` (broj zapisa po verziji). */
const RECORD_MODELS = [
  'task',
  'vehicle',
  'registrationRecord',
  'insuranceRecord',
  'serviceRecord',
  'driver',
  'tireSet',
  'tireInstallation',
] as const;

type VersionRow = {
  id: string;
  formSchemaId: string;
  version: number;
  status: FormSchemaStatus;
  definition: Prisma.JsonValue;
  contentHash: string | null;
  changeNote: string | null;
  mobileCompatible: boolean;
  normalizedName: Prisma.JsonValue | null;
  publishedAt: Date | null;
  publishedById: string | null;
  retiredAt: Date | null;
  createdAt: Date;
};

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function issuesToDetails(issues: readonly DefinitionIssue[]): ApiErrorDetail[] {
  return issues.map((issue) => ({ path: [issue.path], message: `${issue.code}: ${issue.message}` }));
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class FormSchemasService {
  private readonly logger = new Logger(FormSchemasService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: FormSchemaListQuery): Promise<FormSchemaSummary[]> {
    const rows = await this.prisma.formSchema.findMany({
      where: {
        deletedAt: null,
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { key: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.status
          ? query.status === 'DRAFT'
            ? { versions: { some: { status: 'DRAFT' } } }
            : { versions: { some: { status: query.status } } }
          : {}),
      },
      orderBy: [{ subject: 'asc' }, { name: 'asc' }],
      include: {
        currentPublishedVersion: { select: { id: true, version: true } },
        _count: { select: { versions: true } },
      },
    });

    return rows.map((row) => this.toSummary(row));
  }

  async get(formSchemaId: string): Promise<FormSchemaDetail> {
    const row = await this.loadSchemaOrThrow(formSchemaId);
    const versions = await this.prisma.formSchemaVersion.findMany({
      where: { formSchemaId },
      orderBy: { version: 'desc' },
    });
    const counts = await this.loadRecordCounts(versions.map((version) => version.id));

    return {
      ...this.toSummary(row),
      versions: versions.map((version) => this.toVersionSummary(version, counts.get(version.id) ?? 0)),
    };
  }

  /** Definicija jedne verzije (ETag = `contentHash`, docs/04 §11). */
  async getVersion(formSchemaId: string, versionId: string): Promise<FormVersionDetail> {
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);
    const definition = this.parseStoredDefinition(version);
    const counts = await this.loadRecordCounts([version.id]);

    return {
      ...this.toVersionSummary(version, counts.get(version.id) ?? 0),
      formSchemaId: version.formSchemaId,
      definition: definition as unknown as Record<string, unknown>,
      normalizedName: (version.normalizedName as Record<string, unknown>[] | null) ?? null,
    };
  }

  /** `GET /form-schemas/active` — aktivna verzija za subject (i tip zadatka). */
  async active(query: ActiveFormSchemaQuery): Promise<ActiveFormSchema> {
    const base = { deletedAt: null, subject: query.subject, currentPublishedVersionId: { not: null } };

    let row = query.taskTypeId
      ? await this.prisma.formSchema.findFirst({ where: { ...base, taskTypeId: query.taskTypeId } })
      : await this.prisma.formSchema.findFirst({ where: { ...base, taskTypeId: null } });

    // Fallback: generička forma za subject kad tip zadatka nema svoju.
    if (!row && query.taskTypeId) {
      row = await this.prisma.formSchema.findFirst({ where: { ...base, taskTypeId: null } });
    }
    if (!row || !row.currentPublishedVersionId) {
      throw VfmErrors.notFound('Nema aktivne forme za traženi subjekt.');
    }

    const version = await this.prisma.formSchemaVersion.findUnique({
      where: { id: row.currentPublishedVersionId },
    });
    if (!version) throw VfmErrors.notFound('Aktivna verzija forme ne postoji.');

    const definition = this.parseStoredDefinition(version);
    return {
      formSchemaId: row.id,
      key: row.key,
      name: row.name,
      subject: row.subject,
      formSchemaVersionId: version.id,
      version: version.version,
      contentHash: version.contentHash ?? definitionETag(definition),
      mobileCompatible: version.mobileCompatible,
      definition: definition as unknown as Record<string, unknown>,
    };
  }

  /** Strukturni diff dvije verzije iste forme (`GET .../diff?from=&to=`). */
  async diff(formSchemaId: string, fromVersionId: string, toVersionId: string): Promise<FormVersionDiff> {
    const [fromRow, toRow] = await Promise.all([
      this.loadVersionOrThrow(formSchemaId, fromVersionId),
      this.loadVersionOrThrow(formSchemaId, toVersionId),
    ]);

    const diff = diffDefinitions(this.parseStoredDefinition(fromRow), this.parseStoredDefinition(toRow));
    // `diffDefinitions` vraća `readonly` nizove, a DTO je mutable — kopira se.
    return {
      from: { id: fromRow.id, version: fromRow.version },
      to: { id: toRow.id, version: toRow.version },
      meta: diff.meta.map((change) => ({ ...change })),
      addedFields: [...diff.addedFields],
      removedFields: [...diff.removedFields],
      changedFields: diff.changedFields.map((field) => ({
        key: field.key,
        label: field.label,
        changes: field.changes.map((change) => ({ ...change })),
      })),
      addedSections: [...diff.addedSections],
      removedSections: [...diff.removedSections],
      normalizationChanged: diff.normalizationChanged,
      empty: diff.empty,
    };
  }

  // ---------------------------------------------------------------------------
  //  Pisanje
  // ---------------------------------------------------------------------------

  async create(
    input: CreateFormSchemaInput,
    actorId?: string,
  ): Promise<FormSchemaMutation<FormSchemaDetail>> {
    const existing = await this.prisma.formSchema.findUnique({ where: { key: input.key } });
    if (existing) {
      throw VfmErrors.validationError([detail('key', `Forma s ključem "${input.key}" već postoji.`)]);
    }

    const definition = this.parseInputDefinition(input.definition);
    const formSchemaId = randomUUID();
    const versionId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.formSchema.create({
        data: {
          id: formSchemaId,
          key: input.key,
          name: input.name,
          subject: input.subject,
          taskTypeId: input.taskTypeId ?? null,
          description: input.description ?? null,
          ownerModule: input.ownerModule ?? null,
          createdById: actorId ?? null,
        },
      });
      await tx.formSchemaVersion.create({
        data: {
          id: versionId,
          formSchemaId,
          version: 1,
          status: 'DRAFT',
          definition: asJson(definition),
          normalizedName: asJson(definition.normalizedName ?? []),
          contentHash: contentHash(definition),
          mobileCompatible: true,
          createdById: actorId ?? null,
        },
      });
    });

    this.logger.log(`Forma ${input.key} kreirana (${formSchemaId}), draft verzija 1.`);
    return {
      data: await this.get(formSchemaId),
      after: { key: input.key, name: input.name, subject: input.subject, status: 'DRAFT' },
    };
  }

  async update(
    formSchemaId: string,
    input: UpdateFormSchemaInput,
    actorId?: string,
  ): Promise<FormSchemaMutation<FormSchemaDetail>> {
    const row = await this.loadSchemaOrThrow(formSchemaId);
    void actorId;

    await this.prisma.formSchema.update({
      where: { id: formSchemaId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.taskTypeId !== undefined ? { taskTypeId: input.taskTypeId } : {}),
        ...(input.ownerModule !== undefined ? { ownerModule: input.ownerModule } : {}),
      },
    });

    return {
      data: await this.get(formSchemaId),
      before: { name: row.name, description: row.description, taskTypeId: row.taskTypeId },
      after: {
        name: input.name ?? row.name,
        description: input.description ?? row.description,
        taskTypeId: input.taskTypeId ?? row.taskTypeId,
      },
    };
  }

  async createVersion(
    formSchemaId: string,
    input: CreateFormVersionInput,
    actorId?: string,
  ): Promise<FormSchemaMutation<FormVersionDetail>> {
    await this.loadSchemaOrThrow(formSchemaId);

    let definition: FormDefinition;
    if (input.copyFromVersionId) {
      const source = await this.loadVersionOrThrow(formSchemaId, input.copyFromVersionId);
      definition = this.parseStoredDefinition(source);
    } else {
      definition = this.parseInputDefinition(input.definition);
    }

    const latest = await this.prisma.formSchemaVersion.findFirst({
      where: { formSchemaId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const versionId = randomUUID();

    await this.prisma.formSchemaVersion.create({
      data: {
        id: versionId,
        formSchemaId,
        version: nextVersion,
        status: 'DRAFT',
        definition: asJson(definition),
        normalizedName: asJson(definition.normalizedName ?? []),
        contentHash: contentHash(definition),
        mobileCompatible: true,
        createdById: actorId ?? null,
      },
    });

    return {
      data: await this.getVersion(formSchemaId, versionId),
      after: { formSchemaId, version: nextVersion, status: 'DRAFT' },
    };
  }

  async updateVersion(
    formSchemaId: string,
    versionId: string,
    input: UpdateFormVersionInput,
  ): Promise<FormSchemaMutation<FormVersionDetail>> {
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);
    this.assertDraft(version);

    const before = this.parseStoredDefinition(version);
    const definition = this.parseInputDefinition(input.definition);

    await this.prisma.formSchemaVersion.update({
      where: { id: versionId },
      data: {
        definition: asJson(definition),
        normalizedName: asJson(definition.normalizedName ?? []),
        contentHash: contentHash(definition),
      },
    });

    return {
      data: await this.getVersion(formSchemaId, versionId),
      before: { version: version.version, contentHash: contentHash(before) },
      after: { version: version.version, contentHash: contentHash(definition) },
    };
  }

  async deleteVersion(formSchemaId: string, versionId: string): Promise<void> {
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);
    this.assertDraft(version);

    await this.prisma.formSchemaVersion.delete({ where: { id: versionId } });
  }

  // ---------------------------------------------------------------------------
  //  Objava i povlačenje (§8)
  // ---------------------------------------------------------------------------

  async publish(
    formSchemaId: string,
    versionId: string,
    input: PublishFormVersionInput,
    actorId?: string,
  ): Promise<FormSchemaMutation<FormVersionDetail>> {
    const schema = await this.loadSchemaOrThrow(formSchemaId);
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);
    this.assertDraft(version);

    const definition = this.parseStoredDefinition(version);
    const previous = schema.currentPublishedVersionId
      ? await this.prisma.formSchemaVersion.findUnique({ where: { id: schema.currentPublishedVersionId } })
      : null;
    const previousDefinition = previous ? this.parseStoredDefinition(previous) : null;

    const checks = checkPublishable({
      definition,
      changeNote: input.changeNote,
      allowWebOnly: input.allowWebOnly,
      previousPublished: previousDefinition,
      confirmNormalizedRemoval: input.confirmNormalizedRemoval,
    });

    if (!checks.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `Verzija ${version.version} se ne može objaviti — ${checks.issues.length} problem(a).`,
        checks.issues.map((issue) => detail(issue.path, `${issue.code}: ${issue.message}`)),
        { formSchemaId, versionId, issues: checks.issues },
      );
    }

    const publishedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.formSchemaVersion.update({
          where: { id: previous.id },
          data: { status: 'RETIRED', retiredAt: publishedAt, retiredById: actorId ?? null },
        });
      }

      await tx.formSchemaVersion.update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          publishedAt,
          publishedById: actorId ?? null,
          changeNote: input.changeNote.trim(),
          contentHash: checks.contentHash,
          mobileCompatible: checks.mobileCompatible,
          normalizedName: asJson(definition.normalizedName ?? []),
        },
      });

      await tx.formSchema.update({
        where: { id: formSchemaId },
        data: { currentPublishedVersionId: versionId },
      });
    });

    await syncFieldKeys(this.prisma as unknown as FieldKeyRegistryClient, definition, formSchemaId, {
      onTypeConflict: (conflict) =>
        this.logger.warn(
          `Ključ "${conflict.key}" je u formi ${formSchemaId} tipa ${conflict.expected}, a registar ga vodi kao ${conflict.actual} (U-16).`,
        ),
    });

    this.logger.log(`Forma ${schema.key}: verzija ${version.version} objavljena.`);
    return {
      data: await this.getVersion(formSchemaId, versionId),
      before: previous ? { publishedVersion: previous.version } : { publishedVersion: null },
      after: { publishedVersion: version.version, changeNote: input.changeNote.trim() },
      meta: { contentHash: checks.contentHash, issues: [] },
    };
  }

  async retire(
    formSchemaId: string,
    versionId: string,
    input: RetireFormVersionInput,
    actorId?: string,
  ): Promise<FormSchemaMutation<FormVersionDetail>> {
    const schema = await this.loadSchemaOrThrow(formSchemaId);
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);

    if (version.status !== 'PUBLISHED') {
      throw new VfmException('FORM_VERSION_IMMUTABLE', 'Samo objavljena verzija se može povući.');
    }

    const isActive = schema.currentPublishedVersionId === versionId;
    const replacement = isActive
      ? await this.prisma.formSchemaVersion.findFirst({
          where: { formSchemaId, status: 'PUBLISHED', id: { not: versionId } },
          orderBy: { version: 'desc' },
        })
      : null;

    if (isActive && !replacement) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Aktivna verzija se ne može povući prije nego što druga verzija postane aktivna (objavi novu verziju).',
        [
          detail(
            '$',
            'Aktivna verzija se ne može povući prije nego što druga verzija postane aktivna (objavi novu verziju).',
          ),
        ],
      );
    }

    const retiredAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.formSchemaVersion.update({
        where: { id: versionId },
        data: {
          status: 'RETIRED',
          retiredAt,
          retiredById: actorId ?? null,
          changeNote: input.changeNote.trim(),
        },
      });
      if (replacement) {
        await tx.formSchema.update({
          where: { id: formSchemaId },
          data: { currentPublishedVersionId: replacement.id },
        });
      }
    });

    this.logger.log(`Forma ${schema.key}: verzija ${version.version} povučena.`);
    return {
      data: await this.getVersion(formSchemaId, versionId),
      before: { status: 'PUBLISHED' },
      after: { status: 'RETIRED', changeNote: input.changeNote.trim() },
    };
  }

  // ---------------------------------------------------------------------------
  //  Validacija zapisa prema verziji (P11)
  // ---------------------------------------------------------------------------

  /**
   * Server-side validacija `formValues` prema tačnoj verziji forme. Backend
   * nikad ne „pogađa" vrijednost: greške se vraćaju po polju, a izračunata polja
   * i normalizovane kolone dolaze iz engine-a.
   */
  async validateValues(
    formSchemaId: string,
    versionId: string,
    input: ValidateFormValuesInput,
  ): Promise<FormValidationResponse> {
    const version = await this.loadVersionOrThrow(formSchemaId, versionId);
    const definition = this.parseStoredDefinition(version);

    const result = validateRecord({
      version: {
        id: version.id,
        version: version.version,
        status: version.status as FormSchemaVersionStatus,
        definition,
      },
      values: input.values,
      isNew: input.isNew,
      today: toLocalDateString(new Date()),
    });

    return {
      ok: result.ok,
      formSchemaVersionId: version.id,
      formSchemaVersion: version.version,
      versionError: result.versionError,
      values: result.values,
      computed: result.computed,
      normalized: result.normalized,
      errors: result.errors.map((error) => ({ ...error })),
      warnings: result.warnings.map((warning) => ({
        key: warning.key,
        code: warning.code,
        message: warning.message,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne metode
  // ---------------------------------------------------------------------------

  private async loadSchemaOrThrow(formSchemaId: string) {
    const row = await this.prisma.formSchema.findFirst({
      where: { id: formSchemaId, deletedAt: null },
      include: {
        currentPublishedVersion: { select: { id: true, version: true } },
        _count: { select: { versions: true } },
      },
    });
    if (!row) throw VfmErrors.notFound('Forma ne postoji.');
    return row;
  }

  private async loadVersionOrThrow(formSchemaId: string, versionId: string): Promise<VersionRow> {
    const version = await this.prisma.formSchemaVersion.findFirst({
      where: { id: versionId, formSchemaId },
    });
    if (!version) throw VfmErrors.notFound('Verzija forme ne postoji.');
    return version;
  }

  private assertDraft(version: VersionRow): void {
    if (version.status !== 'DRAFT') {
      throw new VfmException(
        'FORM_VERSION_IMMUTABLE',
        `Verzija ${version.version} je ${version.status} i ne može se mijenjati. Kreirajte novu verziju.`,
      );
    }
  }

  /** Definicija iz baze mora proći meta-shemu (odbrana od ručnog kvara). */
  private parseStoredDefinition(version: VersionRow): FormDefinition {
    const parsed = parseDefinition(version.definition);
    if (!parsed.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `Definicija verzije ${version.version} u bazi nije ispravna.`,
        issuesToDetails(parsed.issues),
      );
    }

    const expected = version.contentHash;
    const actual = contentHash(parsed.definition);
    if (expected && expected !== actual) {
      this.logger.warn(
        `contentHash verzije ${version.id} ne odgovara definiciji (${expected} ≠ ${actual}) — provjeri ručne izmjene u bazi.`,
      );
    }
    return parsed.definition;
  }

  /** Definicija iz zahtjeva mora proći meta-shemu. */
  private parseInputDefinition(input: unknown): FormDefinition {
    const parsed = parseDefinition(input);
    if (!parsed.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Definicija forme nije ispravna.',
        issuesToDetails(parsed.issues),
      );
    }
    return parsed.definition;
  }

  private toSummary(row: {
    id: string;
    key: string;
    name: string;
    subject: FormSchemaSummary['subject'];
    taskTypeId: string | null;
    description: string | null;
    ownerModule: string | null;
    status: string;
    currentPublishedVersionId: string | null;
    currentPublishedVersion: { id: string; version: number } | null;
    _count: { versions: number };
    updatedAt: Date;
    createdAt: Date;
  }): FormSchemaSummary {
    // `FormSchema.status` je lifecycle kolona (`ACTIVE`/arhivirano), a status u
    // API-ju opisuje **objavu**: forma je `PUBLISHED` čim ima aktivnu verziju.
    const status: FormSchemaStatus = row.currentPublishedVersionId === null ? 'DRAFT' : 'PUBLISHED';

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      subject: row.subject,
      taskTypeId: row.taskTypeId,
      description: row.description,
      ownerModule: row.ownerModule,
      status,
      currentPublishedVersionId: row.currentPublishedVersionId,
      currentPublishedVersion: row.currentPublishedVersion?.version ?? null,
      versionCount: row._count.versions,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toVersionSummary(version: VersionRow, recordCount: number): FormVersionSummary {
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      changeNote: version.changeNote,
      contentHash: version.contentHash,
      mobileCompatible: version.mobileCompatible,
      publishedAt: toIso(version.publishedAt),
      publishedById: version.publishedById,
      retiredAt: toIso(version.retiredAt),
      createdAt: version.createdAt.toISOString(),
      recordCount,
    };
  }

  /** Broj zapisa po verziji (za upozorenje pri povlačenju). */
  private async loadRecordCounts(versionIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (versionIds.length === 0) return counts;

    for (const model of RECORD_MODELS) {
      const delegate = this.prisma[model] as unknown as {
        groupBy: (args: unknown) => Promise<Record<string, unknown>[]>;
      };
      const rows = await delegate.groupBy({
        by: ['formSchemaVersionId'],
        where: { formSchemaVersionId: { in: [...versionIds] } },
        _count: { _all: true },
      });

      for (const row of rows) {
        const versionId = row['formSchemaVersionId'];
        if (typeof versionId !== 'string') continue;
        const aggregate = row['_count'] as { _all?: number } | undefined;
        counts.set(versionId, (counts.get(versionId) ?? 0) + (aggregate?._all ?? 0));
      }
    }
    return counts;
  }

  /** Vrijednost `ETag` zaglavlja za definiciju (`"<sha256>"`). */
  static etagOf(contentHash: string): string {
    return `"${contentHash}"`;
  }
}
