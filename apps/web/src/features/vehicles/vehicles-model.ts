/**
 * Vozila — čista logika ekrana (filteri, rokovi, paginacija).
 *
 * Odvojeno od React-a da se pravila mogu testirati bez DOM-a: pragovi boja za
 * „rokove" (docs/06 §7.6), sastavljanje query stringa za `GET /vehicles`
 * (docs/07 §2.5) i brojanje stranica.
 */
import { toLocalDateString } from '@vfm/shared';
import type { VehicleListQuery, VehicleSummary } from '@vfm/shared/schemas';
import {
  DEADLINE_THRESHOLDS as THRESHOLDS,
  daysBetween as days,
  deadlineTone as tone,
  type DeadlineTone as Tone,
} from '../../lib/deadlines.js';

export { DEADLINE_THRESHOLDS, daysBetween } from '../../lib/deadlines.js';
export type { DeadlineTone } from '../../lib/deadlines.js';

/** Današnji datum u `Europe/Sarajevo` (`yyyy-MM-dd`). */
function today(): string {
  return toLocalDateString(new Date());
}

/**
 * Lokalni omotači: ekran ne mora svaki put računati „danas", ali testovi mogu
 * dati fiksan datum (inače bi test zavisio od sistemskog sata).
 */
export function deadlineTone(dateIso: string | null, todayIso: string = today()): Tone {
  return tone(dateIso, todayIso);
}

export function deadlineLabel(dateIso: string | null, todayIso: string = today()): string {
  const day = todayIso;
  if (!dateIso) return '—';
  const diff = days(day, dateIso);
  if (diff === 0) return 'danas';
  if (diff < 0) return `isteklo prije ${Math.abs(diff)} d`;
  return `za ${diff} d`;
}

/** Jedan red „rokova" widgeta (registracija ili osiguranje). */
export interface DeadlineEntry {
  readonly vehicleId: string;
  readonly internalNo: string;
  readonly label: 'Registracija' | 'Osiguranje';
  readonly date: string;
  readonly days: number;
  readonly tone: Tone;
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
  const todayIso = options.todayIso ?? today();
  const limit = options.limit ?? 6;
  const withinDays = options.withinDays ?? THRESHOLDS.warn;
  const entries: DeadlineEntry[] = [];

  for (const vehicle of vehicles) {
    if (vehicle.status === 'ARCHIVED') continue;
    const pairs: ReadonlyArray<[DeadlineEntry['label'], string | null]> = [
      ['Registracija', vehicle.registrationExpiresAt],
      ['Osiguranje', vehicle.insuranceExpiresAt],
    ];
    for (const [label, date] of pairs) {
      if (!date) continue;
      const remaining = days(todayIso, date);
      if (remaining > withinDays) continue;
      entries.push({
        vehicleId: vehicle.id,
        internalNo: vehicle.internalNo,
        label,
        date,
        days: remaining,
        tone: tone(date, todayIso),
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
