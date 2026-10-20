/**
 * Vozači — čista logika ekrana (filteri, rokovi dozvola).
 *
 * Pravila su ista kao za vozila (`lib/deadlines.ts`): pragovi 30/7/0 dana i iste
 * boje. Razlika je izvor roka — ovdje je `licenseExpiresAt` (nije PII, docs/05
 * §8.2) i `licenseDaysLeft` koji računa server.
 */
import { toLocalDateString } from '@vfm/shared';
import type { DriverListQuery, DriverSummary } from '@vfm/shared/schemas';
import {
  DEADLINE_THRESHOLDS as THRESHOLDS,
  daysBetween as days,
  deadlineTone as tone,
  type DeadlineTone as Tone,
} from '../../lib/deadlines.js';

/** Današnji datum u `Europe/Sarajevo`. */
function today(): string {
  return toLocalDateString(new Date());
}

export interface DriverFilters {
  readonly q: string;
  readonly status: string;
  readonly licenseCategory: string;
  readonly sortBy: string;
  readonly sortOrder: 'asc' | 'desc';
  readonly includeArchived: boolean;
}

export const DEFAULT_DRIVER_FILTERS: DriverFilters = {
  q: '',
  status: '',
  licenseCategory: '',
  sortBy: 'lastName',
  sortOrder: 'asc',
  includeArchived: false,
};

/**
 * Query za `GET /drivers` — prazni filteri se ne šalju (server koristi svoje
 * defaulte, a URL ostaje čitljiv za dijeljenje).
 */
export function buildDriverQuery(
  filters: DriverFilters,
  page: number,
  pageSize: number,
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {
    page,
    pageSize,
    sortBy: filters.sortBy,
  };
  if (filters.sortOrder === 'desc') query.sortOrder = 'desc';
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.status) query.status = filters.status;
  if (filters.licenseCategory.trim()) query.licenseCategory = filters.licenseCategory.trim().toUpperCase();
  if (filters.includeArchived) query.includeArchived = true;
  return query;
}

/** Tipiziran pogled na isti query (servis ga validira `driverListQuerySchema`). */
export function asDriverListQuery(query: Record<string, unknown>): DriverListQuery {
  return query as unknown as DriverListQuery;
}

/** Jedan red widgeta „dozvole koje ističu". */
export interface LicenseDeadlineEntry {
  readonly driverId: string;
  readonly name: string;
  readonly date: string;
  readonly days: number;
  readonly tone: Tone;
}

/**
 * Vozači kojima dozvola ističe unutar `withinDays` (default 30), najhitniji prvi.
 *
 * Arhivirani vozači se preskaču. `licenseDaysLeft` iz API-ja se ne koristi kao
 * izvor istine — računa se iz datuma i proslijeđenog „danas", da widget i tabela
 * nikad ne pokažu različit broj dana.
 */
export function collectLicenseDeadlines(
  drivers: readonly DriverSummary[],
  options: { todayIso?: string; limit?: number; withinDays?: number } = {},
): readonly LicenseDeadlineEntry[] {
  const todayIso = options.todayIso ?? today();
  const limit = options.limit ?? 5;
  const withinDays = options.withinDays ?? THRESHOLDS.warn;
  const entries: LicenseDeadlineEntry[] = [];

  for (const driver of drivers) {
    if (driver.status === 'ARCHIVED') continue;
    if (!driver.licenseExpiresAt) continue;
    const remaining = days(todayIso, driver.licenseExpiresAt);
    if (remaining > withinDays) continue;
    entries.push({
      driverId: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      date: driver.licenseExpiresAt,
      days: remaining,
      tone: tone(driver.licenseExpiresAt, todayIso),
    });
  }

  return entries.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name)).slice(0, limit);
}

/** `true` kad je lista prazna zbog filtera, a ne zbog praznog registra. */
export function isDriverFilteredEmpty(total: number, filters: DriverFilters): boolean {
  return (
    total === 0 && (filters.q.trim() !== '' || filters.status !== '' || filters.licenseCategory.trim() !== '')
  );
}
