/**
 * Rokovi — pragovi i tekstovi (docs/06 §7.6), dijeljeni među ekranima.
 *
 * Zašto zajednički modul: vozila (registracija/osiguranje) i vozači (dozvola)
 * koriste **iste** pragove i iste boje; da pravilo ne bi „pobjeglo" u dva
 * ekrana, živi ovdje i testira se jednom.
 */
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
export function deadlineTone(dateIso: string | null, todayIso: string): DeadlineTone {
  if (!dateIso) return 'none';
  const days = daysBetween(todayIso, dateIso);
  if (days < 0) return 'overdue';
  if (days <= DEADLINE_THRESHOLDS.soon) return 'soon';
  if (days <= DEADLINE_THRESHOLDS.warn) return 'warn';
  return 'ok';
}

/** Tekst roka u tabeli — „isteklo prije N dana", „za N dana", „danas". */
export function deadlineLabel(dateIso: string | null, todayIso: string): string {
  if (!dateIso) return '—';
  const days = daysBetween(todayIso, dateIso);
  if (days === 0) return 'danas';
  if (days < 0) return `isteklo prije ${Math.abs(days)} d`;
  return `za ${days} d`;
}

/** Semantički nivo za `Badge` (rok → boja). */
export function deadlineLevel(tone: DeadlineTone): 'success' | 'warning' | 'danger' | 'neutral' {
  if (tone === 'overdue') return 'danger';
  if (tone === 'ok') return 'success';
  if (tone === 'none') return 'neutral';
  return 'warning';
}
