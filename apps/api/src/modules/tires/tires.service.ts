/** Pregled montaža; prikazuje sačuvane podatke, ne izmišlja pređene km. */
import { Injectable } from '@nestjs/common';
import { toLocalDateString } from '@vfm/shared';
import type { TireInstallationListQuery } from '@vfm/shared/schemas';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
@Injectable()
export class TiresService {
  constructor(private readonly prisma: PrismaService) {}
  async listInstallations(query: TireInstallationListQuery) {
    const where: Prisma.TireInstallationWhereInput = { deletedAt: null };
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.setId) where.setId = query.setId;
    if (query.activeOnly === 'true') where.dismountedAt = null;
    if (query.q?.trim()) where.set = { code: { contains: query.q.trim(), mode: 'insensitive' } };
    const sortBy = ['mountedAt', 'dismountedAt', 'createdAt'].includes(query.sortBy ?? '')
      ? query.sortBy!
      : 'mountedAt';
    const [total, rows] = await Promise.all([
      this.prisma.tireInstallation.count({ where }),
      this.prisma.tireInstallation.findMany({
        where,
        include: { set: { select: { code: true, brand: true, model: true, size: true, season: true } } },
        orderBy: [{ [sortBy]: query.sortBy ? query.sortOrder : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      items: rows.map((row) => ({
        id: row.id,
        vehicleId: row.vehicleId,
        setId: row.setId,
        setCode: row.set.code,
        brand: row.set.brand,
        model: row.set.model,
        size: row.set.size,
        season: row.set.season,
        mountedAt: toLocalDateString(row.mountedAt),
        mountedOdometerKm: row.mountedOdometerKm,
        dismountedAt: row.dismountedAt ? toLocalDateString(row.dismountedAt) : null,
        dismountedOdometerKm: row.dismountedOdometerKm,
        positions: row.positions,
        kmDriven: row.kmDriven,
        daysInUse: row.daysInUse,
        storageLocationOnDismount: row.storageLocationOnDismount,
        reason: row.reason,
        version: row.version,
        formSchemaVersionId: row.formSchemaVersionId,
      })),
    };
  }
}
