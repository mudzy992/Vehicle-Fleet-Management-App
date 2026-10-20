/**
 * `InsurancesService` — historija osiguranja vozila (docs/07 §2.6, docs/03 §3.3).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Bez preklapanja perioda po vozilu** (B-10) — isto kao registracije, ali
 *    nad `InsuranceRecord` (`ex_insurance_period_no_overlap`).
 * 2. **Denormalizovani rok na vozilu.** Nakon svake promjene
 *    `Vehicle.insuranceExpiresAt` se postavlja na najdalji `validUntil`
 *    važećih polisa — u **istoj** transakciji, inače lista vozila i podsjetnici
 *    vide stari rok.
 * 3. **Zapis je forma.** `formData` se validira prema tačnoj verziji forme
 *    (P11), a `formSchemaVersionId` se ne mijenja kroz `PATCH` (migracija je
 *    eksplicitna, P12).
 * 4. **Brisanje je soft-delete** — historija ostaje, a period se oslobađa
 *    (`deletedAt` izuzima red iz `EXCLUDE` constrainta).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail } from '@vfm/shared';
import { toLocalDateString } from '@vfm/shared';
import type {
  CreateInsuranceInput,
  InsuranceListQuery,
  InsuranceListResponse,
  InsuranceRecord,
  UpdateInsuranceInput,
} from '@vfm/shared/schemas';
import { NORMALIZATION_COLUMNS } from '@vfm/form-engine';
import type { Prisma } from '../../generated/prisma/client.js';
import { detail, mapExclusionViolation, periodsOverlap } from '../../common/period-records.js';
import {
  mergeCoreValues,
  resolveFormVersion,
  validateRecordValues,
} from '../../common/form-record-support.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface InsuranceMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/** Kolone registracije koje forma smije puniti (docs/04 §7). */
export const INSURANCE_NORMALIZED_COLUMNS = NORMALIZATION_COLUMNS.INSURANCE ?? [];

const EXCLUSION_CONSTRAINT = 'ex_insurance_period_no_overlap';

/**
 * Dozvoljene promjene statusa kroz `PATCH`.
 *
 * `EXPIRED` postavlja sistem (worker nad `validUntil`), `ARCHIVED` je arhiva
 * evidencije — ni jedno se ne piše ručno, da rok na vozilu ne bi „pobjegao".
 */
export const RECORD_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['CANCELLED'],
  EXPIRED: ['CANCELLED'],
  CANCELLED: ['ACTIVE'],
  ARCHIVED: [],
};

const SORTABLE: Readonly<Record<string, string>> = {
  validUntil: 'validUntil',
  validFrom: 'validFrom',
  policyNumber: 'policyNumber',
  insuranceCompany: 'insuranceCompany',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const SELECT = {
  id: true,
  vehicleId: true,
  policyNumber: true,
  insuranceCompany: true,
  type: true,
  validFrom: true,
  validUntil: true,
  premiumAmount: true,
  deductibleAmount: true,
  currency: true,
  status: true,
  notes: true,
  attachmentIds: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  formData: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

interface InsuranceRow {
  id: string;
  vehicleId: string;
  policyNumber: string | null;
  insuranceCompany: string | null;
  type: string | null;
  validFrom: Date;
  validUntil: Date;
  premiumAmount: number | null;
  deductibleAmount: number | null;
  currency: string;
  status: string;
  notes: string | null;
  attachmentIds: string[];
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function dateOnly(value: Date): string {
  return toLocalDateString(value);
}

/** Broj dana do `validUntil` (negativan = isteklo). */
export function daysLeft(validUntil: string, today = toLocalDateString(new Date())): number {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${validUntil}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

@Injectable()
export class InsurancesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: InsuranceListQuery): Promise<InsuranceListResponse> {
    const where = this.buildWhere(query);
    const sortBy = SORTABLE[query.sortBy ?? ''] ?? 'validUntil';
    const orderBy = { [sortBy]: query.sortOrder } as Prisma.InsuranceRecordOrderByWithRelationInput;

    const [total, rows] = await Promise.all([
      this.prisma.insuranceRecord.count({ where }),
      this.prisma.insuranceRecord.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SELECT,
      }),
    ]);

    return {
      items: (rows as InsuranceRow[]).map((row) => this.toRecord(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<InsuranceRecord> {
    return this.toRecord(await this.loadOrThrow(id));
  }

  // ---------------------------------------------------------------------------
  //  Upis
  // ---------------------------------------------------------------------------

  async create(input: CreateInsuranceInput, actorId?: string): Promise<InsuranceMutation<InsuranceRecord>> {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'INSURANCE',
      ...(input.formSchemaVersionId ? { versionId: input.formSchemaVersionId } : {}),
      entityLabel: 'polisa',
    });

    const merged = mergeCoreValues(version.definition, input.formData, {
      ...(input.policyNumber ? { policyNumber: input.policyNumber } : {}),
      ...(input.insuranceCompany ? { insuranceCompany: input.insuranceCompany } : {}),
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      // Forma drži novac kao `{ amount, currency }` (feninzi, docs/04 §5).
      ...(input.premiumAmount !== undefined && input.premiumAmount !== null
        ? { costAmount: { amount: input.premiumAmount, currency: 'BAM' } }
        : {}),
    });

    const validated = validateRecordValues({
      subject: 'INSURANCE',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values: merged,
      isNew: true,
    });

    await this.assertVehicle(input.vehicleId);
    await this.assertNoOverlap({
      vehicleId: input.vehicleId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });

    const validFrom = (validated.normalized.validFrom as string | undefined) ?? input.validFrom;
    const validUntil = (validated.normalized.validUntil as string | undefined) ?? input.validUntil;
    const premiumAmount =
      (validated.normalized.costAmount as number | undefined) ?? input.premiumAmount ?? null;

    const created = await this.run(async (tx) => {
      const row = await tx.insuranceRecord.create({
        data: {
          id: randomUUID(),
          vehicleId: input.vehicleId,
          formSchemaId: version.formSchemaId,
          formSchemaVersionId: version.id,
          formData: validated.values,
          policyNumber:
            (validated.normalized.policyNumber as string | undefined) ?? input.policyNumber ?? null,
          insuranceCompany:
            (validated.normalized.insuranceCompany as string | undefined) ?? input.insuranceCompany ?? null,
          type: input.type ?? null,
          validFrom,
          validUntil,
          premiumAmount,
          deductibleAmount: input.deductibleAmount ?? null,
          attachmentIds: input.attachmentIds ?? [],
          notes: input.notes ?? null,
          createdById: actorId ?? null,
        } as unknown as Prisma.InsuranceRecordUncheckedCreateInput,
        select: SELECT,
      });

      await this.syncVehicleExpiry(tx, input.vehicleId);
      return row as InsuranceRow;
    });

    return { data: this.toRecord(created), after: this.auditSnapshot(created) };
  }

  async update(id: string, input: UpdateInsuranceInput): Promise<InsuranceMutation<InsuranceRecord>> {
    const current = await this.loadOrThrow(id);
    this.assertVersion(current, input.version);

    const data: Record<string, unknown> = {};
    for (const key of [
      'policyNumber',
      'insuranceCompany',
      'type',
      'premiumAmount',
      'deductibleAmount',
      'notes',
      'attachmentIds',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }

    const validFrom = input.validFrom ?? dateOnly(current.validFrom);
    const validUntil = input.validUntil ?? dateOnly(current.validUntil);
    if (input.validFrom !== undefined || input.validUntil !== undefined) {
      if (validUntil < validFrom) {
        throw new VfmException('VALIDATION_ERROR', 'Datum isteka ne može biti prije datuma početka.', [
          detail('validUntil', 'period'),
        ]);
      }
      data.validFrom = validFrom;
      data.validUntil = validUntil;
      await this.assertNoOverlap({
        vehicleId: current.vehicleId,
        validFrom,
        validUntil,
        excludeId: id,
      });
    }

    if (input.status && input.status !== current.status) {
      const allowed = RECORD_STATUS_TRANSITIONS[current.status] ?? [];
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

      const validated = validateRecordValues({
        subject: 'INSURANCE',
        definition: (
          await resolveFormVersion(this.prisma as never, {
            subject: 'INSURANCE',
            versionId: version.id,
            entityLabel: 'polisa',
          })
        ).definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
        values: {
          ...((current.formData ?? {}) as Record<string, unknown>),
          ...input.formData,
        },
        isNew: false,
      });
      data.formData = validated.values;
    }

    const updated = await this.run(async (tx) => {
      const result = await tx.insuranceRecord.updateMany({
        where: { id, version: input.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });

      if (result.count === 0) {
        const fresh = await tx.insuranceRecord.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Polisa osiguranja nije pronađena.');
        throw new VfmException('VERSION_CONFLICT', undefined, undefined, {
          currentVersion: fresh.version,
        });
      }

      await this.syncVehicleExpiry(tx, current.vehicleId);

      const row = await tx.insuranceRecord.findFirst({ where: { id }, select: SELECT });
      if (!row) throw new VfmException('NOT_FOUND', 'Polisa osiguranja nije pronađena.');
      return row as InsuranceRow;
    });

    return {
      data: this.toRecord(updated),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(updated),
    };
  }

  /** Soft-delete: zapis ostaje u historiji, a period se oslobađa. */
  async remove(id: string, actorId?: string): Promise<InsuranceMutation<{ id: string }>> {
    const current = await this.loadOrThrow(id);

    await this.run(async (tx) => {
      await tx.insuranceRecord.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.syncVehicleExpiry(tx, current.vehicleId);
    });

    return {
      data: { id },
      before: this.auditSnapshot(current),
      after: { id, deletedAt: new Date().toISOString(), deletedById: actorId ?? null },
    };
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne
  // ---------------------------------------------------------------------------

  private async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      mapExclusionViolation(error, EXCLUSION_CONSTRAINT);
    }
  }

  /**
   * `Vehicle.insuranceExpiresAt` = najdalji `validUntil` važećih polisa.
   *
   * Otkazane i arhivirane polise ne drže rok; brisanje ih izuzima, pa
   * vraćanje na prethodni rok radi bez posebne „recalculate" rute.
   */
  private async syncVehicleExpiry(tx: Prisma.TransactionClient, vehicleId: string): Promise<void> {
    const latest = await tx.insuranceRecord.aggregate({
      where: {
        vehicleId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      _max: { validUntil: true },
    });

    await tx.vehicle.updateMany({
      where: { id: vehicleId },
      data: { insuranceExpiresAt: latest._max.validUntil ?? null },
    });
  }

  private async assertVehicle(vehicleId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.', [detail('vehicleId', vehicleId)]);
    }
  }

  private async assertNoOverlap(args: {
    vehicleId: string;
    validFrom: string;
    validUntil: string;
    excludeId?: string;
  }): Promise<void> {
    const candidates = await this.prisma.insuranceRecord.findMany({
      where: {
        vehicleId: args.vehicleId,
        deletedAt: null,
        ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      },
      select: { id: true, validFrom: true, validUntil: true },
    });

    const conflict = (candidates as Array<{ id: string; validFrom: Date; validUntil: Date }>).find(
      (candidate) =>
        periodsOverlap(
          { validFrom: args.validFrom, validUntil: args.validUntil },
          { validFrom: candidate.validFrom, validUntil: candidate.validUntil },
        ),
    );

    if (conflict) {
      throw new VfmException(
        'PERIOD_OVERLAP',
        'Period se preklapa s postojećom polisom osiguranja.',
        [
          detail('validFrom', dateOnly(conflict.validFrom)),
          detail('validUntil', dateOnly(conflict.validUntil)),
        ],
        { conflictingId: conflict.id },
      );
    }
  }

  private buildWhere(query: InsuranceListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.status) where.status = query.status;

    if (query.type) where.type = query.type;

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' };
      where.OR = [{ policyNumber: contains }, { insuranceCompany: contains }];
    }

    if (query.expiringInDays !== undefined) {
      const today = new Date();
      const until = new Date(today.getTime() + query.expiringInDays * 24 * 60 * 60 * 1000);
      where.validUntil = { gte: today, lte: until };
      where.status = 'ACTIVE';
    }

    return where;
  }

  private async loadOrThrow(id: string): Promise<InsuranceRow> {
    const row = await this.prisma.insuranceRecord.findFirst({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Polisa osiguranja nije pronađena.');
    return row as InsuranceRow;
  }

  private assertVersion(row: InsuranceRow, version: number): void {
    if (row.version !== version) {
      throw new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion: row.version });
    }
  }

  private toRecord(row: InsuranceRow): InsuranceRecord {
    const validFrom = dateOnly(row.validFrom);
    const validUntil = dateOnly(row.validUntil);
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      policyNumber: row.policyNumber,
      insuranceCompany: row.insuranceCompany,
      type: row.type,
      validFrom,
      validUntil,
      premiumAmount: row.premiumAmount,
      deductibleAmount: row.deductibleAmount,
      currency: row.currency,
      status: row.status as InsuranceRecord['status'],
      notes: row.notes,
      attachmentIds: row.attachmentIds,
      daysLeft: daysLeft(validUntil),
      formSchemaId: row.formSchemaId,
      formSchemaVersionId: row.formSchemaVersionId,
      formData: (row.formData ?? {}) as Record<string, unknown>,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private auditSnapshot(row: InsuranceRow): Record<string, unknown> {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      policyNumber: row.policyNumber,
      validFrom: dateOnly(row.validFrom),
      validUntil: dateOnly(row.validUntil),
      status: row.status,
      version: row.version,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }
}

/** Izvoz za kontroler/test: tip greške s detaljima polja. */
export type { ApiErrorDetail };
