/**
 * `RegistrationsService` — historija registracija vozila (docs/07 §2.6, docs/03 §3.3).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Bez preklapanja perioda po vozilu** (B-10). Servis provjerava prije
 *    upisa i vraća `409 PERIOD_OVERLAP` s ID-jem zapisa s kojim se period
 *    preklapa; baza isto čuva `EXCLUDE USING gist` constraintom, pa se i ta
 *    greška mapira na isti kod (dva paralelna zahtjeva).
 * 2. **Denormalizovani rok na vozilu.** Nakon svake promjene
 *    `Vehicle.registrationExpiresAt` se postavlja na najdalji `validUntil`
 *    važećih zapisa — u **istoj** transakciji, inače lista vozila i podsjetnici
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
  CreateRegistrationInput,
  RegistrationListQuery,
  RegistrationListResponse,
  RegistrationRecord,
  UpdateRegistrationInput,
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
import { toDatabaseDate } from '../../common/dates.js';

export interface RegistrationMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/** Kolone registracije koje forma smije puniti (docs/04 §7). */
export const REGISTRATION_NORMALIZED_COLUMNS = NORMALIZATION_COLUMNS.REGISTRATION ?? [];

const EXCLUSION_CONSTRAINT = 'ex_registration_period_no_overlap';

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
  registrationNumber: 'registrationNumber',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const SELECT = {
  id: true,
  vehicleId: true,
  registrationNumber: true,
  validFrom: true,
  validUntil: true,
  issuedBy: true,
  costAmount: true,
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

interface RegistrationRow {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  validFrom: Date;
  validUntil: Date;
  issuedBy: string | null;
  costAmount: number | null;
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
export class RegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: RegistrationListQuery): Promise<RegistrationListResponse> {
    const where = this.buildWhere(query);
    const sortBy = SORTABLE[query.sortBy ?? ''] ?? 'validUntil';
    const orderBy = { [sortBy]: query.sortOrder } as Prisma.RegistrationRecordOrderByWithRelationInput;

    const [total, rows] = await Promise.all([
      this.prisma.registrationRecord.count({ where }),
      this.prisma.registrationRecord.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SELECT,
      }),
    ]);

    return {
      items: (rows as RegistrationRow[]).map((row) => this.toRecord(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<RegistrationRecord> {
    return this.toRecord(await this.loadOrThrow(id));
  }

  // ---------------------------------------------------------------------------
  //  Upis
  // ---------------------------------------------------------------------------

  async create(
    input: CreateRegistrationInput,
    actorId?: string,
  ): Promise<RegistrationMutation<RegistrationRecord>> {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'REGISTRATION',
      ...(input.formSchemaVersionId ? { versionId: input.formSchemaVersionId } : {}),
      entityLabel: 'registracija',
    });

    const merged = mergeCoreValues(version.definition, input.formData, {
      registrationNumber: input.registrationNumber,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      // Forma drži novac kao `{ amount, currency }` (feninzi, docs/04 §5).
      ...(input.costAmount !== undefined && input.costAmount !== null
        ? { costAmount: { amount: input.costAmount, currency: 'BAM' } }
        : {}),
    });

    const validated = await validateRecordValues({
      prisma: this.prisma,
      subject: 'REGISTRATION',
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

    const registrationNumber =
      (validated.normalized.registrationNumber as string | undefined) ?? input.registrationNumber;
    const validFrom = (validated.normalized.validFrom as string | undefined) ?? input.validFrom;
    const validUntil = (validated.normalized.validUntil as string | undefined) ?? input.validUntil;
    const costAmount = (validated.normalized.costAmount as number | undefined) ?? input.costAmount ?? null;

    const created = await this.run(async (tx) => {
      const row = await tx.registrationRecord.create({
        data: {
          id: randomUUID(),
          vehicleId: input.vehicleId,
          formSchemaId: version.formSchemaId,
          formSchemaVersionId: version.id,
          formData: validated.values,
          registrationNumber,
          // `@db.Date` u Prismi traži DateTime — vidi `common/dates.ts`.
          validFrom: toDatabaseDate(validFrom),
          validUntil: toDatabaseDate(validUntil),
          issuedBy: input.issuedBy ?? null,
          costAmount,
          attachmentIds: input.attachmentIds ?? [],
          notes: input.notes ?? null,
          createdById: actorId ?? null,
        } as unknown as Prisma.RegistrationRecordUncheckedCreateInput,
        select: SELECT,
      });

      await this.syncVehicleExpiry(tx, input.vehicleId);
      return row as RegistrationRow;
    });

    return { data: this.toRecord(created), after: this.auditSnapshot(created) };
  }

  async update(
    id: string,
    input: UpdateRegistrationInput,
  ): Promise<RegistrationMutation<RegistrationRecord>> {
    const current = await this.loadOrThrow(id);
    this.assertVersion(current, input.version);

    const data: Record<string, unknown> = {};
    for (const key of ['registrationNumber', 'issuedBy', 'costAmount', 'notes', 'attachmentIds'] as const) {
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
      data.validFrom = toDatabaseDate(validFrom);
      data.validUntil = toDatabaseDate(validUntil);
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

      const validated = await validateRecordValues({
        prisma: this.prisma,
        subject: 'REGISTRATION',
        definition: (
          await resolveFormVersion(this.prisma as never, {
            subject: 'REGISTRATION',
            versionId: version.id,
            entityLabel: 'registracija',
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
      const result = await tx.registrationRecord.updateMany({
        where: { id, version: input.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });

      if (result.count === 0) {
        const fresh = await tx.registrationRecord.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Registracija nije pronađena.');
        throw new VfmException('VERSION_CONFLICT', undefined, undefined, {
          currentVersion: fresh.version,
        });
      }

      await this.syncVehicleExpiry(tx, current.vehicleId);

      const row = await tx.registrationRecord.findFirst({ where: { id }, select: SELECT });
      if (!row) throw new VfmException('NOT_FOUND', 'Registracija nije pronađena.');
      return row as RegistrationRow;
    });

    return {
      data: this.toRecord(updated),
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(updated),
    };
  }

  /** Soft-delete: zapis ostaje u historiji, a period se oslobađa. */
  async remove(id: string, actorId?: string): Promise<RegistrationMutation<{ id: string }>> {
    const current = await this.loadOrThrow(id);

    await this.run(async (tx) => {
      await tx.registrationRecord.update({
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
   * `Vehicle.registrationExpiresAt` = najdalji `validUntil` važećih zapisa.
   *
   * Otkazane i arhivirane registracije ne drže rok; brisanje ih izuzima, pa
   * vraćanje na prethodni rok radi bez posebne „recalculate" rute.
   */
  private async syncVehicleExpiry(tx: Prisma.TransactionClient, vehicleId: string): Promise<void> {
    const latest = await tx.registrationRecord.aggregate({
      where: {
        vehicleId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      _max: { validUntil: true },
    });

    await tx.vehicle.updateMany({
      where: { id: vehicleId },
      data: { registrationExpiresAt: latest._max.validUntil ?? null },
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
    const candidates = await this.prisma.registrationRecord.findMany({
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
        'Period se preklapa s postojećom registracijom.',
        [
          detail('validFrom', dateOnly(conflict.validFrom)),
          detail('validUntil', dateOnly(conflict.validUntil)),
        ],
        { conflictingId: conflict.id },
      );
    }
  }

  private buildWhere(query: RegistrationListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.status) where.status = query.status;

    if (query.q) {
      where.registrationNumber = { contains: query.q, mode: 'insensitive' };
    }

    if (query.expiringInDays !== undefined) {
      // `@db.Date` ne nosi vrijeme: granica je početak **lokalnog** dana
      // (`Europe/Sarajevo`), inače zapis koji ističe danas ispadne iz liste.
      const today = toDatabaseDate(toLocalDateString(new Date()))!;
      const until = new Date(today.getTime() + query.expiringInDays * 24 * 60 * 60 * 1000);
      where.validUntil = { gte: today, lte: until };
      where.status = 'ACTIVE';
    }

    return where;
  }

  private async loadOrThrow(id: string): Promise<RegistrationRow> {
    const row = await this.prisma.registrationRecord.findFirst({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Registracija nije pronađena.');
    return row as RegistrationRow;
  }

  private assertVersion(row: RegistrationRow, version: number): void {
    if (row.version !== version) {
      throw new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion: row.version });
    }
  }

  private toRecord(row: RegistrationRow): RegistrationRecord {
    const validFrom = dateOnly(row.validFrom);
    const validUntil = dateOnly(row.validUntil);
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      registrationNumber: row.registrationNumber,
      validFrom,
      validUntil,
      issuedBy: row.issuedBy,
      costAmount: row.costAmount,
      currency: row.currency,
      status: row.status as RegistrationRecord['status'],
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

  private auditSnapshot(row: RegistrationRow): Record<string, unknown> {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      registrationNumber: row.registrationNumber,
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
