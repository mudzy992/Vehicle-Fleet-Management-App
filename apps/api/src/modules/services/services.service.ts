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

  async get(id: string) {
    const row = await this.prisma.serviceRecord.findFirst({
      where: { id, deletedAt: null },
      select: SERVICE_SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
    return serialize(row);
  }
}
