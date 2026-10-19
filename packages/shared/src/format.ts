/**
 * VFM — formatiranje vrijednosti za `bs` (bosanski) lokal.
 *
 * Principi (docs/02 §7, docs/06 §6):
 * - Baza čuva **UTC** (`timestamptz`) i **cijele feninge** (integer).
 * - Prikaz je uvijek u `Europe/Sarajevo` i formatu `dd.MM.yyyy HH:mm` / `1.234,56 KM`.
 * - Funkcije su **čiste** (bez I/O, bez React/Nest dependencija) da bi ih
 *   dijelili web, mobilni i API (npr. za generisanje PDF/Excel izvještaja).
 */
import { CURRENCY_LABEL, MINOR_UNITS_PER_MAJOR, TIMEZONE } from './constants.js';

// -----------------------------------------------------------------------------
//  Novac
// -----------------------------------------------------------------------------

/** Pretvara feninge (integer) u KM decimalni broj. */
export function minorToMajor(minorUnits: number): number {
  return minorUnits / MINOR_UNITS_PER_MAJOR;
}

/**
 * Pretvara KM iznos u feninge (integer).
 * Koristi `Math.round` da izbjegne probleme s float reprezentacijom
 * (npr. `19.99 * 100 = 1998.9999…`).
 */
export function majorToMinor(majorUnits: number | string): number {
  const value = typeof majorUnits === 'string' ? Number(majorUnits.replace(',', '.')) : majorUnits;
  if (!Number.isFinite(value)) {
    throw new RangeError(`majorToMinor: očekivan numerički iznos, dobijeno "${majorUnits}"`);
  }
  return Math.round(value * MINOR_UNITS_PER_MAJOR);
}

/** Formatira iznos u feningima kao `1.234,56 KM` (bs lokal, sa ili bez oznake valute). */
export function formatMoney(minorUnits: number, options?: { withCurrency?: boolean }): string {
  const amount = minorToMajor(minorUnits);
  const formatted = new Intl.NumberFormat('bs-BA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return options?.withCurrency === false ? formatted : `${formatted} ${CURRENCY_LABEL}`;
}

/** Formatira cijeli broj s bs separatorima (`1.234`). */
export function formatInteger(value: number): string {
  return new Intl.NumberFormat('bs-BA', { maximumFractionDigits: 0 }).format(value);
}

/** Formatira kilometražu (`123.456 km`). */
export function formatOdometer(km: number): string {
  return `${formatInteger(km)} km`;
}

/** Formatira potrošnju goriva (`7,85 l/100km`). */
export function formatConsumption(litersPer100km: number): string {
  const formatted = new Intl.NumberFormat('bs-BA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(litersPer100km);
  return `${formatted} l/100km`;
}

// -----------------------------------------------------------------------------
//  Datum i vrijeme (UTC → Europe/Sarajevo)
// -----------------------------------------------------------------------------

/**
 * Dijelovi datuma u `Europe/Sarajevo`.
 *
 * Namjerno NE koristimo `Intl.DateTimeFormat('bs-BA')` za finalni string:
 * ICU dodaje razmake i tačku na kraj ("20. 01. 2026.") sto se razlikuje između
 * Node/browser verzija. Uzimamo dijelove pa sami sastavljamo fiksni format
 * `dd.MM.yyyy` (zahtjev iz docs/06 §6).
 */
function zonedParts(input: Date | string | number): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(toDate(input))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

/** `dd.MM.yyyy` */
export function formatDate(input: Date | string | number): string {
  const { year, month, day } = zonedParts(input);
  return `${day}.${month}.${year}`;
}

/** `dd.MM.yyyy HH:mm` */
export function formatDateTime(input: Date | string | number): string {
  const { year, month, day, hour, minute } = zonedParts(input);
  return `${day}.${month}.${year} ${hour}:${minute}`;
}

/** `HH:mm` */
export function formatTime(input: Date | string | number): string {
  const { hour, minute } = zonedParts(input);
  return `${hour}:${minute}`;
}

/** ISO-8601 string u UTC (`2026-10-19T12:00:00.000Z`) — za API odgovore. */
export function toUtcIso(input: Date | string | number): string {
  return toDate(input).toISOString();
}

/**
 * Lokalni datum u `Europe/Sarajevo` kao ISO string (`yyyy-MM-dd`).
 * Koristi se za poređenje rokova ("do kraja dana po lokalnom vremenu").
 */
export function toLocalDateString(input: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDate(input));
}

/**
 * Kraj lokalnog dana (23:59:59.999 u `Europe/Sarajevo`) kao UTC `Date`.
 * Potreban za ispravno računanje rokova i podsjetnika (N-11).
 */
export function endOfLocalDay(input: Date | string | number): Date {
  const localDate = toLocalDateString(input);
  // Europe/Sarajevo je CET (UTC+1) ili CEST (UTC+2). Računamo oba i biramo
  // onaj koji je zaista taj lokalni datum — bez oslanjanja na DST tabele.
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(`${localDate}T23:59:59.999Z`);
    candidate.setUTCHours(candidate.getUTCHours() - offsetHours);
    if (toLocalDateString(candidate) === localDate) {
      return candidate;
    }
  }
  return new Date(`${localDate}T22:59:59.999Z`);
}

function toDate(input: Date | string | number): Date {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError('toDate: neispravan Date');
    return input;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`toDate: neispravan datum "${String(input)}"`);
  }
  return date;
}

// -----------------------------------------------------------------------------
//  Rokovi (deadline) — semantika boja iz docs/06 §6.2
// -----------------------------------------------------------------------------

/** Pragovi roka u danima: >30 success, 8–30 info, 1–7 warning, ≤0 danger. */
export const DEADLINE_THRESHOLDS = {
  successDays: 30,
  infoDays: 7,
} as const;

export type DeadlineLevel = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/**
 * Broj preostalih dana do roka (lokalni dan u `Europe/Sarajevo`, ne 24h blokovi).
 * Negativno = probijen rok.
 */
export function daysUntil(deadline: Date | string | number, now: Date | string | number = new Date()): number {
  const target = new Date(toLocalDateString(deadline) + 'T00:00:00Z').getTime();
  const current = new Date(toLocalDateString(now) + 'T00:00:00Z').getTime();
  return Math.round((target - current) / 86_400_000);
}

/** Semantički nivo roka (mapira se na dizajn tokene boja). */
export function deadlineLevel(days: number): DeadlineLevel {
  if (days <= 0) return 'danger';
  if (days <= DEADLINE_THRESHOLDS.infoDays) return 'warning';
  if (days <= DEADLINE_THRESHOLDS.successDays) return 'info';
  return 'success';
}

/** Kombinovano: nivo + preostali dani za datum roka. */
export function deadlineInfo(
  deadline: Date | string | number,
  now: Date | string | number = new Date(),
): { days: number; level: DeadlineLevel } {
  const days = daysUntil(deadline, now);
  return { days, level: deadlineLevel(days) };
}

/**
 * Ljudski čitljiv opis preostalog vremena na bosanskom, s pravilnom
 * pluralizacijom: `1 dan`, `3 dana`, `5 dana`, `2 sata`, `45 minuta`.
 */
export function humanizeRemaining(days: number): string {
  if (days === 0) return 'danas';
  if (days < 0) {
    const abs = Math.abs(days);
    return `prije ${pluralize(abs, 'dan', 'dana', 'dana')}`;
  }
  return `za ${pluralize(days, 'dan', 'dana', 'dana')}`;
}

/**
 * Bosanska pluralizacija.
 * Pravilo: n%10==1 && n%100!=11 → `one`; n%10 u 2..4 && n%100 nije 12..14 → `few`;
 * inače → `many`.
 */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

// -----------------------------------------------------------------------------
//  Trajanje
// -----------------------------------------------------------------------------

/** Formatira trajanje iz milisekundi (`1h 23m`, `45s`, `2d 4h`). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}

/** Formatira veličinu datoteke (`1,4 MB`). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat('bs-BA', {
    minimumFractionDigits: unitIndex === 0 ? 0 : 1,
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

// -----------------------------------------------------------------------------
//  Ostalo
// -----------------------------------------------------------------------------

/** Maskira e-mail (`a***@example.com`) — koristi se u audit logovima. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

/** Maskira registraciju vozila tako da ostane prepoznatljivo (`A12-**-345`). */
export function maskPlate(plate: string): string {
  const normalized = plate.trim().toUpperCase();
  if (normalized.length <= 4) return '****';
  return `${normalized.slice(0, 3)}-${'*'.repeat(2)}-${normalized.slice(-3)}`;
}

/** Skraćuje string s elipsom (za tabele). */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Normalizuje unos za pretragu (lowercase, bez višestrukih razmaka). */
export function normalizeSearchInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
