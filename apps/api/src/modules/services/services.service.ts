import type { UpdateServiceInput } from '@vfm/shared/schemas';
import { randomUUID } from 'node:crypto';
import { createServiceSchema, type CreateServiceInput } from '@vfm/shared/schemas';
import {
  resolveFormVersion,
  mergeCoreValues,
  validateRecordValues,
  type ResolvedFormVersion,
} from '../../common/form-record-support.js';
import { toDatabaseDate } from '../../common/dates.js';
/** Pregled servisa: bez izmjene historije i bez pristupa obrisanim zapisima. */
import { Injectable } from '@nestjs/common';
import { toLocalDateString } from '@vfm/shared';
import type { ServiceListQuery } from '@vfm/shared/schemas';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VfmException } from '../../common/errors/vfm-error.js';

const SERVICE_SELECT = {
  id: true,
  vehicleId: true,
  serviceDate: true,
  serviceType: true,
  workshopName: true,
  description: true,
  odometerKm: true,
  totalCost: true,
  currency: true,
  nextServiceDueDate: true,
  nextServiceDueKm: true,
  status: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  version: true,
} as const satisfies Prisma.ServiceRecordSelect;

type Row = Prisma.ServiceRecordGetPayload<{ select: typeof SERVICE_SELECT }>;
function serialize(row: Row) {
  return {
    ...row,
    serviceDate: toLocalDateString(row.serviceDate),
    nextServiceDueDate: row.nextServiceDueDate ? toLocalDateString(row.nextServiceDueDate) : null,
  };
}

interface LockedVehicle {
  id: string;
  odometerKm: number;
  status: string;
  nextServiceDueDate: Date | string | null;
  nextServiceDueKm: number | null;
  version: number;
}

function dateOnly(value: Date | string | null | undefined): string | null {
  return value ? toLocalDateString(value) : null;
}

function vehicleSnapshot(vehicle: LockedVehicle) {
  return {
    id: vehicle.id,
    odometerKm: vehicle.odometerKm,
    nextServiceDueDate: dateOnly(vehicle.nextServiceDueDate),
    nextServiceDueKm: vehicle.nextServiceDueKm,
    version: vehicle.version,
  };
}

/** API kolone su izvor istine; zapisna forma dobija iste vrijednosti na svojim poljima/mapiranjima. */
function syncServiceCoreValues(
  definition: ResolvedFormVersion['definition'],
  values: Record<string, unknown>,
  core: Readonly<Record<string, unknown>>,
): void {
  const fieldKeys = new Set<string>();
  for (const section of definition.sections ?? []) {
    for (const field of section.fields ?? []) fieldKeys.add(field.key);
  }

  for (const [column, value] of Object.entries(core)) {
    if (fieldKeys.has(column)) values[column] = value;
    for (const mapping of definition.normalizedName ?? []) {
      if (mapping.column !== column) continue;
      values[mapping.fieldKey] =
        value !== null && mapping.transform === 'TO_DATETIME' && typeof value === 'string'
          ? `${value}T00:00:00.000Z`
          : value;
    }
  }
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ServiceListQuery) {
    const where: Prisma.ServiceRecordWhereInput = { deletedAt: null };
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.status) where.status = query.status;
    if (query.serviceType) where.serviceType = query.serviceType;
    if (query.q?.trim()) {
      const contains = { contains: query.q.trim(), mode: 'insensitive' as const };
      where.OR = [{ workshopName: contains }, { description: contains }, { serviceType: contains }];
    }
    const allowed = ['serviceDate', 'totalCost', 'createdAt', 'serviceType'] as const;
    const sort = allowed.find((key) => key === query.sortBy) ?? 'serviceDate';
    const [total, rows] = await Promise.all([
      this.prisma.serviceRecord.count({ where }),
      this.prisma.serviceRecord.findMany({
        where,
        select: SERVICE_SELECT,
        orderBy: [{ [sort]: query.sortBy ? query.sortOrder : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(serialize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Vozilo se zaključava prije provjere km; svaki upis je u istoj transakciji. */
  async create(input: CreateServiceInput, actorId?: string) {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'SERVICE',
      versionId: input.formSchemaVersionId,
      entityLabel: 'servis',
    });
    const values = mergeCoreValues(version.definition, input.formData, {
      serviceDate: input.serviceDate,
      odometerKm: input.odometerKm,
      totalCost: { amount: input.totalCost, currency: 'BAM' },
      workshopName: input.workshopName,
      nextServiceDueDate: input.nextServiceDueDate,
      nextServiceDueKm: input.nextServiceDueKm,
    });
    const validated = validateRecordValues({
      subject: 'SERVICE',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values,
      isNew: true,
    });
    // Mapirane vrijednosti prolaze iste granice kao statična polja, ne zaobilaze DTO.
    const parsed = createServiceSchema.safeParse({ ...input, ...validated.normalized });
    if (!parsed.success) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Mapirane vrijednosti servisa nisu ispravne.',
        parsed.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
      );
    }
    const data = parsed.data;
    if (data.serviceDate > toLocalDateString(new Date())) {
      throw new VfmException('VALIDATION_ERROR', 'Datum servisa ne može biti u budućnosti.');
    }
    return this.prisma.$transaction(async (tx) => {
      const vehicles = await tx.$queryRaw<Array<{ id: string; odometerKm: number; status: string }>>`
        SELECT "id", "odometerKm", "status" FROM "Vehicle"
        WHERE "id" = ${data.vehicleId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      const vehicle = vehicles[0];
      if (!vehicle) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
      if (vehicle.status === 'ARCHIVED')
        throw new VfmException('VALIDATION_ERROR', 'Arhiviranom vozilu se ne dodaje servis.');
      if (data.odometerKm !== undefined && data.odometerKm < vehicle.odometerKm) {
        throw new VfmException(
          'ODOMETER_REGRESSION',
          'Kilometraža je manja od trenutne. Koristite zasebnu auditovanu korekciju kilometraže.',
        );
      }
      const row = await tx.serviceRecord.create({
        data: {
          id: randomUUID(),
          vehicleId: data.vehicleId,
          serviceDate: toDatabaseDate(data.serviceDate)!,
          serviceType: data.serviceType,
          workshopName: data.workshopName ?? null,
          description: data.description ?? null,
          totalCost: data.totalCost,
          odometerKm: data.odometerKm ?? null,
          nextServiceDueDate: toDatabaseDate(data.nextServiceDueDate),
          nextServiceDueKm: data.nextServiceDueKm ?? null,
          attachmentIds: [],
          formSchemaId: version.formSchemaId,
          formSchemaVersionId: version.id,
          formData: validated.values as Prisma.InputJsonObject,
          createdById: actorId ?? null,
        },
        select: SERVICE_SELECT,
      });
      const now = new Date();
      if (data.odometerKm !== undefined) {
        await tx.odometerReading.create({
          data: {
            id: randomUUID(),
            vehicleId: data.vehicleId,
            valueKm: data.odometerKm,
            source: 'SERVICE',
            referenceType: 'ServiceRecord',
            referenceId: row.id,
            readingAt: now,
            recordedById: actorId ?? null,
          },
        });
      }
      // Historijski servis ne smije prepisati rok novijeg servisa.
      const latest = await tx.serviceRecord.findFirst({
        where: { vehicleId: data.vehicleId, deletedAt: null, status: 'ACTIVE' },
        orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { nextServiceDueDate: true, nextServiceDueKm: true },
      });
      await tx.vehicle.update({
        where: { id: data.vehicleId },
        data: {
          ...(data.odometerKm !== undefined ? { odometerKm: data.odometerKm, odometerUpdatedAt: now } : {}),
          nextServiceDueDate: latest?.nextServiceDueDate ?? null,
          nextServiceDueKm: latest?.nextServiceDueKm ?? null,
          version: { increment: 1 },
        },
      });
      return { data: serialize(row), after: { ...serialize(row), previousOdometerKm: vehicle.odometerKm } };
    });
  }

  /**
   * Potpuna izmjena servisa u jednoj transakciji.
   *
   * Datum/km/rokovi se usklađuju sa zapisnom formom i normalizovanim kolonama.
   * PATCH ne zaobilazi zasebnu korekciju trenutne kilometraže: nova servisna
   * km manja od zaključane trenutne km vozila je regresija. Ako ispravka
   * servisne km podiže trenutnu vrijednost, dodaje se novo SERVICE očitanje
   * (historija očitanja se ne prepisuje), a rokovi vozila se ponovo računaju
   * iz najnovijeg aktivnog servisa.
   */
  async update(id: string, input: UpdateServiceInput, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceRecord.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
      if (current.version !== input.version)
        throw new VfmException('VERSION_CONFLICT', 'Servis je izmijenjen. Ponovo učitajte evidenciju.');

      const before = serialize({
        id: current.id,
        vehicleId: current.vehicleId,
        serviceDate: current.serviceDate,
        serviceType: current.serviceType,
        workshopName: current.workshopName,
        description: current.description,
        odometerKm: current.odometerKm,
        totalCost: current.totalCost,
        currency: current.currency,
        nextServiceDueDate: current.nextServiceDueDate,
        nextServiceDueKm: current.nextServiceDueKm,
        status: current.status,
        formSchemaId: current.formSchemaId,
        formSchemaVersionId: current.formSchemaVersionId,
        version: current.version,
      });

      const touchesSchedule =
        input.serviceDate !== undefined ||
        input.odometerKm !== undefined ||
        input.nextServiceDueDate !== undefined ||
        input.nextServiceDueKm !== undefined;
      const effective = {
        serviceDate: input.serviceDate ?? toLocalDateString(current.serviceDate),
        serviceType: input.serviceType ?? current.serviceType,
        workshopName: input.workshopName !== undefined ? input.workshopName : current.workshopName,
        description: input.description !== undefined ? input.description : current.description,
        odometerKm: input.odometerKm !== undefined ? input.odometerKm : current.odometerKm,
        nextServiceDueDate:
          input.nextServiceDueDate !== undefined
            ? input.nextServiceDueDate
            : dateOnly(current.nextServiceDueDate),
        nextServiceDueKm:
          input.nextServiceDueKm !== undefined ? input.nextServiceDueKm : current.nextServiceDueKm,
      };

      if (input.serviceDate !== undefined && effective.serviceDate > toLocalDateString(new Date())) {
        throw new VfmException('VALIDATION_ERROR', 'Datum servisa ne može biti u budućnosti.', [
          { path: ['serviceDate'], message: 'Datum je u budućnosti.' },
        ]);
      }
      if (touchesSchedule) {
        if (effective.nextServiceDueDate && effective.nextServiceDueDate < effective.serviceDate) {
          throw new VfmException('VALIDATION_ERROR', 'Sljedeći servis ne može prethoditi ovom servisu.', [
            { path: ['nextServiceDueDate'], message: 'Rok je prije datuma servisa.' },
          ]);
        }
        if (
          effective.odometerKm !== null &&
          effective.nextServiceDueKm !== null &&
          effective.nextServiceDueKm < effective.odometerKm
        ) {
          throw new VfmException(
            'VALIDATION_ERROR',
            'Sljedeći servis ne može biti na manjoj kilometraži od ovog servisa.',
            [{ path: ['nextServiceDueKm'], message: 'Rok je ispod kilometraže servisa.' }],
          );
        }
      }

      const version = await resolveFormVersion(tx as never, {
        subject: 'SERVICE',
        versionId: current.formSchemaVersionId,
        entityLabel: 'servis',
      });
      const values = { ...(current.formData as Record<string, unknown>) };
      const coreByColumn = {
        serviceDate: effective.serviceDate,
        odometerKm: effective.odometerKm,
        workshopName: effective.workshopName,
        nextServiceDueDate: effective.nextServiceDueDate,
        nextServiceDueKm: effective.nextServiceDueKm,
      };
      syncServiceCoreValues(version.definition, values, coreByColumn);
      const validated = validateRecordValues({
        subject: 'SERVICE',
        definition: version.definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status,
        values,
        isNew: false,
      });
      for (const [column, expected] of Object.entries(coreByColumn)) {
        const actual = validated.normalized[column];
        if (actual === undefined || expected === null) continue;
        const matches = column.endsWith('Date')
          ? String(actual).slice(0, 10) === expected
          : actual === expected;
        if (!matches) {
          throw new VfmException(
            'NORMALIZATION_MISMATCH',
            `Mapirana vrijednost za "${column}" se razlikuje od unosa.`,
          );
        }
      }

      let vehicle: LockedVehicle | undefined;
      let vehicleBefore: ReturnType<typeof vehicleSnapshot> | undefined;
      if (touchesSchedule) {
        vehicle = await this.lockVehicle(tx, current.vehicleId);
        vehicleBefore = vehicleSnapshot(vehicle);
        if (
          input.odometerKm !== undefined &&
          effective.odometerKm !== null &&
          effective.odometerKm !== current.odometerKm &&
          effective.odometerKm < vehicle.odometerKm
        ) {
          throw new VfmException(
            'ODOMETER_REGRESSION',
            'Kilometraža servisa je manja od trenutne kilometraže vozila. ' +
              'Niža trenutna vrijednost ide kroz zasebnu auditovanu korekciju kilometraže.',
            [{ path: ['odometerKm'], message: `Trenutno: ${vehicle.odometerKm} km` }],
            { currentKm: vehicle.odometerKm },
          );
        }
      }

      const changed = await tx.serviceRecord.updateMany({
        where: {
          id,
          version: input.version,
          deletedAt: null,
          status: 'ACTIVE',
          vehicle: { deletedAt: null, status: { not: 'ARCHIVED' } },
        },
        data: {
          ...(input.serviceDate !== undefined ? { serviceDate: toDatabaseDate(effective.serviceDate)! } : {}),
          ...(input.serviceType !== undefined ? { serviceType: input.serviceType } : {}),
          ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.odometerKm !== undefined ? { odometerKm: effective.odometerKm } : {}),
          ...(input.nextServiceDueDate !== undefined
            ? { nextServiceDueDate: toDatabaseDate(effective.nextServiceDueDate) }
            : {}),
          ...(input.nextServiceDueKm !== undefined ? { nextServiceDueKm: effective.nextServiceDueKm } : {}),
          formData: validated.values as Prisma.InputJsonObject,
          version: { increment: 1 },
        },
      });
      if (!changed.count) {
        const latest = await tx.serviceRecord.findFirst({ where: { id, deletedAt: null } });
        if (!latest) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
        if (latest.version !== input.version)
          throw new VfmException('VERSION_CONFLICT', 'Servis je izmijenjen. Ponovo učitajte evidenciju.');
        throw new VfmException('VALIDATION_ERROR', 'Mijenja se samo aktivni servis nearhiviranog vozila.');
      }

      const updated = await tx.serviceRecord.findUniqueOrThrow({ where: { id }, select: SERVICE_SELECT });
      let vehicleAfter = vehicleBefore;

      if (vehicle && vehicleBefore) {
        const now = new Date();
        const kmChanged = input.odometerKm !== undefined && effective.odometerKm !== current.odometerKm;
        const raisedVehicleOdometerKm =
          kmChanged &&
          effective.odometerKm !== null &&
          effective.odometerKm > vehicle.odometerKm &&
          (current.odometerKm === null || effective.odometerKm > current.odometerKm)
            ? effective.odometerKm
            : null;

        if (raisedVehicleOdometerKm !== null) {
          await tx.odometerReading.create({
            data: {
              id: randomUUID(),
              vehicleId: current.vehicleId,
              valueKm: raisedVehicleOdometerKm,
              source: 'SERVICE',
              referenceType: 'ServiceRecord',
              referenceId: id,
              readingAt: now,
              recordedById: actorId ?? null,
            },
          });
        }

        const latest = await tx.serviceRecord.findFirst({
          where: { vehicleId: current.vehicleId, deletedAt: null, status: 'ACTIVE' },
          orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          select: { nextServiceDueDate: true, nextServiceDueKm: true },
        });
        const nextServiceDueDate = latest?.nextServiceDueDate ?? null;
        const nextServiceDueKm = latest?.nextServiceDueKm ?? null;
        const dueChanged =
          dateOnly(nextServiceDueDate) !== dateOnly(vehicle.nextServiceDueDate) ||
          nextServiceDueKm !== vehicle.nextServiceDueKm;

        if (raisedVehicleOdometerKm !== null || dueChanged) {
          await tx.vehicle.update({
            where: { id: vehicle.id },
            data: {
              ...(raisedVehicleOdometerKm !== null
                ? { odometerKm: raisedVehicleOdometerKm, odometerUpdatedAt: now }
                : {}),
              ...(dueChanged ? { nextServiceDueDate, nextServiceDueKm } : {}),
              version: { increment: 1 },
            },
          });
          vehicleAfter = {
            ...vehicleBefore,
            ...(raisedVehicleOdometerKm !== null ? { odometerKm: raisedVehicleOdometerKm } : {}),
            ...(dueChanged ? { nextServiceDueDate: dateOnly(nextServiceDueDate), nextServiceDueKm } : {}),
            version: vehicle.version + 1,
          };
        }
      }

      return {
        data: serialize(updated),
        before,
        after: serialize(updated),
        vehicleBefore,
        vehicleAfter,
      };
    });
  }

  private async lockVehicle(tx: Prisma.TransactionClient, vehicleId: string): Promise<LockedVehicle> {
    const rows = await tx.$queryRaw<LockedVehicle[]>`
      SELECT "id", "odometerKm", "status", "nextServiceDueDate", "nextServiceDueKm", "version"
      FROM "Vehicle"
      WHERE "id" = ${vehicleId}::uuid AND "deletedAt" IS NULL
      FOR UPDATE`;
    const vehicle = rows[0];
    if (!vehicle || vehicle.status === 'ARCHIVED') {
      throw new VfmException('VALIDATION_ERROR', 'Mijenja se samo aktivni servis nearhiviranog vozila.');
    }
    return vehicle;
  }

  async get(id: string) {
    const row = await this.prisma.serviceRecord.findFirst({
      where: { id, deletedAt: null },
      select: SERVICE_SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
    return serialize(row);
  }
}
