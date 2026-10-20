/**
 * Pretvorba `@db.Date` vrijednosti za Prisma (Faza 3).
 *
 * Zašto postoji: zod šeme (`z.iso.date()`) i API ugovor koriste **date-only**
 * string (`2026-09-11`), ali Prisma za `@db.Date` kolone traži pun ISO-8601
 * DateTime — date-only string pada s:
 *
 *   Invalid value for argument `licenseIssuedAt`: premature end of input.
 *
 * Greška se ne vidi u jediničnim testovima ako fake Prisma prima stringove, pa
 * se konverzija radi na **jednom** mjestu i testovi provjeravaju da u bazu ide
 * `Date`.
 *
 * Ponašanje: `null`/`undefined` → `null` (kolona je nullable), `Date` prolazi
 * nepromijenjen, date-only string se tumači kao **UTC ponoć** (kolona nema
 * vremensku zonu), ostalo ide kroz `Date` i odbija se ako nije ispravno.
 */
export function toDatabaseDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Neispravan datum (Invalid Date).');
    return value;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    // `2026-02-30` bi se tiho prelio u mart — provjeravamo round-trip.
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
      throw new Error(`Neispravan datum: ${value}`);
    }
    return date;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Neispravan datum: ${value}`);
  return parsed;
}
