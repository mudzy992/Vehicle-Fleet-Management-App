import { randomUUID } from 'node:crypto';
import { toLocalDateString } from '@vfm/shared';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import { toDatabaseDate } from '../../common/dates.js';
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
type LinkedRecordType = 'SERVICE' | 'REGISTRATION' | 'TIRE_INSTALLATION';

export interface LinkedRecordResult {
  readonly type: LinkedRecordType;
  readonly id: string;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'object' && value !== null && 'amount' in value) {
    const amount = (value as { amount: unknown }).amount;
    if (typeof amount === 'number' && Number.isFinite(amount)) return Math.trunc(amount);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function pick(values: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (values[key] !== undefined && values[key] !== null && values[key] !== '') return values[key];
  }
  return undefined;
}

async function publishedForm(
  tx: Tx,
  subject: 'SERVICE' | 'REGISTRATION' | 'TIRE_INSTALLATION',
): Promise<{ id: string; versionId: string }> {
  const row = await tx.formSchema.findFirst({
    where: { subject, deletedAt: null, currentPublishedVersionId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, currentPublishedVersionId: true },
  });
  if (!row?.currentPublishedVersionId) {
    throw new VfmException('FORM_VERSION_NOT_PUBLISHED', `Nema objavljene ${subject} forme za evidenciju.`);
  }
  return { id: row.id, versionId: row.currentPublishedVersionId };
}

async function createServiceRecord(args: {
  tx: Tx;
  vehicleId: string;
  actorId: string;
  values: Record<string, unknown>;
  serviceType: string;
  odometerKm: number | null;
  totalCost: number | null;
}): Promise<string> {
  const form = await publishedForm(args.tx, 'SERVICE');
  const serviceDate =
    asString(pick(args.values, ['serviceDate', 'date', 'completedAt'])) ?? toLocalDateString(new Date());
  const id = randomUUID();
  await args.tx.serviceRecord.create({
    data: {
      id,
      vehicleId: args.vehicleId,
      serviceDate: toDatabaseDate(serviceDate)!,
      serviceType: args.serviceType,
      workshopName: asString(pick(args.values, ['workshopName', 'workshop'])),
      description: asString(pick(args.values, ['note', 'napomena', 'description'])),
      totalCost: args.totalCost ?? asInt(pick(args.values, ['totalCost', 'costAmount'])) ?? 0,
      odometerKm: args.odometerKm,
      formSchemaId: form.id,
      formSchemaVersionId: form.versionId,
      formData: args.values as Prisma.InputJsonObject,
      createdById: args.actorId,
    },
  });
  return id;
}

async function createRegistrationRecord(args: {
  tx: Tx;
  vehicleId: string;
  actorId: string;
  values: Record<string, unknown>;
}): Promise<string> {
  const form = await publishedForm(args.tx, 'REGISTRATION');
  const validFrom = asString(pick(args.values, ['validFrom']));
  const validUntil = asString(pick(args.values, ['validUntil']));
  const registrationNumber = asString(pick(args.values, ['registrationNumber']));
  if (!validFrom || !validUntil || !registrationNumber) {
    throw VfmErrors.validationError([
      { path: ['realizationFormData'], message: 'Realizacija registracije zahtijeva broj, važi od i važi do.' },
    ]);
  }
  const id = randomUUID();
  await args.tx.registrationRecord.create({
    data: {
      id,
      vehicleId: args.vehicleId,
      registrationNumber,
      validFrom: toDatabaseDate(validFrom)!,
      validUntil: toDatabaseDate(validUntil)!,
      costAmount: asInt(pick(args.values, ['costAmount', 'totalCost'])),
      formSchemaId: form.id,
      formSchemaVersionId: form.versionId,
      formData: args.values as Prisma.InputJsonObject,
      createdById: args.actorId,
    },
  });
  const latest = await args.tx.registrationRecord.aggregate({
    where: { vehicleId: args.vehicleId, deletedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    _max: { validUntil: true },
  });
  await args.tx.vehicle.updateMany({
    where: { id: args.vehicleId },
    data: { registrationExpiresAt: latest._max.validUntil ?? null },
  });
  return id;
}

async function applyTireChange(args: {
  tx: Tx;
  vehicleId: string;
  actorId: string;
  values: Record<string, unknown>;
  odometerKm: number | null;
}): Promise<string> {
  const setId = asString(pick(args.values, ['tireSetId', 'setId', 'kompletId']));
  const odometer = args.odometerKm ?? asInt(pick(args.values, ['odometerKm', 'mountedOdometerKm']));
  if (!setId || odometer === null) {
    throw VfmErrors.validationError([
      { path: ['realizationFormData'], message: 'Zamjena guma zahtijeva slobodan komplet i kilometražu.' },
    ]);
  }
  const form = await publishedForm(args.tx, 'TIRE_INSTALLATION');
  const mounted = await args.tx.tireInstallation.findFirst({
    where: { vehicleId: args.vehicleId, dismountedAt: null, deletedAt: null },
    orderBy: { mountedAt: 'desc' },
  });
  const today = toLocalDateString(new Date());
  if (mounted) {
    const kmDriven = Math.max(0, odometer - mounted.mountedOdometerKm);
    await args.tx.tireInstallation.update({
      where: { id: mounted.id },
      data: {
        dismountedAt: toDatabaseDate(today),
        dismountedOdometerKm: odometer,
        reason: 'SEASON_CHANGE',
        kmDriven,
        version: { increment: 1 },
      },
    });
    await args.tx.tireSet.update({
      where: { id: mounted.setId },
      data: { status: 'IN_STOCK', version: { increment: 1 } },
    });
  }
  const claimed = await args.tx.tireSet.updateMany({
    where: { id: setId, status: 'IN_STOCK', deletedAt: null },
    data: { status: 'MOUNTED', version: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw new VfmException('TIRE_ALREADY_MOUNTED', 'Odabrani komplet nije slobodan za montažu.');
  }
  const id = randomUUID();
  await args.tx.tireInstallation.create({
    data: {
      id,
      setId,
      vehicleId: args.vehicleId,
      mountedAt: toDatabaseDate(today)!,
      mountedOdometerKm: odometer,
      positions: ['FL', 'FR', 'RL', 'RR'],
      formSchemaId: form.id,
      formSchemaVersionId: form.versionId,
      formData: args.values as Prisma.InputJsonObject,
      createdById: args.actorId,
    },
  });
  return id;
}

export async function applyLinkedRecord(args: {
  tx: Tx;
  taskTypeCode: string;
  vehicleId: string | null;
  actorId: string;
  values: Record<string, unknown>;
  odometerKm: number | null;
  totalCost: number | null;
}): Promise<LinkedRecordResult | null> {
  const needsVehicle = ['SERVICE_VISIT', 'TECHNICAL_INSPECTION', 'REGISTRATION', 'TIRE_CHANGE'];
  if (!needsVehicle.includes(args.taskTypeCode)) return null;
  if (!args.vehicleId) {
    throw VfmErrors.validationError([{ path: ['vehicleId'], message: 'Ova vrsta zadatka zahtijeva vozilo.' }]);
  }
  if (args.taskTypeCode === 'SERVICE_VISIT' || args.taskTypeCode === 'TECHNICAL_INSPECTION') {
    const id = await createServiceRecord({
      tx: args.tx,
      vehicleId: args.vehicleId,
      actorId: args.actorId,
      values: args.values,
      serviceType: args.taskTypeCode === 'TECHNICAL_INSPECTION' ? 'Tehnički pregled' : 'Servis',
      odometerKm: args.odometerKm,
      totalCost: args.totalCost,
    });
    return { type: 'SERVICE', id };
  }
  if (args.taskTypeCode === 'REGISTRATION') {
    const id = await createRegistrationRecord({
      tx: args.tx,
      vehicleId: args.vehicleId,
      actorId: args.actorId,
      values: args.values,
    });
    return { type: 'REGISTRATION', id };
  }
  const id = await applyTireChange({
    tx: args.tx,
    vehicleId: args.vehicleId,
    actorId: args.actorId,
    values: args.values,
    odometerKm: args.odometerKm,
  });
  return { type: 'TIRE_INSTALLATION', id };
}
