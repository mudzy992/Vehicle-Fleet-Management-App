/** Evidencija i životni ciklus kompleta guma. */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  TIRE_POSITIONS,
  TIRE_SET_MANUAL_STATUS_TRANSITIONS,
  toLocalDateString,
  type TirePosition,
  type TireStatus,
} from '@vfm/shared';
import type {
  CreateTireInput,
  CreateTireSetInput,
  TireSetDetail,
  TireSetListQuery,
  TireSetView,
  TireView,
  UpdateTireSetInput,
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
type TireSetDetailSelect = TireSetSelectWithMount & { formData: true };
type TireSetDetailRow = Prisma.TireSetGetPayload<{ select: TireSetDetailSelect }>;

const TIRE_SELECT = {
  id: true,
  setId: true,
  serialNumber: true,
  dot: true,
  productionWeek: true,
  productionYear: true,
  position: true,
  treadDepthMm: true,
  status: true,
  purchaseDate: true,
  purchasePrice: true,
  notes: true,
  createdAt: true,
} as const satisfies Prisma.TireSelect;

type TireRow = Prisma.TireGetPayload<{ select: typeof TIRE_SELECT }>;
type Tx = Prisma.TransactionClient;

interface LockedTireSetRow {
  id: string;
  status: TireStatus;
  version: number;
  deletedAt: Date | null;
}

const MANUAL_STATUSES = ['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'SCRAPPED'] as const;

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

function serializeTireSetDetail(row: TireSetDetailRow): TireSetDetail {
  return {
    ...serializeTireSet(row),
    formData:
      typeof row.formData === 'object' && row.formData !== null && !Array.isArray(row.formData)
        ? (row.formData as Record<string, unknown>)
        : {},
  };
}

const TIRE_POSITION_ORDER = new Map<TirePosition, number>(
  TIRE_POSITIONS.map((position, index) => [position, index]),
);

function serializeTire(row: TireRow): TireView {
  return {
    id: row.id,
    setId: row.setId,
    serialNumber: row.serialNumber,
    dot: row.dot,
    productionWeek: row.productionWeek,
    productionYear: row.productionYear,
    position: row.position,
    treadDepthTenthsMm: row.treadDepthMm === null ? null : Math.round(row.treadDepthMm.toNumber() * 10),
    status: row.status,
    purchaseDate: row.purchaseDate ? toLocalDateString(row.purchaseDate) : null,
    purchasePrice: row.purchasePrice,
    notes: row.notes,
  };
}

function compareTires(left: TireRow, right: TireRow): number {
  const leftOrder = left.position ? (TIRE_POSITION_ORDER.get(left.position) ?? 99) : 99;
  const rightOrder = right.position ? (TIRE_POSITION_ORDER.get(right.position) ?? 99) : 99;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
  return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
}

function duplicateTirePosition(): VfmException {
  return new VfmException('DUPLICATE_ENTRY', 'Pozicija je već evidentirana u ovom kompletu.', [
    detail('position', 'Pozicija je već evidentirana u ovom kompletu.'),
  ]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
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
  async getSet(id: string): Promise<TireSetDetail> {
    return serializeTireSetDetail(await this.loadSetDetail(this.prisma, id));
  }

  /**
   * Izmjena kompleta pod zaključanim redom kompleta.
   *
   * Montiran komplet se smije opisno ispravljati, ali mu se status ne mijenja
   * ručno i broj guma ne smije pasti ispod broja aktivnih pozicija. Forma se
   * validira zapisnom verzijom, pa PATCH nikad ne prevodi zapis na novu formu.
   */
  async updateSet(id: string, input: UpdateTireSetInput) {
    if (input.purchaseDate && input.purchaseDate > toLocalDateString(new Date())) {
      throw new VfmException('VALIDATION_ERROR', 'Datum nabavke ne može biti u budućnosti.', [
        detail('purchaseDate', 'Datum nabavke ne može biti u budućnosti.'),
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockSet(tx, id);
      const current = await this.loadSetDetail(tx, id);
      if (current.version !== input.version) {
        throw new VfmException(
          'VERSION_CONFLICT',
          'Komplet je izmijenjen. Ponovo učitajte evidenciju.',
          undefined,
          { currentVersion: current.version },
        );
      }

      const active = await tx.tireInstallation.findFirst({
        where: { setId: id, dismountedAt: null, deletedAt: null },
        select: {
          id: true,
          vehicleId: true,
          positions: true,
          vehicle: { select: { internalNo: true, plateNumber: true } },
        },
      });
      const earliest = await tx.tireInstallation.findFirst({
        where: { setId: id, deletedAt: null },
        orderBy: [{ mountedAt: 'asc' }, { id: 'asc' }],
        select: { mountedAt: true },
      });

      if (input.code !== undefined && input.code !== current.code) {
        const duplicate = await tx.tireSet.findFirst({
          where: { code: input.code, deletedAt: null, id: { not: id } },
          select: { id: true },
        });
        if (duplicate) throw duplicateSetCode();
      }
      if (input.purchaseDate && earliest && input.purchaseDate > toLocalDateString(earliest.mountedAt)) {
        throw new VfmException('VALIDATION_ERROR', 'Nabavka ne može biti nakon prve montaže kompleta.', [
          detail('purchaseDate', 'Nabavka ne može biti nakon prve montaže kompleta.'),
        ]);
      }
      if (active && input.tireCount !== undefined && input.tireCount < active.positions.length) {
        throw new VfmException(
          'VALIDATION_ERROR',
          'Broj guma ne može biti manji od broja trenutno montiranih pozicija.',
          [detail('tireCount', `Trenutno je montirano ${active.positions.length} pozicija.`)],
        );
      }
      if (input.tireCount !== undefined) {
        const recordedTireCount = await tx.tire.count({
          where: { setId: id, deletedAt: null },
        });
        if (input.tireCount < recordedTireCount) {
          throw new VfmException(
            'VALIDATION_ERROR',
            'Broj guma ne može biti manji od broja evidentiranih pojedinačnih guma.',
            [detail('tireCount', `Već je evidentirano ${recordedTireCount} pojedinačnih guma.`)],
          );
        }
      }
      if (input.status !== undefined && input.status !== current.status) {
        if (active) {
          throw new VfmException(
            'TIRE_ALREADY_MOUNTED',
            `Komplet ${current.code} je montiran na vozilo ${active.vehicle.internalNo}; prvo ga demontirajte.`,
            [detail('status', 'Status montiranog kompleta mijenja se demontažom.')],
            {
              installationId: active.id,
              mountedVehicleId: active.vehicleId,
              mountedVehicleInternalNo: active.vehicle.internalNo,
              mountedVehiclePlateNumber: active.vehicle.plateNumber,
            },
          );
        }
        const allowed: readonly TireStatus[] =
          current.status === 'MOUNTED' ? MANUAL_STATUSES : TIRE_SET_MANUAL_STATUS_TRANSITIONS[current.status];
        if (!allowed.includes(input.status)) {
          throw new VfmException(
            'VALIDATION_ERROR',
            `Prelaz statusa ${current.status} → ${input.status} nije dozvoljen.`,
            [detail('status', `Dozvoljeno: ${allowed.join(', ') || '—'}`)],
          );
        }
      }

      let validatedFormData: Prisma.InputJsonValue | undefined;
      if (!current.formSchemaVersionId) {
        if (input.formData !== undefined) {
          throw new VfmException(
            'VALIDATION_ERROR',
            'Komplet nema zapisnu verziju forme; dodatna polja se ne mogu mijenjati.',
            [detail('formData', 'Zapisna verzija forme ne postoji.')],
          );
        }
      } else {
        const version = await resolveFormVersion(tx as never, {
          subject: 'TIRE_SET',
          versionId: current.formSchemaVersionId,
          entityLabel: 'komplet guma',
        });
        const effective: Record<string, unknown> = {
          code: input.code ?? current.code,
          brand: input.brand !== undefined ? input.brand : current.brand,
          model: input.model !== undefined ? input.model : current.model,
          size: input.size !== undefined ? input.size : current.size,
          season: input.season ?? current.season,
          tireCount: input.tireCount ?? current.tireCount,
          purchaseDate:
            input.purchaseDate !== undefined
              ? input.purchaseDate
              : current.purchaseDate
                ? toLocalDateString(current.purchaseDate)
                : null,
          currentLocation:
            input.currentLocation !== undefined ? input.currentLocation : current.currentLocation,
          notes: input.notes !== undefined ? input.notes : current.notes,
          status: input.status ?? current.status,
        };
        const values = mergeCoreValues(
          version.definition,
          { ...asRecord(current.formData), ...(input.formData ?? {}) },
          effective,
        );
        const validated = validateRecordValues({
          subject: 'TIRE_SET',
          definition: version.definition,
          versionId: version.id,
          versionNumber: version.version,
          status: version.status,
          values,
          isNew: false,
        });
        validatedFormData = validated.values as Prisma.InputJsonObject;
      }

      const data: Prisma.TireSetUpdateManyMutationInput = {};
      if (input.code !== undefined) data.code = input.code;
      if (input.brand !== undefined) data.brand = input.brand;
      if (input.model !== undefined) data.model = input.model;
      if (input.size !== undefined) data.size = input.size;
      if (input.season !== undefined) data.season = input.season;
      if (input.tireCount !== undefined) data.tireCount = input.tireCount;
      if (input.purchaseDate !== undefined) data.purchaseDate = toDatabaseDate(input.purchaseDate);
      if (input.purchasePrice !== undefined) data.purchasePrice = input.purchasePrice;
      if (input.currentLocation !== undefined) data.currentLocation = input.currentLocation;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.status !== undefined) data.status = input.status;
      if (validatedFormData !== undefined) data.formData = validatedFormData;

      const before = serializeTireSetDetail(current);
      let updated: { count: number };
      try {
        updated = await tx.tireSet.updateMany({
          where: { id, version: input.version, deletedAt: null },
          data: { ...data, version: { increment: 1 } },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateSetCode();
        throw error;
      }
      if (updated.count !== 1) {
        const fresh = await tx.tireSet.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
        throw new VfmException(
          'VERSION_CONFLICT',
          'Komplet je izmijenjen. Ponovo učitajte evidenciju.',
          undefined,
          { currentVersion: fresh.version },
        );
      }

      if (input.status !== undefined && input.status !== current.status) {
        await tx.tire.updateMany({
          where: { setId: id, deletedAt: null },
          data: { status: input.status },
        });
      }

      const result = serializeTireSetDetail(await this.loadSetDetail(tx, id));
      return { data: result, before, after: result };
    });
  }

  /** Soft-delete kompleta: historija montaža ostaje, aktivna montaža blokira brisanje. */
  async removeSet(id: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockSet(tx, id);
      const current = await this.loadSetDetail(tx, id);
      const active = await tx.tireInstallation.findFirst({
        where: { setId: id, dismountedAt: null, deletedAt: null },
        select: {
          id: true,
          vehicleId: true,
          vehicle: { select: { internalNo: true, plateNumber: true } },
        },
      });
      if (active) {
        throw new VfmException(
          'TIRE_ALREADY_MOUNTED',
          `Komplet ${current.code} je montiran na vozilo ${active.vehicle.internalNo}; prvo ga demontirajte.`,
          [detail('status', 'Montiran komplet se ne može obrisati.')],
          {
            installationId: active.id,
            mountedVehicleId: active.vehicleId,
            mountedVehicleInternalNo: active.vehicle.internalNo,
            mountedVehiclePlateNumber: active.vehicle.plateNumber,
          },
        );
      }
      if (current.status === 'MOUNTED') {
        throw new VfmException('VALIDATION_ERROR', 'Komplet je označen kao montiran i ne može se obrisati.', [
          detail('status', 'Komplet je označen kao montiran.'),
        ]);
      }

      const before = serializeTireSetDetail(current);
      const deletedAt = new Date();
      const removed = await tx.tireSet.updateMany({
        where: { id, version: locked.version, deletedAt: null },
        data: { deletedAt, version: { increment: 1 } },
      });
      if (removed.count !== 1) {
        const fresh = await tx.tireSet.findFirst({
          where: { id, deletedAt: null },
          select: { version: true },
        });
        if (!fresh) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
        throw new VfmException(
          'VERSION_CONFLICT',
          'Komplet je izmijenjen. Ponovo učitajte evidenciju.',
          undefined,
          { currentVersion: fresh.version },
        );
      }
      await tx.tire.updateMany({
        where: { setId: id, deletedAt: null },
        data: { deletedAt },
      });

      return {
        data: { id },
        before,
        after: { id, deletedAt: deletedAt.toISOString(), deletedById: actorId ?? null },
      };
    });
  }

  /** Pojedinačne gume jednog kompleta, u kanonskom redoslijedu pozicija. */
  async listTires(setId: string) {
    const set = await this.prisma.tireSet.findFirst({
      where: { id: setId, deletedAt: null },
      select: { id: true },
    });
    if (!set) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');

    const rows = await this.prisma.tire.findMany({
      where: { setId, deletedAt: null },
      select: TIRE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: [...rows].sort(compareTires).map(serializeTire) };
  }

  /**
   * Unos pojedinačne gume pod zaključanim redom kompleta.
   *
   * Zaključavanje serijalizuje provjere deklarisanog broja i zauzete pozicije.
   * Status se ne prima iz zahtjeva: aktivna pozicija je montirana, ostale
   * gume montiranog kompleta ostaju na skladištu, a bez aktivne montaže
   * status prati komplet (uz ispravku nekonzistentnog `MOUNTED` u skladište).
   */
  async createTire(setId: string, input: CreateTireInput) {
    if (input.purchaseDate && input.purchaseDate > toLocalDateString(new Date())) {
      throw new VfmException('VALIDATION_ERROR', 'Datum nabavke ne može biti u budućnosti.', [
        detail('purchaseDate', 'Datum nabavke ne može biti u budućnosti.'),
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockSet(tx, setId);
      const set = await tx.tireSet.findFirst({
        where: { id: setId, deletedAt: null },
        select: { code: true, tireCount: true, status: true },
      });
      if (!set) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');

      const [recordedTireCount, active] = await Promise.all([
        tx.tire.count({ where: { setId, deletedAt: null } }),
        tx.tireInstallation.findFirst({
          where: { setId, dismountedAt: null, deletedAt: null },
          select: { positions: true },
        }),
      ]);
      if (recordedTireCount >= set.tireCount) {
        throw new VfmException(
          'VALIDATION_ERROR',
          `Komplet ${set.code} već ima evidentiran deklarisani broj guma.`,
          [
            detail(
              'tireCount',
              `Evidentirano je ${recordedTireCount} od najviše ${set.tireCount} guma u kompletu.`,
            ),
          ],
        );
      }

      if (input.position) {
        const duplicate = await tx.tire.findFirst({
          where: { setId, position: input.position, deletedAt: null },
          select: { id: true },
        });
        if (duplicate) throw duplicateTirePosition();
      }

      const status: TireStatus = active
        ? input.position && active.positions.includes(input.position)
          ? 'MOUNTED'
          : 'IN_STOCK'
        : set.status === 'MOUNTED'
          ? 'IN_STOCK'
          : set.status;

      try {
        const row = await tx.tire.create({
          data: {
            id: randomUUID(),
            setId,
            serialNumber: input.serialNumber ?? null,
            dot: input.dot ?? null,
            productionWeek: input.productionWeek ?? null,
            productionYear: input.productionYear ?? null,
            position: input.position ?? null,
            treadDepthMm:
              input.treadDepthTenthsMm === undefined || input.treadDepthTenthsMm === null
                ? null
                : (input.treadDepthTenthsMm / 10).toFixed(1),
            status,
            purchaseDate: toDatabaseDate(input.purchaseDate),
            purchasePrice: input.purchasePrice ?? null,
            notes: input.notes ?? null,
          },
          select: TIRE_SELECT,
        });
        const data = serializeTire(row);
        return { data, after: data, setCode: set.code };
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateTirePosition();
        throw error;
      }
    });
  }

  private async lockSet(tx: Tx, id: string): Promise<LockedTireSetRow> {
    const rows = await tx.$queryRaw<LockedTireSetRow[]>`
      SELECT "id", "status", "version", "deletedAt"
      FROM "TireSet"
      WHERE "id" = ${id}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row || row.deletedAt) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
    return row;
  }

  private async loadSetDetail(client: PrismaService | Tx, id: string): Promise<TireSetDetailRow> {
    const row = (await (client as PrismaService).tireSet.findFirst({
      where: { id, deletedAt: null },
      select: { ...TIRE_SET_SELECT, formData: true, installations: ACTIVE_INSTALLATION_ARGS },
    })) as TireSetDetailRow | null;
    if (!row) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
    return row;
  }
}
