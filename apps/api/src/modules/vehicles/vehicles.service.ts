/**
 * `VehiclesService` — CRUD vozila (docs/07 §2.5, docs/03 §3.3, docs/04 §7).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Vozilo je zapis dinamičke forme.** `formData` se validira prema tačnoj
 *    verziji forme (P11), a `formSchemaVersionId` se **nikad** ne mijenja kroz
 *    `PATCH` — prelazak na novu verziju je eksplicitna migracija (P12).
 * 2. **Kolone za izvještaje se pune iz `definition.normalizedName`.** Servis ne
 *    poznaje mapiranje; dobija gotovu mapu kolona iz `validateRecord()`. Kolona
 *    koja nije na whitelist-u vozila je `NORMALIZATION_MISMATCH` (definicija i
 *    tabela su se razišle), a nedostatak obavezne kolone je `FORM_VALIDATION_FAILED`.
 * 3. **`internalNo` i `vin` su jedinstveni među aktivnim zapisima** (partial
 *    unique u bazi); servis provjerava i prije upisa da bi greška bila 409 s
 *    poljem, a ne sirovi `P2002`.
 * 4. **Arhiviranje ne briše evidencije.** `archive` samo pomjera status i
 *    `archivedAt`; `delete` je soft-delete (`deletedAt`), pa istorija ostaje.
 * 5. **Optimističko zaključavanje:** `PATCH` nosi `version`; promjena se piše
 *    atomski (`updateMany` s `version` u `where`), pa paralelna izmjena daje
 *    `409 VERSION_CONFLICT` s trenutnom verzijom.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, VehicleStatus } from '@vfm/shared';
import { VEHICLE_STATUSES, toLocalDateString } from '@vfm/shared';
import type {
  ArchiveVehicleInput,
  CorrectOdometerReadingInput,
  CreateOdometerReadingInput,
  CreateVehicleInput,
  OdometerListResponse,
  OdometerReading,
  UpdateVehicleInput,
  VehicleDetail,
  VehicleListQuery,
  VehicleListResponse,
  VehicleSummary,
} from '@vfm/shared/schemas';
import {
  NORMALIZATION_COLUMNS,
  parseDefinition,
  validateRecord,
  type DefinitionIssue,
  type FormDefinition,
} from '@vfm/form-engine';
import type { Prisma } from '../../generated/prisma/client.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toDatabaseDate } from '../../common/dates.js';
import { resolveFormOptionValues } from '../../common/form-option-values.js';

/** Snapshot za audit (`before`/`after`) — kontroler ga predaje `AuditContext`. */
export interface VehicleMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/**
 * Dozvoljene promjene statusa kroz `PATCH` (bez `ARCHIVED`).
 *
 * `ARCHIVED` se postavlja isključivo kroz `POST /:id/archive` i skida kroz
 * `/restore` — inače bi se arhivirano vozilo moglo „vratiti" u promet jednim
 * `PATCH`-om bez audit traga.
 */
export const VEHICLE_STATUS_TRANSITIONS: Readonly<Record<VehicleStatus, readonly VehicleStatus[]>> = {
  ACTIVE: ['IN_SERVICE', 'INACTIVE', 'DAMAGED'],
  IN_SERVICE: ['ACTIVE', 'INACTIVE', 'DAMAGED'],
  INACTIVE: ['ACTIVE', 'IN_SERVICE'],
  DAMAGED: ['ACTIVE', 'IN_SERVICE', 'INACTIVE'],
  ARCHIVED: [],
};

/**
 * Kolone vozila koje forma smije puniti (`NORMALIZATION_COLUMNS.VEHICLE` iz
 * `@vfm/form-engine`, docs/04 §7). Identitet vozila (`internalNo`, `make`,
 * `model`, `fuelType`) je strukturirani dio API-ja i **nikad** ne dolazi iz forme.
 */
export const VEHICLE_NORMALIZED_COLUMNS = NORMALIZATION_COLUMNS.VEHICLE ?? [];

/** Kolone iz forme koje moraju biti cijeli brojevi. */
const INTEGER_COLUMNS = ['odometerKm', 'nextServiceDueKm'] as const;

/** Sortiranje je whitelist — korisnički `sortBy` ne smije doći u SQL. */
const SORTABLE: Readonly<Record<string, string>> = {
  internalNo: 'internalNo',
  make: 'make',
  model: 'model',
  year: 'year',
  plateNumber: 'plateNumber',
  status: 'status',
  odometerKm: 'odometerKm',
  registrationExpiresAt: 'registrationExpiresAt',
  insuranceExpiresAt: 'insuranceExpiresAt',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
};

const VEHICLE_SELECT = {
  id: true,
  internalNo: true,
  make: true,
  model: true,
  year: true,
  vin: true,
  plateNumber: true,
  fuelType: true,
  transmission: true,
  color: true,
  bodyType: true,
  engineCcm: true,
  enginePowerKw: true,
  seats: true,
  ownershipType: true,
  acquisitionDate: true,
  acquisitionPrice: true,
  costCenter: true,
  odometerKm: true,
  odometerUpdatedAt: true,
  status: true,
  registrationExpiresAt: true,
  insuranceExpiresAt: true,
  nextServiceDueDate: true,
  nextServiceDueKm: true,
  photoAttachmentId: true,
  notes: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  formData: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  archivedAt: true,
} as const;

/** Red kakav vraća Prisma (samo polja iz `VEHICLE_SELECT`). */
interface VehicleRow {
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
  formData: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
}

interface OdometerRow {
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

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

function dateOnly(value: Date | null): string | null {
  return value ? toLocalDateString(value) : null;
}

/**
 * Date-only string (`2026-09-11`) → `Date` za `@db.Date` kolone.
 *
 * Prisma za `@db.Date` traži pun ISO DateTime; date-only string pada s
 * „premature end of input" (vidi `common/dates.ts`).
 */
function toDbDate(value: string | null | undefined): Date | null {
  return toDatabaseDate(value);
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: VehicleListQuery): Promise<VehicleListResponse> {
    const where = this.buildWhere(query);
    const sortBy = SORTABLE[query.sortBy ?? ''] ?? 'internalNo';
    const orderBy = { [sortBy]: query.sortOrder } as Prisma.VehicleOrderByWithRelationInput;

    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: VEHICLE_SELECT,
      }),
    ]);

    return {
      items: (rows as VehicleRow[]).map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<VehicleDetail> {
    const row = await this.loadOrThrow(id);
    return this.toDetail(row);
  }

  // ---------------------------------------------------------------------------
  //  Upis
  // ---------------------------------------------------------------------------

  async create(input: CreateVehicleInput, actorId?: string): Promise<VehicleMutation<VehicleDetail>> {
    const version = await this.resolveFormVersion(input.formSchemaVersionId);
    const validated = await this.validateFormData({
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      // Identitet vozila je strukturirani dio API-ja, ali je i dio „kartice"
      // (forma ga prikazuje) — spaja se prije validacije, pa zapis čuva pun
      // snapshot, a forma i dalje provjerava obavezna polja i dužine.
      values: this.mergeCore(version.definition, input.formData, {
        internalNo: input.internalNo,
        make: input.make,
        model: input.model,
        fuelType: input.fuelType,
        ...(input.year !== undefined ? { year: input.year } : {}),
        ...(input.vin !== undefined ? { vin: input.vin } : {}),
      }),
      // Novi zapis mora nositi objavljenu verziju (P11).
      isNew: true,
    });
    const { normalized } = validated;

    await this.assertUnique({ internalNo: input.internalNo, vin: input.vin ?? null });

    const data = {
      id: randomUUID(),
      ...this.columnsFrom(normalized),
      formData: validated.values,
      internalNo: input.internalNo,
      make: input.make,
      model: input.model,
      fuelType: input.fuelType,
      ...(input.year !== undefined ? { year: input.year } : {}),
      ...(input.vin !== undefined ? { vin: input.vin } : {}),
      formSchemaId: version.formSchemaId,
      formSchemaVersionId: version.id,
      notes: input.notes ?? null,
      costCenter: input.costCenter ?? null,
      ...(input.ownershipType ? { ownershipType: input.ownershipType } : {}),
      ...(input.acquisitionDate !== undefined ? { acquisitionDate: toDbDate(input.acquisitionDate) } : {}),
      ...(input.acquisitionPrice !== undefined ? { acquisitionPrice: input.acquisitionPrice } : {}),
      createdById: actorId ?? null,
    } as unknown as Prisma.VehicleUncheckedCreateInput;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vehicle.create({
        data,
        select: VEHICLE_SELECT,
      });

      return row as VehicleRow;
    });

    return { data: this.toDetail(created), after: this.auditSnapshot(created) };
  }

  async update(
    id: string,
    input: UpdateVehicleInput,
    //  `Vehicle` nema `updatedById`; akter je u audit zapisu (`AuditContext`).
    _actorId?: string,
  ): Promise<VehicleMutation<VehicleDetail>> {
    const current = await this.loadOrThrow(id);
    this.assertVersion(current, input.version);
    if (current.status === 'ARCHIVED') {
      throw new VfmException(
        'VALIDATION_ERROR',
        'Arhivirano vozilo se ne mijenja — prvo ga vratite iz arhive.',
        [detail('status', 'ARCHIVED')],
      );
    }

    const data: Record<string, unknown> = {};
    for (const key of ['internalNo', 'make', 'model', 'year', 'vin', 'fuelType'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }

    if (input.internalNo !== undefined || input.vin !== undefined) {
      await this.assertUnique({
        internalNo: input.internalNo ?? current.internalNo,
        vin: input.vin !== undefined ? input.vin : current.vin,
        excludeId: current.id,
      });
    }

    if (input.status && input.status !== current.status) {
      const allowed = VEHICLE_STATUS_TRANSITIONS[current.status as VehicleStatus] ?? [];
      if (!allowed.includes(input.status)) {
        throw new VfmException(
          'VALIDATION_ERROR',
          `Prelaz ${current.status} → ${input.status} nije dozvoljen.`,
          [detail('status', `Dozvoljeno: ${allowed.join(', ') || '—'}`)],
        );
      }
      data.status = input.status;
    }

    const coreChanged =
      input.internalNo !== undefined ||
      input.make !== undefined ||
      input.model !== undefined ||
      input.fuelType !== undefined ||
      input.year !== undefined ||
      input.vin !== undefined;

    if (input.formData !== undefined || coreChanged) {
      const version = await this.prisma.formSchemaVersion.findUnique({
        where: { id: current.formSchemaVersionId },
      });
      if (!version) throw new VfmException('NOT_FOUND', 'Verzija forme zapisa više ne postoji.');

      const definition = this.parseStored(version.definition);
      const base = (current.formData ?? {}) as Record<string, unknown>;
      const merged = this.mergeCore(
        definition,
        { ...base, ...(input.formData ?? {}) },
        {
          ...(input.internalNo !== undefined ? { internalNo: input.internalNo } : {}),
          ...(input.make !== undefined ? { make: input.make } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.fuelType !== undefined ? { fuelType: input.fuelType } : {}),
          ...(input.year !== undefined ? { year: input.year } : {}),
          ...(input.vin !== undefined ? { vin: input.vin } : {}),
        },
      );

      const validated = await this.validateFormData({
        definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
        values: merged,
        // Postojeći zapis smije ostati na `RETIRED` verziji (P10).
        isNew: false,
      });

      Object.assign(data, this.columnsFrom(validated.normalized));
      data.formData = validated.values;
    }

    for (const key of ['notes', 'costCenter', 'ownershipType', 'acquisitionPrice'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.acquisitionDate !== undefined) data.acquisitionDate = toDbDate(input.acquisitionDate);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.vehicle.updateMany({
        where: { id, version: input.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });

      if (result.count === 0) {
        const fresh = await tx.vehicle.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
        throw new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion: fresh.version });
      }

      const row = await tx.vehicle.findFirst({ where: { id }, select: VEHICLE_SELECT });
      if (!row) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
      return row as VehicleRow;
    });

    return {
      data: this.toDetail(updated),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(updated),
    };
  }

  async archive(
    id: string,
    input: ArchiveVehicleInput,
    _actorId?: string,
  ): Promise<VehicleMutation<VehicleDetail>> {
    const current = await this.loadOrThrow(id);
    if (current.status === 'ARCHIVED') return { data: this.toDetail(current) };

    const archived = await this.prisma.vehicle.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        ...(input.reason ? { notes: input.reason } : {}),
      },
      select: VEHICLE_SELECT,
    });

    return {
      data: this.toDetail(archived as VehicleRow),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(archived as VehicleRow),
    };
  }

  async restore(id: string, _actorId?: string): Promise<VehicleMutation<VehicleDetail>> {
    const current = await this.loadOrThrow(id);
    if (current.status !== 'ARCHIVED') {
      throw new VfmException('VALIDATION_ERROR', 'Vozilo nije u arhivi.', [detail('status', current.status)]);
    }

    // Namjerno `INACTIVE`: vraćanje iz arhive ne znači automatski „u prometu".
    const restored = await this.prisma.vehicle.update({
      where: { id },
      data: { status: 'INACTIVE', archivedAt: null },
      select: VEHICLE_SELECT,
    });

    return {
      data: this.toDetail(restored as VehicleRow),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(restored as VehicleRow),
    };
  }

  /** Soft-delete: zapis i sve evidencije ostaju, `internalNo`/`vin` se oslobađaju. */
  async remove(id: string, actorId?: string): Promise<VehicleMutation<{ id: string }>> {
    const current = await this.loadOrThrow(id);
    await this.prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });

    return {
      data: { id },
      before: this.auditSnapshot(current),
      after: { id, deletedAt: new Date().toISOString(), deletedById: actorId ?? null },
    };
  }

  // ---------------------------------------------------------------------------
  //  Kilometraža (docs/07 §2.5, docs/03 §3.3)
  // ---------------------------------------------------------------------------

  async listOdometer(
    vehicleId: string,
    query: { page: number; pageSize: number },
  ): Promise<OdometerListResponse> {
    await this.loadOrThrow(vehicleId);

    const [total, rows] = await Promise.all([
      this.prisma.odometerReading.count({ where: { vehicleId } }),
      this.prisma.odometerReading.findMany({
        where: { vehicleId },
        orderBy: { readingAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: (rows as OdometerRow[]).map((row) => this.toOdometer(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Novo očitanje. Niža vrijednost od zatečene je `422 ODOMETER_REGRESSION` —
   * ispravka ide isključivo kroz `/correct` s razlogom (auditovano).
   */
  async addOdometer(
    vehicleId: string,
    input: CreateOdometerReadingInput,
    actorId?: string,
  ): Promise<VehicleMutation<OdometerReading>> {
    const vehicle = await this.loadOrThrow(vehicleId);

    if (input.valueKm < vehicle.odometerKm) {
      throw new VfmException(
        'ODOMETER_REGRESSION',
        `Nova kilometraža (${input.valueKm}) je manja od zatečene (${vehicle.odometerKm}).`,
        [detail('valueKm', `Zatečeno: ${vehicle.odometerKm} km`)],
        { currentKm: vehicle.odometerKm },
      );
    }

    return this.writeOdometer(vehicle, { ...input, isCorrection: false }, actorId);
  }

  /** Ispravka zatečene vrijednosti — dopušta nižu kilometražu, uz obavezan razlog. */
  async correctOdometer(
    vehicleId: string,
    input: CorrectOdometerReadingInput,
    actorId?: string,
  ): Promise<VehicleMutation<OdometerReading>> {
    const vehicle = await this.loadOrThrow(vehicleId);
    const reason = input.correctionReason.trim();

    if (reason.length < 5) {
      throw new VfmException('VALIDATION_ERROR', 'Razlog korekcije je obavezan (najmanje 5 znakova).', [
        detail('correctionReason', 'Prekratko.'),
      ]);
    }

    return this.writeOdometer(vehicle, { ...input, isCorrection: true, reason }, actorId);
  }

  private async writeOdometer(
    vehicle: VehicleRow,
    input: (CreateOdometerReadingInput | CorrectOdometerReadingInput) & {
      isCorrection: boolean;
      reason?: string;
    },
    actorId?: string,
  ): Promise<VehicleMutation<OdometerReading>> {
    const readingAt = input.readingAt ? new Date(input.readingAt) : new Date();
    if (Number.isNaN(readingAt.getTime())) {
      throw new VfmException('VALIDATION_ERROR', 'Neispravan datum očitanja.', [
        detail('readingAt', 'Datum'),
      ]);
    }
    // Očitanje „iz budućnosti" nije dozvoljeno — tolerancija je samo satni pomak.
    if (readingAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new VfmException('VALIDATION_ERROR', 'Datum očitanja je u budućnosti.', [
        detail('readingAt', readingAt.toISOString()),
      ]);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const reading = await tx.odometerReading.create({
        data: {
          id: randomUUID(),
          vehicleId: vehicle.id,
          valueKm: input.valueKm,
          source: input.source,
          readingAt,
          recordedById: actorId ?? null,
          isCorrection: input.isCorrection,
          correctionReason: input.isCorrection ? (input.reason ?? null) : null,
          previousValueKm: input.isCorrection ? vehicle.odometerKm : null,
          ...(input.referenceType ? { referenceType: input.referenceType } : {}),
          ...(input.referenceId ? { referenceId: input.referenceId } : {}),
        },
      });

      // Denormalizovana vrijednost se mijenja u ISTOJ transakciji (docs/03 §3.3);
      // `version` raste da bi stari klijenti dobili `VERSION_CONFLICT` (P10 duh).
      const updated = await tx.vehicle.updateMany({
        where: { id: vehicle.id, deletedAt: null },
        data: {
          odometerKm: input.valueKm,
          odometerUpdatedAt: readingAt,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');

      return reading;
    });

    return {
      data: this.toOdometer(created as OdometerRow),
      before: { odometerKm: vehicle.odometerKm },
      after: {
        odometerKm: input.valueKm,
        isCorrection: input.isCorrection,
        previousValueKm: input.isCorrection ? vehicle.odometerKm : null,
        readingAt: readingAt.toISOString(),
      },
    };
  }

  private toOdometer(row: OdometerRow): OdometerReading {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      valueKm: row.valueKm,
      source: row.source as OdometerReading['source'],
      readingAt: row.readingAt.toISOString(),
      isCorrection: row.isCorrection,
      correctionReason: row.correctionReason,
      previousValueKm: row.previousValueKm,
      recordedById: row.recordedById,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  //  Forma i normalizacija
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
      : await this.activeVehicleVersion();

    if (!version) {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Nema objavljene `VEHICLE` forme — vozilo se ne može kreirati.',
      );
    }

    const formSchema = (version as { formSchema?: { subject: string } }).formSchema;
    if (formSchema && formSchema.subject !== 'VEHICLE') {
      throw new VfmException('FORM_VALIDATION_FAILED', 'Odabrana verzija forme nije za subject `VEHICLE`.', [
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

  private async activeVehicleVersion() {
    const schema = await this.prisma.formSchema.findFirst({
      where: { subject: 'VEHICLE', deletedAt: null, currentPublishedVersionId: { not: null } },
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
   * P11 validacija + mapiranje na kolone. Vraća samo kolone s whitelist-a;
   * greške idu po polju forme (`formData.<fieldKey>`), pa ih UI može prikazati.
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

    const normalized: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(result.normalized)) {
      if (!VEHICLE_NORMALIZED_COLUMNS.includes(column)) {
        throw new VfmException(
          'NORMALIZATION_MISMATCH',
          `Mapiranje na kolonu "${column}" ne postoji na vozilu.`,
          [detail(`normalizedName.${column}`, column)],
        );
      }
      normalized[column] = value;
    }

    for (const column of INTEGER_COLUMNS) {
      const value = normalized[column];
      if (value === undefined || value === null) continue;
      if (!Number.isInteger(value)) {
        throw new VfmException('NORMALIZATION_MISMATCH', `Kolona "${column}" mora biti cijeli broj.`, [
          detail(`normalizedName.${column}`, String(value)),
        ]);
      }
    }

    return { normalized, values: result.values as Record<string, unknown> };
  }

  /** Dodaje strukturirane (identitet) vrijednosti u formu — samo ako polje postoji. */
  private mergeCore(
    definition: FormDefinition,
    values: Record<string, unknown>,
    core: Record<string, unknown>,
  ): Record<string, unknown> {
    const keys = new Set<string>();
    for (const section of definition.sections ?? []) {
      for (const field of section.fields ?? []) keys.add(field.key);
    }

    const merged: Record<string, unknown> = { ...values };
    for (const [key, value] of Object.entries(core)) {
      if (keys.has(key)) merged[key] = value;
    }
    return merged;
  }

  private columnsFrom(normalized: Record<string, unknown>): Record<string, unknown> {
    const columns: Record<string, unknown> = {};
    for (const column of VEHICLE_NORMALIZED_COLUMNS as readonly string[]) {
      if (normalized[column] !== undefined && normalized[column] !== null) {
        columns[column] = normalized[column];
      }
    }
    return columns;
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne
  // ---------------------------------------------------------------------------

  private buildWhere(query: VehicleListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };

    if (query.status) where.status = query.status;
    else if (!query.includeArchived) where.status = { not: 'ARCHIVED' };

    if (query.fuelType) where.fuelType = query.fuelType;

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' };
      where.OR = [
        { internalNo: contains },
        { make: contains },
        { model: contains },
        { plateNumber: contains },
        { vin: contains },
      ];
    }

    if (query.expiringInDays !== undefined) {
      const today = new Date();
      const until = new Date(today.getTime() + query.expiringInDays * 24 * 60 * 60 * 1000);
      where.AND = [
        {
          OR: [
            { registrationExpiresAt: { gte: today, lte: until } },
            { insuranceExpiresAt: { gte: today, lte: until } },
          ],
        },
      ];
    }

    return where;
  }

  private async loadOrThrow(id: string): Promise<VehicleRow> {
    const row = await this.prisma.vehicle.findFirst({
      where: { id, deletedAt: null },
      select: VEHICLE_SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
    return row as VehicleRow;
  }

  private assertVersion(row: VehicleRow, version: number): void {
    if (row.version !== version) {
      throw new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion: row.version });
    }
  }

  private async assertUnique(args: {
    internalNo: string;
    vin: string | null;
    excludeId?: string;
  }): Promise<void> {
    const conflict = await this.prisma.vehicle.findFirst({
      where: {
        deletedAt: null,
        ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
        OR: [{ internalNo: args.internalNo }, ...(args.vin ? [{ vin: args.vin }] : [])],
      },
      select: { id: true, internalNo: true, vin: true },
    });

    if (!conflict) return;

    const field = conflict.internalNo === args.internalNo ? 'internalNo' : 'vin';
    throw new VfmException('DUPLICATE_ENTRY', `Vozilo s tim ${field} već postoji.`, [
      detail(`formData.${field}`, field),
    ]);
  }

  private toSummary(row: VehicleRow): VehicleSummary {
    return {
      id: row.id,
      internalNo: row.internalNo,
      make: row.make,
      model: row.model,
      year: row.year,
      plateNumber: row.plateNumber,
      fuelType: row.fuelType as VehicleSummary['fuelType'],
      status: row.status as VehicleStatus,
      odometerKm: row.odometerKm,
      odometerUpdatedAt: row.odometerUpdatedAt?.toISOString() ?? null,
      registrationExpiresAt: dateOnly(row.registrationExpiresAt),
      insuranceExpiresAt: dateOnly(row.insuranceExpiresAt),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: VehicleRow): VehicleDetail {
    return {
      ...this.toSummary(row),
      vin: row.vin,
      transmission: row.transmission,
      color: row.color,
      bodyType: row.bodyType,
      engineCcm: row.engineCcm,
      enginePowerKw: row.enginePowerKw,
      seats: row.seats,
      ownershipType: row.ownershipType,
      acquisitionDate: dateOnly(row.acquisitionDate),
      acquisitionPrice: row.acquisitionPrice,
      costCenter: row.costCenter,
      nextServiceDueDate: dateOnly(row.nextServiceDueDate),
      nextServiceDueKm: row.nextServiceDueKm,
      notes: row.notes,
      photoAttachmentId: row.photoAttachmentId,
      formSchemaId: row.formSchemaId,
      formSchemaVersionId: row.formSchemaVersionId,
      formData: (row.formData ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Snapshot za audit: bez `formData` (istorija je u `formData`/verziji). */
  private auditSnapshot(row: VehicleRow): Record<string, unknown> {
    return {
      id: row.id,
      internalNo: row.internalNo,
      make: row.make,
      model: row.model,
      status: row.status,
      odometerKm: row.odometerKm,
      plateNumber: row.plateNumber,
      version: row.version,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }
}

/** Statusi iz `VEHICLE_STATUSES` — izvoz za test/validaciju. */
export const VEHICLE_STATUS_VALUES = VEHICLE_STATUSES;
