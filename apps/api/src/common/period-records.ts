/**
 * Zajedničke provjere za zapise s periodom važenja — registracije i osiguranje
 * (docs/03 §3.3, B-10).
 *
 * Preklapanje se provjerava na dva mjesta:
 * 1. **servis** — prijateljska greška `409 PERIOD_OVERLAP` s ID-jem zapisa s
 *    kojim se period preklapa (UI može odmah pokazati koji je);
 * 2. **baza** — `EXCLUDE USING gist (vehicleId, daterange(validFrom, validUntil, '[]'))`
 *    (migracija `2_manual`), jer dva paralelna zahtjeva mogu proći provjeru u
 *    isto vrijeme. Servis mapira i tu grešku na isti kod.
 */
import type { ApiErrorDetail } from '@vfm/shared';
import { VfmException } from './errors/vfm-error.js';

export function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

/** `[validFrom, validUntil]` je zatvoren interval — isti dan na oba kraja se preklapa. */
export function periodsOverlap(
  first: { validFrom: Date | string; validUntil: Date | string },
  second: { validFrom: Date | string; validUntil: Date | string },
): boolean {
  const from = toTime(first.validFrom);
  const until = toTime(first.validUntil);
  return toTime(second.validFrom) <= until && toTime(second.validUntil) >= from;
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(`${value}T00:00:00.000Z`);
}

/**
 * `EXCLUDE` constraint iz baze → `PERIOD_OVERLAP`.
 *
 * Prisma na Postgres grešku `23P01` baca `PrismaClientUnknownRequestError`
 * (nema `code` na vrhu), pa se provjerava i tekst — ali samo za naš constraint,
 * da se ne maskiraju druge greške baze.
 */
export function mapExclusionViolation(error: unknown, constraint: string): never {
  const text = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  if (code === '23P01' || text.includes('23P01') || text.includes(constraint)) {
    throw new VfmException('PERIOD_OVERLAP', 'Period se preklapa s postojećim zapisom.');
  }
  throw error;
}

/** Nedostajuće vozilo je `NOT_FOUND` (umjesto sirovog FK prekršaja). */
export function assertPeriodOrder(validFrom: string, validUntil: string): void {
  if (validUntil < validFrom) {
    throw new VfmException('VALIDATION_ERROR', 'Datum isteka ne može biti prije datuma početka.', [
      detail('validUntil', 'period'),
    ]);
  }
}
