import type { UpdateServiceInput } from '@vfm/shared/schemas';
import { randomUUID } from 'node:crypto';
import { createServiceSchema, type CreateServiceInput } from '@vfm/shared/schemas';
import {
  resolveFormVersion,
  mergeCoreValues,
  validateRecordValues,
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

  /** Metapodaci ne smiju prepisati stavke računa ili očitanja kilometraže. */
  async update(id: string, input: UpdateServiceInput) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceRecord.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
      if (current.version !== input.version)
        throw new VfmException('VERSION_CONFLICT', 'Servis je izmijenjen. Ponovo učitajte evidenciju.');
      const version = await resolveFormVersion(tx as never, {
        subject: 'SERVICE',
        versionId: current.formSchemaVersionId,
        entityLabel: 'servis',
      });
      const values = { ...(current.formData as Record<string, unknown>) };
      if (input.workshopName !== undefined) {
        // Zapis ostaje na svojoj verziji; radionica se usklađuje i s mapiranim poljem.
        for (const mapping of version.definition.normalizedName ?? []) {
          if (mapping.column === 'workshopName') values[mapping.fieldKey] = input.workshopName;
        }
        const hasCore = version.definition.sections.some((section) =>
          section.fields.some((field) => field.key === 'workshopName'),
        );
        if (hasCore) values.workshopName = input.workshopName;
      }
      const validated = validateRecordValues({
        subject: 'SERVICE',
        definition: version.definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status,
        values,
        isNew: false,
      });
      if (
        input.workshopName !== undefined &&
        validated.normalized.workshopName !== undefined &&
        validated.normalized.workshopName !== input.workshopName
      ) {
        throw new VfmException('NORMALIZATION_MISMATCH', 'Mapirana radionica se razlikuje od unosa.');
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
          ...(input.serviceType !== undefined ? { serviceType: input.serviceType } : {}),
          ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
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
      return {
        data: serialize(updated),
        before: {
          serviceType: current.serviceType,
          workshopName: current.workshopName,
          description: current.description,
          version: current.version,
        },
        after: serialize(updated),
      };
    });
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
