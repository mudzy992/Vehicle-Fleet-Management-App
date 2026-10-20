/**
 * Vozila — čista logika ekrana (filteri, rokovi, paginacija).
 *
 * Odvojeno od React-a da se pravila mogu testirati bez DOM-a: pragovi boja za
 * „rokove" (docs/06 §7.6), sastavljanje query stringa za `GET /vehicles`
 * (docs/07 §2.5) i brojanje stranica.
 */
import { toLocalDateString } from '@vfm/shared';
import type { VehicleListQuery, VehicleSummary } from '@vfm/shared/schemas';

/** Pragovi rokova u danima (zeleno/žuto/narandžasto/crveno). */
export const DEADLINE_THRESHOLDS = { warn: 30, soon: 7 } as const;

export type DeadlineTone = 'none' | 'ok' | 'warn' | 'soon' | 'overdue';

/** Broj dana između dva `yyyy-MM-dd` datuma (b − a), bez vremenske zone. */
export function daysBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00.000Z`);
  const end = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Boja roka: `overdue` (crveno), `soon` ≤ 7 dana (narandžasto), `warn` ≤ 30
 * (žuto), `ok` (zeleno). `none` kad rok nije upisan — polje tada ne postoji, ne
 * prikazujemo „isteklo".
 */
export function deadlineTone(dateIso: string | null, todayIso = toLocalDateString(new Date())): DeadlineTone {
  if (!dateIso) return 'none';
  const days = daysBetween(todayIso, dateIso);
  if (days < 0) return 'overdue';
  if (days <= DEADLINE_THRESHOLDS.soon) return 'soon';
  if (days <= DEADLINE_THRESHOLDS.warn) return 'warn';
  return 'ok';
}

/** Tekst roka u tabeli — „isteklo prije N dana", „za N dana", „danas". */
export function deadlineLabel(dateIso: string | null, todayIso = toLocalDateString(new Date())): string {
  if (!dateIso) return '—';
  const days = daysBetween(todayIso, dateIso);
  if (days === 0) return 'danas';
  if (days < 0) return `isteklo prije ${Math.abs(days)} d`;
  return `za ${days} d`;
}

/** Jedan red „rokova" widgeta (registracija ili osiguranje). */
export interface DeadlineEntry {
  readonly vehicleId: string;
  readonly internalNo: string;
  readonly label: 'Registracija' | 'Osiguranje';
  readonly date: string;
  readonly days: number;
  readonly tone: DeadlineTone;
}

/**
 * Rokovi iz liste vozila, sortirani od najhitnijeg, ograničeni na `limit`.
 *
 * Arhivirana vozila se preskaču — njihovi rokovi nisu operativni (docs/06 §7.6).
 */
export function collectDeadlines(
  vehicles: readonly VehicleSummary[],
  options: { todayIso?: string; limit?: number; withinDays?: number } = {},
): readonly DeadlineEntry[] {
  const todayIso = options.todayIso ?? toLocalDateString(new Date());
  const limit = options.limit ?? 6;
  const withinDays = options.withinDays ?? DEADLINE_THRESHOLDS.warn;
  const entries: DeadlineEntry[] = [];

  for (const vehicle of vehicles) {
    if (vehicle.status === 'ARCHIVED') continue;
    const pairs: ReadonlyArray<[DeadlineEntry['label'], string | null]> = [
      ['Registracija', vehicle.registrationExpiresAt],
      ['Osiguranje', vehicle.insuranceExpiresAt],
    ];
    for (const [label, date] of pairs) {
      if (!date) continue;
      const days = daysBetween(todayIso, date);
      if (days > withinDays) continue;
      entries.push({
        vehicleId: vehicle.id,
        internalNo: vehicle.internalNo,
        label,
        date,
        days,
        tone: deadlineTone(date, todayIso),
      });
    }
  }

  return entries.sort((a, b) => a.days - b.days || a.internalNo.localeCompare(b.internalNo)).slice(0, limit);
}

/** Filteri ekrana (bez paginacije — nju drži komponenta). */
export interface VehicleFilters {
  readonly q: string;
  readonly status: string;
  readonly sortBy: string;
  readonly sortOrder: 'asc' | 'desc';
}

export const DEFAULT_VEHICLE_FILTERS: VehicleFilters = {
  q: '',
  status: '',
  sortBy: 'internalNo',
  sortOrder: 'asc',
};

/**
 * Query string za `GET /vehicles`.
 *
 * Prazni filteri se **ne šalju** — server tada koristi svoje defaulte, a URL
 * ostaje čitljiv (bitno za dijeljenje linka).
 */
export function buildVehicleQuery(filters: VehicleFilters, page: number, pageSize: number): VehicleListQuery {
  const query: Record<string, string | number> = { page, pageSize, sortBy: filters.sortBy };
  if (filters.sortOrder === 'desc') query.sortOrder = 'desc';
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.status) query.status = filters.status;
  return query as unknown as VehicleListQuery;
}

/** Pretvara filtere u query string (za `api.get`). */
export function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** `true` kad je tabela prazna zbog filtera (a ne zbog praznog registra). */
export function isFilteredEmpty(total: number, filters: VehicleFilters): boolean {
  return total === 0 && (filters.q.trim() !== '' || filters.status !== '');
}
