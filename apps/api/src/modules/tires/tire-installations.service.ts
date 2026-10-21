/**
 * Montaže guma — transakcijski ciklus kompleta na vozilu.
 *
 * Zaključavanje je uvijek vozilo → komplet(i): time se provjere aktivne
 * montaže, zauzetih pozicija i kilometraže ne mogu mimoići s paralelnim
 * zahtjevom. Partial unique indeks na aktivnoj montaži je drugi pojas.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { toLocalDateString, type TireDismountReason, type TirePosition, type TireStatus } from '@vfm/shared';
import {
  mountTireSetSchema,
  swapTireSetSchema,
  type DismountTireSetInput,
  type MountTireSetInput,
  type SwapTireSetInput,
  type TireInstallationListQuery,
  type TireInstallationView,
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

const INSTALLATION_INCLUDE = {
  set: { select: { code: true, brand: true, model: true, size: true, season: true } },
} as const satisfies Prisma.TireInstallationInclude;

type InstallationRow = Prisma.TireInstallationGetPayload<{ include: typeof INSTALLATION_INCLUDE }>;
type Tx = Prisma.TransactionClient;

interface LockedVehicleRow {
  id: string;
  internalNo: string;
  plateNumber: string | null;
  odometerKm: number;
  status: string;
  version: number;
  deletedAt: Date | null;
}

interface LockedTireSetRow {
  id: string;
  code: string;
  status: TireStatus;
  tireCount: number;
  purchaseDate: Date | null;
  currentLocation: string | null;
  version: number;
  deletedAt: Date | null;
}

interface MountData {
  setId: string;
  vehicleId: string;
  mountedAt: string;
  mountedOdometerKm: number;
  positions: readonly TirePosition[];
}

interface PreparedForm {
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: Record<string, unknown>;
}

interface DismountComputation {
  kmDriven: number;
  daysInUse: number;
}

const DAY_MS = 86_400_000;

function serializeInstallation(row: InstallationRow): TireInstallationView {
  return {
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
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS);
}

function normalizedDate(value: unknown): string | undefined {
  if (value instanceof Date) return toLocalDateString(value);
  return typeof value === 'string' ? value.slice(0, 10) : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function derivedStatusAfterDismount(reason: TireDismountReason | null | undefined): TireStatus {
  if (reason === 'REPAIR') return 'IN_REPAIR';
  if (reason === 'SALE') return 'RETIRED';
  return 'IN_STOCK';
}

@Injectable()
export class TireInstallationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: TireInstallationListQuery) {
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
        include: INSTALLATION_INCLUDE,
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
      items: rows.map(serializeInstallation),
    };
  }

  async mount(input: MountTireSetInput, actorId?: string) {
    const prepared = await this.prepareMountForm(input);
    const data = prepared.data;
    this.assertDateNotFuture(data.mountedAt, 'mountedAt', 'Datum montaže');

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const vehicle = await this.lockVehicle(tx, data.vehicleId);
      const set = await this.lockSet(tx, data.setId);
      await this.assertMountable(tx, { vehicle, set, data });
      this.assertOdometer(data.mountedOdometerKm, vehicle.odometerKm, 'mountedOdometerKm');

      const row = await this.applyMount(tx, {
        set,
        data,
        form: prepared.form,
        actorId,
      });
      await this.recordOdometer(tx, vehicle, row.id, data.mountedOdometerKm, actorId, now);
      await this.createOutbox(tx, {
        aggregateType: 'TireInstallation',
        aggregateId: row.id,
        eventType: 'TIRE_SET_MOUNTED',
        idempotencyKey: `tire-installation:${row.id}:mounted:v1`,
        payload: {
          installationId: row.id,
          setId: data.setId,
          vehicleId: data.vehicleId,
          mountedAt: data.mountedAt,
          mountedOdometerKm: data.mountedOdometerKm,
          positions: [...data.positions],
          actorId: actorId ?? null,
        },
      });

      const result = serializeInstallation(row);
      return { data: result, after: result };
    });
  }

  async dismount(id: string, input: DismountTireSetInput, actorId?: string) {
    this.assertDateNotFuture(input.dismountedAt, 'dismountedAt', 'Datum demontaže');
    const initial = await this.prisma.tireInstallation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, vehicleId: true, setId: true },
    });
    if (!initial) throw new VfmException('NOT_FOUND', 'Montaža guma nije pronađena.');

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const vehicle = await this.lockVehicle(tx, initial.vehicleId);
      const set = await this.lockSet(tx, initial.setId);
      const current = await this.load(tx, id);
      const computation = this.assertDismountable(current, vehicle, input);
      const formData = await this.formDataForDismount(tx, current, input, computation);
      const before = serializeInstallation(current);
      const row = await this.applyDismount(tx, { current, set, input, computation, formData });
      await this.recordOdometer(tx, vehicle, row.id, input.dismountedOdometerKm, actorId, now);
      await this.createOutbox(tx, {
        aggregateType: 'TireInstallation',
        aggregateId: row.id,
        eventType: 'TIRE_SET_DISMOUNTED',
        idempotencyKey: `tire-installation:${row.id}:dismounted:${input.dismountedAt}:${input.dismountedOdometerKm}`,
        payload: {
          installationId: row.id,
          setId: row.setId,
          vehicleId: row.vehicleId,
          dismountedAt: input.dismountedAt,
          dismountedOdometerKm: input.dismountedOdometerKm,
          kmDriven: computation.kmDriven,
          daysInUse: computation.daysInUse,
          reason: input.reason ?? null,
          actorId: actorId ?? null,
        },
      });

      const result = serializeInstallation(row);
      return { data: result, before, after: result };
    });
  }

  /** Zamjena prvo validira oba kompleta; tek zatim u istoj transakciji radi upise. */
  async swap(input: SwapTireSetInput, actorId?: string) {
    const prepared = await this.prepareSwapForm(input);
    const data = prepared.data;
    this.assertDateNotFuture(data.swappedAt, 'swappedAt', 'Datum zamjene');

    const initial = await this.prisma.tireInstallation.findFirst({
      where: { id: data.currentInstallationId, deletedAt: null },
      select: { id: true, vehicleId: true, setId: true },
    });
    if (!initial) throw new VfmException('NOT_FOUND', 'Trenutna montaža guma nije pronađena.');

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const vehicle = await this.lockVehicle(tx, data.vehicleId);
      const lockedSets = new Map<string, LockedTireSetRow>();
      for (const setId of [...new Set([initial.setId, data.newSetId])].sort()) {
        lockedSets.set(setId, await this.lockSet(tx, setId));
      }
      const oldSet = lockedSets.get(initial.setId)!;
      const newSet = lockedSets.get(data.newSetId)!;
      const current = await this.load(tx, data.currentInstallationId);

      if (current.vehicleId !== data.vehicleId) {
        throw new VfmException('VALIDATION_ERROR', 'Trenutna montaža ne pripada odabranom vozilu.', [
          detail('currentInstallationId', 'Trenutna montaža ne pripada odabranom vozilu.'),
        ]);
      }
      if (current.setId === data.newSetId) {
        throw new VfmException('VALIDATION_ERROR', 'Novi komplet mora biti različit od trenutnog.', [
          detail('newSetId', 'Novi komplet mora biti različit od trenutnog.'),
        ]);
      }

      const dismountInput: DismountTireSetInput = {
        version: data.currentVersion,
        dismountedAt: data.swappedAt,
        dismountedOdometerKm: data.odometerKm,
        reason: data.reason,
        storageLocationOnDismount: data.storageLocationOnDismount,
      };
      const computation = this.assertDismountable(current, vehicle, dismountInput);
      const oldFormData = await this.formDataForDismount(tx, current, dismountInput, computation);
      const mountData: MountData = {
        setId: data.newSetId,
        vehicleId: data.vehicleId,
        mountedAt: data.swappedAt,
        mountedOdometerKm: data.odometerKm,
        positions: data.positions,
      };
      await this.assertMountable(tx, {
        vehicle,
        set: newSet,
        data: mountData,
        excludeInstallationId: current.id,
      });

      const before = serializeInstallation(current);
      const dismounted = await this.applyDismount(tx, {
        current,
        set: oldSet,
        input: dismountInput,
        computation,
        formData: oldFormData,
      });
      const mounted = await this.applyMount(tx, {
        set: newSet,
        data: mountData,
        form: prepared.form,
        actorId,
      });
      await this.recordOdometer(tx, vehicle, mounted.id, data.odometerKm, actorId, now);
      await this.createOutbox(tx, {
        aggregateType: 'Vehicle',
        aggregateId: data.vehicleId,
        eventType: 'TIRE_SET_SWAPPED',
        idempotencyKey: `tire-swap:${dismounted.id}:${mounted.id}:v1`,
        payload: {
          vehicleId: data.vehicleId,
          dismountedInstallationId: dismounted.id,
          dismountedSetId: dismounted.setId,
          mountedInstallationId: mounted.id,
          mountedSetId: mounted.setId,
          swappedAt: data.swappedAt,
          odometerKm: data.odometerKm,
          kmDriven: computation.kmDriven,
          daysInUse: computation.daysInUse,
          positions: [...data.positions],
          actorId: actorId ?? null,
        },
      });

      const result = {
        dismounted: serializeInstallation(dismounted),
        mounted: serializeInstallation(mounted),
      };
      return { data: result, before, after: result };
    });
  }

  // ---------------------------------------------------------------------------
  //  Priprema formi
  // ---------------------------------------------------------------------------

  private async prepareMountForm(input: MountTireSetInput) {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'TIRE_INSTALLATION',
      versionId: input.formSchemaVersionId,
      entityLabel: 'montažu guma',
    });
    const values = mergeCoreValues(version.definition, input.formData, {
      mountedAt: input.mountedAt,
      mountedOdometerKm: input.mountedOdometerKm,
      positions: input.positions,
    });
    const validated = validateRecordValues({
      subject: 'TIRE_INSTALLATION',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values,
      isNew: true,
    });
    const parsed = mountTireSetSchema.safeParse({ ...input, ...validated.normalized });
    if (!parsed.success) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Mapirane vrijednosti montaže nisu ispravne.',
        parsed.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
      );
    }
    return {
      data: parsed.data,
      form: {
        formSchemaId: version.formSchemaId,
        formSchemaVersionId: version.id,
        formData: validated.values,
      } satisfies PreparedForm,
    };
  }

  private async prepareSwapForm(input: SwapTireSetInput) {
    const version = await resolveFormVersion(this.prisma as never, {
      subject: 'TIRE_INSTALLATION',
      versionId: input.formSchemaVersionId,
      entityLabel: 'zamjenu guma',
    });
    const values = mergeCoreValues(version.definition, input.formData, {
      mountedAt: input.swappedAt,
      mountedOdometerKm: input.odometerKm,
      positions: input.positions,
    });
    const validated = validateRecordValues({
      subject: 'TIRE_INSTALLATION',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values,
      isNew: true,
    });

    const normalized = validated.normalized;
    const dismountedAt = normalizedDate(normalized.dismountedAt);
    if (dismountedAt && dismountedAt !== input.swappedAt) {
      throw new VfmException(
        'NORMALIZATION_MISMATCH',
        'Mapirani datum demontaže ne odgovara datumu zamjene.',
      );
    }
    if (
      normalized.dismountedOdometerKm !== undefined &&
      normalized.dismountedOdometerKm !== input.odometerKm
    ) {
      throw new VfmException('NORMALIZATION_MISMATCH', 'Mapirana kilometraža demontaže ne odgovara zamjeni.');
    }

    const candidate: Record<string, unknown> = { ...input };
    const mountedAt = normalizedDate(normalized.mountedAt);
    if (mountedAt) candidate.swappedAt = mountedAt;
    if (normalized.mountedOdometerKm !== undefined) candidate.odometerKm = normalized.mountedOdometerKm;
    const parsed = swapTireSetSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        'Mapirane vrijednosti zamjene nisu ispravne.',
        parsed.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
      );
    }

    return {
      data: parsed.data,
      form: {
        formSchemaId: version.formSchemaId,
        formSchemaVersionId: version.id,
        formData: validated.values,
      } satisfies PreparedForm,
    };
  }

  private async formDataForDismount(
    tx: Tx,
    current: InstallationRow,
    input: DismountTireSetInput,
    computation: DismountComputation,
  ): Promise<Prisma.InputJsonValue> {
    if (!current.formSchemaVersionId) return current.formData as Prisma.InputJsonValue;

    const version = await resolveFormVersion(tx as never, {
      subject: 'TIRE_INSTALLATION',
      versionId: current.formSchemaVersionId,
      entityLabel: 'montažu guma',
    });
    const values = mergeCoreValues(version.definition, asRecord(current.formData), {
      dismountedAt: input.dismountedAt,
      dismountedOdometerKm: input.dismountedOdometerKm,
      kmDriven: computation.kmDriven,
      daysInUse: computation.daysInUse,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.storageLocationOnDismount !== undefined
        ? { storageLocationOnDismount: input.storageLocationOnDismount }
        : {}),
    });
    const validated = validateRecordValues({
      subject: 'TIRE_INSTALLATION',
      definition: version.definition,
      versionId: version.id,
      versionNumber: version.version,
      status: version.status,
      values,
      isNew: false,
    });

    const normalized = validated.normalized;
    const date = normalizedDate(normalized.dismountedAt);
    if (
      (date && date !== input.dismountedAt) ||
      (normalized.dismountedOdometerKm !== undefined &&
        normalized.dismountedOdometerKm !== input.dismountedOdometerKm) ||
      (normalized.kmDriven !== undefined && normalized.kmDriven !== computation.kmDriven) ||
      (normalized.daysInUse !== undefined && normalized.daysInUse !== computation.daysInUse)
    ) {
      throw new VfmException(
        'NORMALIZATION_MISMATCH',
        'Mapirane vrijednosti demontaže ne odgovaraju obračunu.',
      );
    }
    return validated.values as Prisma.InputJsonObject;
  }

  // ---------------------------------------------------------------------------
  //  Zaključavanje i provjere
  // ---------------------------------------------------------------------------

  private async lockVehicle(tx: Tx, id: string): Promise<LockedVehicleRow> {
    const rows = await tx.$queryRaw<LockedVehicleRow[]>`
      SELECT "id", "internalNo", "plateNumber", "odometerKm", "status", "version", "deletedAt"
      FROM "Vehicle"
      WHERE "id" = ${id}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
    return row;
  }

  private async lockSet(tx: Tx, id: string): Promise<LockedTireSetRow> {
    const rows = await tx.$queryRaw<LockedTireSetRow[]>`
      SELECT "id", "code", "status", "tireCount", "purchaseDate", "currentLocation", "version", "deletedAt"
      FROM "TireSet"
      WHERE "id" = ${id}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
    return row;
  }

  private async load(tx: Tx, id: string): Promise<InstallationRow> {
    const row = await tx.tireInstallation.findFirst({
      where: { id, deletedAt: null },
      include: INSTALLATION_INCLUDE,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Montaža guma nije pronađena.');
    return row;
  }

  private assertDateNotFuture(value: string, field: string, label: string): void {
    if (value > toLocalDateString(new Date())) {
      throw new VfmException('VALIDATION_ERROR', `${label} ne može biti u budućnosti.`, [
        detail(field, `${label} ne može biti u budućnosti.`),
      ]);
    }
  }

  private assertOdometer(value: number, current: number, field: string): void {
    if (value < current) {
      throw new VfmException(
        'ODOMETER_REGRESSION',
        'Kilometraža je manja od trenutne kilometraže vozila. Koristite zasebnu auditovanu korekciju.',
        [detail(field, `Trenutna kilometraža vozila je ${current} km.`)],
        { currentOdometerKm: current },
      );
    }
  }

  private async assertMountable(
    tx: Tx,
    args: {
      vehicle: LockedVehicleRow;
      set: LockedTireSetRow;
      data: MountData;
      excludeInstallationId?: string;
    },
  ): Promise<void> {
    const { vehicle, set, data } = args;
    if (vehicle.deletedAt) throw new VfmException('NOT_FOUND', 'Vozilo nije pronađeno.');
    if (vehicle.status === 'ARCHIVED') {
      throw new VfmException('VALIDATION_ERROR', 'Arhiviranom vozilu se komplet ne montira.', [
        detail('vehicleId', 'Vozilo je arhivirano.'),
      ]);
    }
    if (set.deletedAt) throw new VfmException('NOT_FOUND', 'Komplet guma nije pronađen.');
    if (data.positions.length > set.tireCount) {
      throw new VfmException('VALIDATION_ERROR', 'Odabrano je više pozicija nego što komplet ima guma.', [
        detail('positions', `Komplet ima ${set.tireCount} guma.`),
      ]);
    }
    if (set.purchaseDate && data.mountedAt < toLocalDateString(set.purchaseDate)) {
      throw new VfmException('VALIDATION_ERROR', 'Montaža ne može prethoditi nabavci kompleta.', [
        detail('mountedAt', 'Montaža ne može prethoditi nabavci kompleta.'),
      ]);
    }

    const active = await tx.tireInstallation.findFirst({
      where: { setId: set.id, dismountedAt: null, deletedAt: null },
      select: {
        id: true,
        vehicleId: true,
        vehicle: { select: { internalNo: true, plateNumber: true } },
      },
    });
    if (active) {
      throw new VfmException(
        'TIRE_ALREADY_MOUNTED',
        `Komplet ${set.code} je već montiran na vozilo ${active.vehicle.internalNo}.`,
        [detail('setId', `Već je montiran na vozilo ${active.vehicle.internalNo}.`)],
        {
          installationId: active.id,
          mountedVehicleId: active.vehicleId,
          mountedVehicleInternalNo: active.vehicle.internalNo,
          mountedVehiclePlateNumber: active.vehicle.plateNumber,
        },
      );
    }
    if (set.status !== 'IN_STOCK') {
      throw new VfmException('VALIDATION_ERROR', 'Montirati se može samo komplet koji je na skladištu.', [
        detail('setId', `Trenutni status kompleta je ${set.status}.`),
      ]);
    }

    const latestDismounted = await tx.tireInstallation.findFirst({
      where: { setId: set.id, deletedAt: null, dismountedAt: { not: null } },
      orderBy: [{ dismountedAt: 'desc' }, { id: 'desc' }],
      select: { dismountedAt: true },
    });
    if (latestDismounted?.dismountedAt && toLocalDateString(latestDismounted.dismountedAt) > data.mountedAt) {
      throw new VfmException('PERIOD_OVERLAP', 'Montaža se preklapa s ranijim ciklusom ovog kompleta.', [
        detail('mountedAt', 'Datum je prije posljednje demontaže kompleta.'),
      ]);
    }

    const conflicts = await tx.tireInstallation.findMany({
      where: {
        vehicleId: vehicle.id,
        deletedAt: null,
        positions: { hasSome: [...data.positions] },
        OR: [{ dismountedAt: null }, { dismountedAt: { gt: toDatabaseDate(data.mountedAt)! } }],
        ...(args.excludeInstallationId ? { id: { not: args.excludeInstallationId } } : {}),
      },
      select: {
        id: true,
        setId: true,
        positions: true,
        dismountedAt: true,
        set: { select: { code: true } },
      },
    });
    for (const conflict of conflicts) {
      const position = data.positions.find((item) => conflict.positions.includes(item));
      if (!position) continue;
      if (!conflict.dismountedAt) {
        throw new VfmException(
          'TIRE_ALREADY_MOUNTED',
          `Pozicija ${position} na vozilu ${vehicle.internalNo} već je zauzeta kompletom ${conflict.set.code}.`,
          [detail('positions', `Poziciju ${position} zauzima komplet ${conflict.set.code}.`)],
          {
            installationId: conflict.id,
            conflictingSetId: conflict.setId,
            conflictingSetCode: conflict.set.code,
            position,
          },
        );
      }
      throw new VfmException('PERIOD_OVERLAP', 'Montaža se preklapa s ranijim ciklusom na istoj poziciji.', [
        detail('positions', `Pozicija ${position} je zauzeta u odabranom periodu.`),
      ]);
    }
  }

  private assertDismountable(
    current: InstallationRow,
    vehicle: LockedVehicleRow,
    input: DismountTireSetInput,
  ): DismountComputation {
    if (current.version !== input.version) {
      throw new VfmException(
        'VERSION_CONFLICT',
        'Montaža je izmijenjena. Ponovo učitajte evidenciju.',
        undefined,
        {
          currentVersion: current.version,
        },
      );
    }
    if (current.dismountedAt) {
      throw new VfmException('VALIDATION_ERROR', 'Komplet je već demontiran.', [
        detail('version', 'Komplet je već demontiran.'),
      ]);
    }
    const mountedAt = toLocalDateString(current.mountedAt);
    if (input.dismountedAt < mountedAt) {
      throw new VfmException('VALIDATION_ERROR', 'Demontaža ne može prethoditi montaži.', [
        detail('dismountedAt', 'Demontaža ne može prethoditi montaži.'),
      ]);
    }
    if (input.dismountedOdometerKm < current.mountedOdometerKm) {
      throw new VfmException(
        'ODOMETER_REGRESSION',
        'Kilometraža demontaže ne može biti manja od kilometraže montaže.',
        [detail('dismountedOdometerKm', `Kilometraža montaže je ${current.mountedOdometerKm} km.`)],
        { mountedOdometerKm: current.mountedOdometerKm },
      );
    }
    this.assertOdometer(input.dismountedOdometerKm, vehicle.odometerKm, 'dismountedOdometerKm');
    return {
      kmDriven: input.dismountedOdometerKm - current.mountedOdometerKm,
      daysInUse: daysBetween(mountedAt, input.dismountedAt),
    };
  }

  // ---------------------------------------------------------------------------
  //  Upisi unutar transakcije
  // ---------------------------------------------------------------------------

  private async applyMount(
    tx: Tx,
    args: {
      set: LockedTireSetRow;
      data: MountData;
      form: PreparedForm;
      actorId?: string;
    },
  ): Promise<InstallationRow> {
    const claimed = await tx.tireSet.updateMany({
      where: { id: args.set.id, version: args.set.version, status: 'IN_STOCK', deletedAt: null },
      data: { status: 'MOUNTED', version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new VfmException('VERSION_CONFLICT', 'Komplet je u međuvremenu izmijenjen.', undefined, {
        currentVersion: args.set.version,
      });
    }

    let row: InstallationRow;
    try {
      row = await tx.tireInstallation.create({
        data: {
          id: randomUUID(),
          setId: args.data.setId,
          vehicleId: args.data.vehicleId,
          mountedAt: toDatabaseDate(args.data.mountedAt)!,
          mountedOdometerKm: args.data.mountedOdometerKm,
          positions: [...args.data.positions],
          formSchemaId: args.form.formSchemaId,
          formSchemaVersionId: args.form.formSchemaVersionId,
          formData: args.form.formData as Prisma.InputJsonObject,
          createdById: args.actorId ?? null,
        },
        include: INSTALLATION_INCLUDE,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new VfmException('TIRE_ALREADY_MOUNTED', `Komplet ${args.set.code} je već montiran.`, [
          detail('setId', 'Komplet je već montiran.'),
        ]);
      }
      throw error;
    }
    await this.updateIndividualTires(tx, args.set.id, args.data.positions, 'MOUNTED');
    return row;
  }

  private async applyDismount(
    tx: Tx,
    args: {
      current: InstallationRow;
      set: LockedTireSetRow;
      input: DismountTireSetInput;
      computation: DismountComputation;
      formData: Prisma.InputJsonValue;
    },
  ): Promise<InstallationRow> {
    const updated = await tx.tireInstallation.updateMany({
      where: {
        id: args.current.id,
        version: args.input.version,
        dismountedAt: null,
        deletedAt: null,
      },
      data: {
        dismountedAt: toDatabaseDate(args.input.dismountedAt)!,
        dismountedOdometerKm: args.input.dismountedOdometerKm,
        reason: args.input.reason ?? null,
        storageLocationOnDismount: args.input.storageLocationOnDismount ?? null,
        kmDriven: args.computation.kmDriven,
        daysInUse: args.computation.daysInUse,
        formData: args.formData,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const fresh = await tx.tireInstallation.findFirst({
        where: { id: args.current.id, deletedAt: null },
        select: { version: true, dismountedAt: true },
      });
      if (!fresh) throw new VfmException('NOT_FOUND', 'Montaža guma nije pronađena.');
      if (fresh.version !== args.input.version) {
        throw new VfmException(
          'VERSION_CONFLICT',
          'Montaža je izmijenjena. Ponovo učitajte evidenciju.',
          undefined,
          {
            currentVersion: fresh.version,
          },
        );
      }
      throw new VfmException('VALIDATION_ERROR', 'Komplet je već demontiran.');
    }

    const status = derivedStatusAfterDismount(args.input.reason);
    const setUpdated = await tx.tireSet.updateMany({
      where: { id: args.set.id, version: args.set.version },
      data: {
        status,
        currentLocation: args.input.storageLocationOnDismount ?? args.set.currentLocation,
        version: { increment: 1 },
      },
    });
    if (setUpdated.count !== 1) {
      throw new VfmException('VERSION_CONFLICT', 'Komplet je u međuvremenu izmijenjen.', undefined, {
        currentVersion: args.set.version,
      });
    }
    await this.updateIndividualTires(tx, args.set.id, args.current.positions, status);
    return this.load(tx, args.current.id);
  }

  private async updateIndividualTires(
    tx: Tx,
    setId: string,
    positions: readonly TirePosition[],
    status: TireStatus,
  ): Promise<void> {
    if (positions.length === 0) return;
    await tx.tire.updateMany({
      where: { setId, deletedAt: null, position: { in: [...positions] } },
      data: { status },
    });
  }

  private async recordOdometer(
    tx: Tx,
    vehicle: LockedVehicleRow,
    installationId: string,
    valueKm: number,
    actorId: string | undefined,
    now: Date,
  ): Promise<void> {
    await tx.odometerReading.create({
      data: {
        id: randomUUID(),
        vehicleId: vehicle.id,
        valueKm,
        source: 'TIRE',
        referenceType: 'TireInstallation',
        referenceId: installationId,
        readingAt: now,
        recordedById: actorId ?? null,
      },
    });
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: {
        odometerKm: valueKm,
        odometerUpdatedAt: now,
        version: { increment: 1 },
      },
    });
  }

  private async createOutbox(
    tx: Tx,
    args: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      idempotencyKey: string;
      payload: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        aggregateType: args.aggregateType,
        aggregateId: args.aggregateId,
        eventType: args.eventType,
        idempotencyKey: args.idempotencyKey,
        payload: args.payload,
      },
    });
  }
}
