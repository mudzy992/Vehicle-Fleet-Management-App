/** Čista logika montaže/demontaže/zamjene; server ponovo zaključava i validira stanje. */
import { TIRE_POSITIONS, type TirePosition } from '@vfm/shared';

export const TIRE_POSITION_ORDER: readonly TirePosition[] = TIRE_POSITIONS;

function parseKm(raw: string): number {
  const text = raw.trim();
  if (!/^\d+$/u.test(text)) throw new Error('Kilometraža mora biti nenegativan cijeli broj.');
  const value = Number(text);
  if (value > 2147483647) throw new Error('Kilometraža je izvan dozvoljenog opsega.');
  return value;
}

function requireDate(value: string, label: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`${label} je obavezan.`);
  return date;
}

function requirePositions(positions: readonly string[]): TirePosition[] {
  const valid = TIRE_POSITION_ORDER.filter((position) => positions.includes(position));
  if (valid.length === 0) throw new Error('Odaberite barem jednu poziciju montaže.');
  return valid;
}

export function toggleTirePosition(
  positions: readonly TirePosition[],
  position: TirePosition,
  checked: boolean,
): TirePosition[] {
  const next = checked ? [...positions, position] : positions.filter((current) => current !== position);
  return TIRE_POSITION_ORDER.filter((current) => next.includes(current));
}

/** Početni izbor: stare pozicije pri zamjeni, inače prve pozicije prema broju guma. */
export function defaultTirePositions(tireCount: number, preferred: readonly string[] = []): TirePosition[] {
  const limit = Math.max(1, Math.min(tireCount, TIRE_POSITION_ORDER.length));
  const validPreferred = TIRE_POSITION_ORDER.filter((position) => preferred.includes(position));
  return (validPreferred.length > 0 ? validPreferred : TIRE_POSITION_ORDER).slice(0, limit);
}

export function buildMountPayload(args: {
  vehicleId: string;
  setId: string;
  date: string;
  odometerKm: string;
  positions: readonly string[];
  formData: Readonly<Record<string, unknown>>;
  formSchemaVersionId: string;
}): Record<string, unknown> {
  if (!args.setId) throw new Error('Odaberite komplet za montažu.');
  return {
    vehicleId: args.vehicleId,
    setId: args.setId,
    mountedAt: requireDate(args.date, 'Datum montaže'),
    mountedOdometerKm: parseKm(args.odometerKm),
    positions: requirePositions(args.positions),
    formData: args.formData,
    formSchemaVersionId: args.formSchemaVersionId,
  };
}

export function buildDismountPayload(args: {
  version: number;
  date: string;
  odometerKm: string;
  reason: string;
  storageLocation: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    version: args.version,
    dismountedAt: requireDate(args.date, 'Datum demontaže'),
    dismountedOdometerKm: parseKm(args.odometerKm),
  };
  if (args.reason.trim()) payload.reason = args.reason.trim();
  if (args.storageLocation.trim()) payload.storageLocationOnDismount = args.storageLocation.trim();
  return payload;
}

export function buildSwapPayload(args: {
  vehicleId: string;
  currentInstallationId: string;
  currentVersion: number;
  newSetId: string;
  date: string;
  odometerKm: string;
  positions: readonly string[];
  reason: string;
  storageLocation: string;
  formData: Readonly<Record<string, unknown>>;
  formSchemaVersionId: string;
}): Record<string, unknown> {
  if (!args.newSetId) throw new Error('Odaberite novi komplet.');
  const payload: Record<string, unknown> = {
    vehicleId: args.vehicleId,
    currentInstallationId: args.currentInstallationId,
    currentVersion: args.currentVersion,
    newSetId: args.newSetId,
    swappedAt: requireDate(args.date, 'Datum zamjene'),
    odometerKm: parseKm(args.odometerKm),
    positions: requirePositions(args.positions),
    reason: args.reason.trim() || 'SEASONAL_SWAP',
    formData: args.formData,
    formSchemaVersionId: args.formSchemaVersionId,
  };
  if (args.storageLocation.trim()) payload.storageLocationOnDismount = args.storageLocation.trim();
  return payload;
}
