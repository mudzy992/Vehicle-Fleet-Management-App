/**
 * `DriversService` — vozači i kategorije vozačke dozvole (docs/07 §2.4, docs/03 §3.3).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Vozač je zapis dinamičke forme, ali identitet nije forma.** `firstName`,
 *    `lastName`, PII i podaci o dozvoli su kolone tabele; `formData` se validira
 *    prema tačnoj verziji forme (P11) i smije popuniti samo kolone s whitelist-a
 *    — za `DRIVER` whitelist ne postoji, pa svako mapiranje pada s
 *    `NORMALIZATION_MISMATCH`.
 * 2. **PII se ne vraća bez prava** (`driver:view_pii`, R-07): `phone`, `email`,
 *    `dateOfBirth`, `address` i `licenseNumber` su maskirani/izostavljeni, a
 *    odgovor nosi `piiRedacted`. Datum isteka dozvole **nije** PII — nosi ga
 *    rok i podsjetnik.
 * 3. **Arhiviranje ne briše evidencije.** `archive` mijenja samo `status`
 *    (`Driver` nema `archivedAt` — to polje ima `Vehicle`); `delete` je
 *    soft-delete (`deletedAt`), pa istorija ostaje.
 * 4. **Kategorija dozvole je jedinstvena po vozaču** (`@@unique([driverId, category])`);
 *    servis provjerava i prije upisa da greška bude `409 DUPLICATE_ENTRY` s poljem.
 * 5. **Optimističko zaključavanje:** `PATCH` nosi `version`; upis ide atomski
 *    (`updateMany` s `version` u `where`), pa paralelna izmjena daje
 *    `409 VERSION_CONFLICT` s trenutnom verzijom.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, DriverStatus } from '@vfm/shared';
import { toLocalDateString } from '@vfm/shared';
import type {
  ArchiveDriverInput,
  CreateDriverInput,
  CreateDriverLicenseCategoryInput,
  DriverDetail,
  DriverLicenseCategory,
  DriverLicenseCategoryList,
  DriverListQuery,
  DriverListResponse,
  DriverSummary,
  UpdateDriverInput,
  UpdateDriverLicenseCategoryInput,
} from '@vfm/shared/schemas';
import {
  NORMALIZATION_COLUMNS,
  parseDefinition,
  validateRecord,
  type DefinitionIssue,
  type FormDefinition,
} from '@vfm/form-engine';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toDatabaseDate } from '../../common/dates.js';
import { resolveFormOptionValues } from '../../common/form-option-values.js';

/** Snapshot za audit (`before`/`after`) — kontroler ga predaje `AuditContext`. */
export interface DriverMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/**
 * Dozvoljene promjene statusa kroz `PATCH` (bez `ARCHIVED`).
 *
 * `ARCHIVED` se postavlja isključivo kroz `POST /:id/archive` i skida kroz
 * `/restore` — inače bi se arhivirani vozač mogao „vratiti" u promet jednim
 * `PATCH`-om bez audit traga.
 */
export const DRIVER_STATUS_TRANSITIONS: Readonly<Record<DriverStatus, readonly DriverStatus[]>> = {
  ACTIVE: ['INACTIVE'],
  INACTIVE: ['ACTIVE'],
  ARCHIVED: [],
};

/** Kolone vozača koje forma smije puniti — za `DRIVER` ih nema (docs/04 §7). */
export const DRIVER_NORMALIZED_COLUMNS = NORMALIZATION_COLUMNS.DRIVER ?? [];

/** Sortiranje je whitelist — korisnički `sortBy` ne smije doći u SQL. */
const SORTABLE: Readonly<Record<string, string>> = {
  lastName: 'lastName',
  firstName: 'firstName',
  employeeNumber: 'employeeNumber',
  status: 'status',
  licenseExpiresAt: 'licenseExpiresAt',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
};

const DRIVER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  address: true,
  employeeNumber: true,
  employmentStatus: true,
  licenseNumber: true,
  licenseIssuedAt: true,
  licenseExpiresAt: true,
  licenseIssuingAuthority: true,
  restrictions: true,
  notes: true,
  status: true,
  photoAttachmentId: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  formData: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  // `Driver` NEMA `archivedAt` (samo `Vehicle` ga ima) — arhiva je `status`.
  // Selektovano polje koje ne postoji ne pada na typecheck-u (Prisma preskače
  // provjeru viška ključeva kod spread objekta), nego na prvom upitu: baza
  // vrati `column Driver.archivedAt does not exist` → `500 INTERNAL_ERROR`.
  // Čuva `test/unit/prisma-select-fields.spec.ts`.
} as const;

/** Red kakav vraća Prisma (samo polja iz `DRIVER_SELECT` + kategorije). */
interface DriverRow {
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
  formData: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  categories?: Array<{ category: string }>;
}

interface LicenseRow {
  id: string;
  driverId: string;
  category: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  restrictions: string | null;
  notes: string | null;
}

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

function dateOnly(value: Date | null): string | null {
  return value ? toLocalDateString(value) : null;
}

/** Ima li akter pravo (Super Admin ima sve — R-07). */
function allows(actor: AuthenticatedUser | undefined, permission: string): boolean {
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  return actor.permissions?.list.includes(permission) ?? false;
}

/** `2026-04-01` → broj dana od danas (negativan = isteklo). */
export function daysUntil(target: string | null, today = toLocalDateString(new Date())): number | null {
  if (!target) return null;
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${target}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Maskiranje e-maila u formatu iz docs/05 §8.2 (`A***@example.ba`).
 *
 * Namjerno lokalno, a ne `maskEmail` iz `@vfm/shared`: shared varijanta čuva
 * dužinu lokalnog dijela (`f***…***@`), što je za PII u listama previše.
 */
export function maskDriverEmail(email: string | null): string | null {
  if (!email) return email;
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/gu, '');
  return `•••••${digits.slice(-3)}`;
}

export function maskDocumentNumber(value: string | null): string | null {
  if (!value) return value;
  return `•••••${value.slice(-3)}`;
}

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  // Lista ne nosi PII (samo meta + kategorije), pa joj pravo na PII nije potrebno.
  async list(query: DriverListQuery): Promise<DriverListResponse> {
    const where = this.buildWhere(query);
    const sortBy = SORTABLE[query.sortBy ?? ''] ?? 'lastName';
    const orderBy = { [sortBy]: query.sortOrder } as Prisma.DriverOrderByWithRelationInput;

    const [total, rows] = await Promise.all([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // Kategorije idu uz listu: UI prikazuje oznake (`B`, `C`, `CE`) bez
        // dodatnog zahtjeva po vozaču.
        select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
      }),
    ]);

    return {
      items: (rows as DriverRow[]).map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string, actor?: AuthenticatedUser): Promise<DriverDetail> {
    const row = await this.loadOrThrow(id);
    return this.toDetail(row, allows(actor, 'driver:view_pii'));
  }

  // ---------------------------------------------------------------------------
  //  Upis
  // ---------------------------------------------------------------------------

  async create(input: CreateDriverInput, actor?: AuthenticatedUser): Promise<DriverMutation<DriverDetail>> {
    const version = await this.resolveFormVersion(input.formSchemaVersionId);
    const { values } = await this.validateFormData({
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values: input.formData,
      // Novi zapis mora nositi objavljenu verziju (P11).
      isNew: true,
    });

    const data = {
      id: randomUUID(),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      // `@db.Date` u Prismi traži DateTime — vidi `common/dates.ts`.
      dateOfBirth: toDatabaseDate(input.dateOfBirth),
      address: input.address ?? null,
      employeeNumber: input.employeeNumber ?? null,
      employmentStatus: input.employmentStatus ?? null,
      licenseNumber: input.licenseNumber ?? null,
      licenseIssuedAt: toDatabaseDate(input.licenseIssuedAt),
      licenseExpiresAt: toDatabaseDate(input.licenseExpiresAt),
      licenseIssuingAuthority: input.licenseIssuingAuthority ?? null,
      restrictions: input.restrictions ?? null,
      notes: input.notes ?? null,
      formSchemaId: version.formSchemaId,
      formSchemaVersionId: version.id,
      formData: values,
      createdById: actor?.id ?? null,
    } as unknown as Prisma.DriverUncheckedCreateInput;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driver.create({
        data,
        select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
      });
      return row as DriverRow;
    });

    return {
      data: this.toDetail(created, allows(actor, 'driver:view_pii')),
      after: this.auditSnapshot(created),
    };
  }

  async update(
    id: string,
    input: UpdateDriverInput,
    actor?: AuthenticatedUser,
  ): Promise<DriverMutation<DriverDetail>> {
    const current = await this.loadOrThrow(id);
    this.assertVersion(current, input.version);
    if (current.status === 'ARCHIVED') {
      throw new VfmException(
        'VALIDATION_ERROR',
        'Arhiviran vozač se ne mijenja — prvo ga vratite iz arhive.',
        [detail('status', 'ARCHIVED')],
      );
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      'firstName',
      'lastName',
      'phone',
      'email',
      'dateOfBirth',
      'address',
      'employeeNumber',
      'employmentStatus',
      'licenseNumber',
      'licenseIssuedAt',
      'licenseExpiresAt',
      'licenseIssuingAuthority',
      'restrictions',
      'notes',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }

    // Datumi su u API-ju date-only stringovi, a kolone su `@db.Date`.
    for (const key of ['dateOfBirth', 'licenseIssuedAt', 'licenseExpiresAt'] as const) {
      if (input[key] !== undefined) data[key] = toDatabaseDate(input[key]);
    }

    if (input.status && input.status !== current.status) {
      const allowed = DRIVER_STATUS_TRANSITIONS[current.status as DriverStatus] ?? [];
      if (!allowed.includes(input.status)) {
        throw new VfmException(
          'VALIDATION_ERROR',
          `Prelaz ${current.status} → ${input.status} nije dozvoljen.`,
          [detail('status', `Dozvoljeno: ${allowed.join(', ') || '—'}`)],
        );
      }
      data.status = input.status;
    }

    if (input.formData !== undefined) {
      const version = await this.prisma.formSchemaVersion.findUnique({
        where: { id: current.formSchemaVersionId },
      });
      if (!version) throw new VfmException('NOT_FOUND', 'Verzija forme zapisa više ne postoji.');

      const definition = this.parseStored(version.definition);
      const validated = await this.validateFormData({
        definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
        values: { ...((current.formData ?? {}) as Record<string, unknown>), ...input.formData },
        // Postojeći zapis smije ostati na `RETIRED` verziji (P10).
        isNew: false,
      });
      data.formData = validated.values;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.driver.updateMany({
        where: { id, version: input.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });

      if (result.count === 0) {
        const fresh = await tx.driver.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Vozač nije pronađen.');
        throw new VfmException('VERSION_CONFLICT', undefined, undefined, {
          currentVersion: fresh.version,
        });
      }

      const row = await tx.driver.findFirst({
        where: { id },
        select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
      });
      if (!row) throw new VfmException('NOT_FOUND', 'Vozač nije pronađen.');
      return row as DriverRow;
    });

    return {
      data: this.toDetail(updated, allows(actor, 'driver:view_pii')),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(updated),
    };
  }

  async archive(
    id: string,
    input: ArchiveDriverInput,
    actor?: AuthenticatedUser,
  ): Promise<DriverMutation<DriverDetail>> {
    const current = await this.loadOrThrow(id);
    if (current.status === 'ARCHIVED') {
      return { data: this.toDetail(current, allows(actor, 'driver:view_pii')) };
    }

    const archived = await this.prisma.driver.update({
      where: { id },
      // `Driver` nema `archivedAt` — status je jedini marker arhive, a trag
      // ostaje u `AuditLog`-u (`ARCHIVE`).
      data: {
        status: 'ARCHIVED',
        ...(input.reason ? { notes: input.reason } : {}),
      },
      select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
    });

    return {
      data: this.toDetail(archived as DriverRow, allows(actor, 'driver:view_pii')),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(archived as DriverRow),
    };
  }

  async restore(id: string, actor?: AuthenticatedUser): Promise<DriverMutation<DriverDetail>> {
    const current = await this.loadOrThrow(id);
    if (current.status !== 'ARCHIVED') {
      throw new VfmException('VALIDATION_ERROR', 'Vozač nije u arhivi.', [detail('status', current.status)]);
    }

    // Namjerno `INACTIVE`: vraćanje iz arhive ne znači automatski „aktivan".
    const restored = await this.prisma.driver.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
    });

    return {
      data: this.toDetail(restored as DriverRow, allows(actor, 'driver:view_pii')),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(restored as DriverRow),
    };
  }

  /** Soft-delete: zapis i sve evidencije ostaju. */
  async remove(id: string, actorId?: string): Promise<DriverMutation<{ id: string }>> {
    const current = await this.loadOrThrow(id);
    await this.prisma.driver.update({ where: { id }, data: { deletedAt: new Date() } });

    return {
      data: { id },
      before: this.auditSnapshot(current),
      after: { id, deletedAt: new Date().toISOString(), deletedById: actorId ?? null },
    };
  }

  // ---------------------------------------------------------------------------
  //  Kategorije dozvole (docs/07 §2.4)
  // ---------------------------------------------------------------------------

  async listLicenseCategories(driverId: string): Promise<DriverLicenseCategoryList> {
    await this.loadOrThrow(driverId);
    const rows = await this.prisma.driverLicenseCategory.findMany({
      where: { driverId },
      orderBy: { category: 'asc' },
    });
    return { items: (rows as LicenseRow[]).map((row) => this.toCategory(row)) };
  }

  async addLicenseCategory(
    driverId: string,
    input: CreateDriverLicenseCategoryInput,
    _actorId?: string,
  ): Promise<DriverMutation<DriverLicenseCategory>> {
    await this.loadOrThrow(driverId);

    const category = input.category.toUpperCase();
    const existing = await this.prisma.driverLicenseCategory.findFirst({
      where: { driverId, category },
      select: { id: true },
    });
    if (existing) {
      throw new VfmException('DUPLICATE_ENTRY', `Vozač već ima kategoriju ${category}.`, [
        detail('category', category),
      ]);
    }

    const created = await this.prisma.driverLicenseCategory.create({
      data: {
        id: randomUUID(),
        driverId,
        category,
        issuedAt: toDatabaseDate(input.issuedAt),
        expiresAt: toDatabaseDate(input.expiresAt),
        restrictions: input.restrictions ?? null,
        notes: input.notes ?? null,
      },
    });

    return {
      data: this.toCategory(created as LicenseRow),
      after: this.categorySnapshot(created as LicenseRow),
    };
  }

  async updateLicenseCategory(
    driverId: string,
    categoryId: string,
    input: UpdateDriverLicenseCategoryInput,
  ): Promise<DriverMutation<DriverLicenseCategory>> {
    await this.loadOrThrow(driverId);
    const current = await this.loadCategoryOrThrow(driverId, categoryId);

    const data: Record<string, unknown> = {};
    for (const key of ['restrictions', 'notes'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    for (const key of ['issuedAt', 'expiresAt'] as const) {
      if (input[key] !== undefined) data[key] = toDatabaseDate(input[key]);
    }

    const updated = await this.prisma.driverLicenseCategory.update({
      where: { id: categoryId },
      data,
    });

    return {
      data: this.toCategory(updated as LicenseRow),
      before: this.categorySnapshot(current),
      after: this.categorySnapshot(updated as LicenseRow),
    };
  }

  async removeLicenseCategory(driverId: string, categoryId: string): Promise<DriverMutation<{ id: string }>> {
    await this.loadOrThrow(driverId);
    const current = await this.loadCategoryOrThrow(driverId, categoryId);
    await this.prisma.driverLicenseCategory.delete({ where: { id: categoryId } });

    return { data: { id: categoryId }, before: this.categorySnapshot(current) };
  }

  // ---------------------------------------------------------------------------
  //  Forma i validacija (P11)
  // ---------------------------------------------------------------------------

  private async resolveFormVersion(versionId?: string): Promise<{
    id: string;
    version: number;
    status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
    definition: FormDefinition;
    formSchemaId: string;
  }> {
    const version = versionId
      ? await this.prisma.formSchemaVersion.findUnique({
          where: { id: versionId },
          include: { formSchema: true },
        })
      : await this.activeDriverVersion();

    if (!version) {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Nema objavljene `DRIVER` forme — vozač se ne može kreirati.',
      );
    }

    const formSchema = (version as { formSchema?: { subject: string } }).formSchema;
    if (formSchema && formSchema.subject !== 'DRIVER') {
      throw new VfmException('FORM_VALIDATION_FAILED', 'Odabrana verzija forme nije za subject `DRIVER`.', [
        detail('formSchemaVersionId', formSchema.subject),
      ]);
    }

    return {
      id: version.id,
      version: version.version,
      status: version.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
      definition: this.parseStored(version.definition),
      formSchemaId: version.formSchemaId,
    };
  }

  private async activeDriverVersion() {
    const schema = await this.prisma.formSchema.findFirst({
      where: { subject: 'DRIVER', deletedAt: null, currentPublishedVersionId: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!schema?.currentPublishedVersionId) return null;
    return this.prisma.formSchemaVersion.findUnique({
      where: { id: schema.currentPublishedVersionId },
      include: { formSchema: true },
    });
  }

  private parseStored(definition: unknown): FormDefinition {
    const parsed = parseDefinition(definition);
    if (!parsed.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Definicija forme zapisa nije ispravna.',
        (parsed.issues as readonly DefinitionIssue[]).map((issue) => detail(issue.path, issue.message)),
      );
    }
    return parsed.definition;
  }

  /**
   * P11 validacija + mapiranje na kolone. Za vozača whitelist nema kolona, pa
   * svako `normalizedName` mapiranje znači da su se forma i tabela razišle.
   */
  private async validateFormData(args: {
    definition: FormDefinition;
    versionId: string;
    versionNumber: number;
    status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
    values: Record<string, unknown>;
    isNew: boolean;
  }): Promise<{ normalized: Record<string, unknown>; values: Record<string, unknown> }> {
    const result = validateRecord({
      version: {
        id: args.versionId,
        version: args.versionNumber,
        status: args.status,
        definition: args.definition,
      },
      values: args.values,
      isNew: args.isNew,
      today: toLocalDateString(new Date()),
      optionValues: await resolveFormOptionValues(this.prisma, args.definition),
    });

    if (result.versionError) {
      throw new VfmException('FORM_VERSION_NOT_PUBLISHED', undefined, undefined, {
        versionError: result.versionError,
      });
    }

    if (!result.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `Podaci nisu ispravni (${result.errors.length} greška/e).`,
        result.errors.map((error) => detail(`formData.${error.key}`, `${error.code}: ${error.message}`)),
        { errors: result.errors },
      );
    }

    for (const column of Object.keys(result.normalized)) {
      if (!DRIVER_NORMALIZED_COLUMNS.includes(column)) {
        throw new VfmException(
          'NORMALIZATION_MISMATCH',
          `Mapiranje na kolonu "${column}" ne postoji na vozaču.`,
          [detail(`normalizedName.${column}`, column)],
        );
      }
    }

    return { normalized: {}, values: result.values as Record<string, unknown> };
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne
  // ---------------------------------------------------------------------------

  private buildWhere(query: DriverListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };

    if (query.status) where.status = query.status;
    else if (!query.includeArchived) where.status = { not: 'ARCHIVED' };

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' };
      where.OR = [{ firstName: contains }, { lastName: contains }, { employeeNumber: contains }];
    }

    if (query.licenseCategory) {
      where.categories = { some: { category: query.licenseCategory.toUpperCase() } };
    }

    if (query.expiringInDays !== undefined) {
      // `@db.Date` ne nosi vrijeme: granica je početak **lokalnog** dana
      // (`Europe/Sarajevo`), inače vozač kojem dozvola ističe danas ispadne.
      const today = toDatabaseDate(toLocalDateString(new Date()))!;
      const until = new Date(today.getTime() + query.expiringInDays * 24 * 60 * 60 * 1000);
      where.AND = [
        {
          OR: [
            { licenseExpiresAt: { gte: today, lte: until } },
            { categories: { some: { expiresAt: { gte: today, lte: until } } } },
          ],
        },
      ];
    }

    return where;
  }

  private async loadOrThrow(id: string): Promise<DriverRow> {
    const row = await this.prisma.driver.findFirst({
      where: { id, deletedAt: null },
      select: { ...DRIVER_SELECT, categories: { select: { category: true } } },
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Vozač nije pronađen.');
    return row as DriverRow;
  }

  private async loadCategoryOrThrow(driverId: string, categoryId: string): Promise<LicenseRow> {
    const row = await this.prisma.driverLicenseCategory.findFirst({
      where: { id: categoryId, driverId },
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Kategorija dozvole nije pronađena.');
    return row as LicenseRow;
  }

  private assertVersion(row: DriverRow, version: number): void {
    if (row.version !== version) {
      throw new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion: row.version });
    }
  }

  private toSummary(row: DriverRow): DriverSummary {
    const categories = (row.categories ?? []).map((entry) => entry.category);
    const licenseExpiresAt = dateOnly(row.licenseExpiresAt);
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      employeeNumber: row.employeeNumber,
      employmentStatus: row.employmentStatus,
      status: row.status as DriverStatus,
      licenseExpiresAt,
      categories,
      licenseDaysLeft: daysUntil(licenseExpiresAt),
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: DriverRow, piiAllowed: boolean): DriverDetail {
    return {
      ...this.toSummary(row),
      phone: piiAllowed ? row.phone : maskPhone(row.phone),
      email: piiAllowed ? row.email : maskDriverEmail(row.email),
      // Datum rođenja i adresa nemaju smislenu masku — bez prava se ne vraćaju.
      dateOfBirth: piiAllowed ? dateOnly(row.dateOfBirth) : null,
      address: piiAllowed ? row.address : null,
      licenseNumber: piiAllowed ? row.licenseNumber : maskDocumentNumber(row.licenseNumber),
      licenseIssuedAt: dateOnly(row.licenseIssuedAt),
      licenseIssuingAuthority: row.licenseIssuingAuthority,
      restrictions: row.restrictions,
      notes: row.notes,
      photoAttachmentId: row.photoAttachmentId,
      formSchemaId: row.formSchemaId,
      formSchemaVersionId: row.formSchemaVersionId,
      formData: (row.formData ?? {}) as Record<string, unknown>,
      piiRedacted: !piiAllowed,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toCategory(row: LicenseRow): DriverLicenseCategory {
    return {
      id: row.id,
      category: row.category,
      issuedAt: dateOnly(row.issuedAt),
      expiresAt: dateOnly(row.expiresAt),
      restrictions: row.restrictions,
      notes: row.notes,
    };
  }

  /** Snapshot za audit: bez PII (u audit log ne idu lični podaci — docs/05 §8). */
  private auditSnapshot(row: DriverRow): Record<string, unknown> {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      employeeNumber: row.employeeNumber,
      status: row.status,
      licenseExpiresAt: dateOnly(row.licenseExpiresAt),
      version: row.version,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private categorySnapshot(row: LicenseRow): Record<string, unknown> {
    return {
      id: row.id,
      driverId: row.driverId,
      category: row.category,
      issuedAt: dateOnly(row.issuedAt),
      expiresAt: dateOnly(row.expiresAt),
    };
  }
}
