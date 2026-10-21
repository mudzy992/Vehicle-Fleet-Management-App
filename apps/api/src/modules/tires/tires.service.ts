/** Kompleti i historija montaža guma; montaža/demontaža se uvode zasebno. */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { toLocalDateString } from '@vfm/shared';
import type {
  CreateTireSetInput,
  TireInstallationListQuery,
  TireSetListQuery,
  TireSetView,
} from '@vfm/shared/schemas';
import { toDatabaseDate } from '../../common/dates.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import {
  detail,
  mergeCoreValues,
  resolveFormVersion,
  validateRecordValues,
} from '../../common/form-record-support.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const TIRE_SET_SELECT = {
  id: true,
  code: true,
  brand: true,
  model: true,
  size: true,
  season: true,
  tireCount: true,
  purchaseDate: true,
  purchasePrice: true,
  currency: true,
  status: true,
  currentLocation: true,
  notes: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  version: true,
} as const satisfies Prisma.TireSetSelect;

type TireSetSelectWithMount = typeof TIRE_SET_SELECT & {
  installations: {
    select: {
      vehicleId: true;
      vehicle: { select: { internalNo: true; plateNumber: true } };
    };
  };
};

type TireSetRow = Prisma.TireSetGetPayload<{ select: TireSetSelectWithMount }>;

const ACTIVE_INSTALLATION_ARGS = {
  where: { dismountedAt: null, deletedAt: null },
  take: 1,
  select: {
    vehicleId: true,
    vehicle: { select: { internalNo: true, plateNumber: true } },
  },
} as const;

function serializeTireSet(row: TireSetRow): TireSetView {
  const active = row.installations[0];
  return {
    id: row.id,
    code: row.code,
    brand: row.brand,
    model: row.model,
    size: row.size,
    season: row.season,
    tireCount: row.tireCount,
    purchaseDate: row.purchaseDate ? toLocalDateString(row.purchaseDate) : null,
    purchasePrice: row.purchasePrice,
    currency: row.currency,
    status: row.status,
    currentLocation: row.currentLocation,
    notes: row.notes,
    mountedVehicleId: active?.vehicleId ?? null,
    mountedVehicleInternalNo: active?.vehicle.internalNo ?? null,
    mountedVehiclePlateNumber: active?.vehicle.plateNumber ?? null,
    version: row.version,
    formSchemaId: row.formSchemaId,
    formSchemaVersionId: row.formSchemaVersionId,
  };
}

function duplicateSetCode(): VfmException {
  return new VfmException('DUPLICATE_ENTRY', 'Komplet guma s tim kodom već postoji.', [
    detail('code', 'Komplet guma s tim kodom već postoji.'),
  ]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class TiresService {
  constructor(private readonly prisma: PrismaService) {}

  async listSets(query: TireSetListQuery) {
    const where: Prisma.TireSetWhereInput = { deletedAt: null };
    if (query.season) where.season = query.season;
    if (query.status) where.status = query.status;
    if (query.availableOnly === 'true') {
      where.AND = [
        { status: 'IN_STOCK' },
        { installations: { none: { dismountedAt: null, deletedAt: null } } },
      ];
    }
    if (query.q?.trim()) {
      const contains = { contains: query.q.trim(), mode: 'insensitive' as const };
      where.OR = [
        { code: contains },
        { brand: contains },
        { model: contains },
        { size: contains },
        { currentLocation: contains },
      ];
    }

    const allowed = ['code', 'brand', 'purchaseDate', 'purchasePrice', 'createdAt'] as const;
    const sortBy = allowed.find((key) => key === query.sortBy) ?? 'code';
    const [total, rows] = await Promise.all([
      this.prisma.tireSet.count({ where }),
      this.prisma.tireSet.findMany({
        where,
        select: { ...TIRE_SET_SELECT, installations: ACTIVE_INSTALLATION_ARGS },
        orderBy: [{ [sortBy]: query.sortBy ? query.sortOrder : 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(serializeTireSet),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Nov komplet uvijek počinje na skladištu; status ne dolazi iz zahtjeva. */
  async createSet(input: CreateTireSetInput, actorId?: string) {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'TIRE_SET',
      versionId: input.formSchemaVersionId,
      entityLabel: 'komplet guma',
    });
    const values = mergeCoreValues(version.definition, input.formData, {
      code: input.code,
      season: input.season,
      tireCount: input.tireCount,
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.purchaseDate !== undefined ? { purchaseDate: input.purchaseDate } : {}),
      ...(input.currentLocation !== undefined ? { currentLocation: input.currentLocation } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    const validated = validateRecordValues({
      subject: 'TIRE_SET',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values,
      isNew: true,
    });

    if (input.purchaseDate && input.purchaseDate > toLocalDateString(new Date())) {
      throw new VfmException('VALIDATION_ERROR', 'Datum nabavke ne može biti u budućnosti.', [
        detail('purchaseDate', 'Datum nabavke ne može biti u budućnosti.'),
      ]);
    }

    const existing = await this.prisma.tireSet.findFirst({
      where: { code: input.code, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw duplicateSetCode();

    try {
      const row = await this.prisma.tireSet.create({
        data: {
          id: randomUUID(),
          code: input.code,
          brand: input.brand ?? null,
          model: input.model ?? null,
          size: input.size ?? null,
          season: input.season,
          tireCount: input.tireCount,
          purchaseDate: toDatabaseDate(input.purchaseDate),
          purchasePrice: input.purchasePrice ?? null,
          currency: 'BAM',
          status: 'IN_STOCK',
          currentLocation: input.currentLocation ?? null,
          notes: input.notes ?? null,
          formSchemaId: version.formSchemaId,
          formSchemaVersionId: version.id,
          formData: validated.values as Prisma.InputJsonObject,
          createdById: actorId ?? null,
        },
        select: { ...TIRE_SET_SELECT, installations: ACTIVE_INSTALLATION_ARGS },
      });
      const data = serializeTireSet(row);
      return { data, after: data };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateSetCode();
      throw error;
    }
  }

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
