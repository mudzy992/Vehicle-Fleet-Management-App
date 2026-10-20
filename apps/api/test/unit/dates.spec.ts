/**
 * `toDatabaseDate` — granica API (`YYYY-MM-DD`) ↔ Prisma (`@db.Date`).
 *
 * Regresija iz deploya: seed je slao `licenseIssuedAt: "2022-09-11"` i Prisma je
 * odbila upis s „premature end of input". Ovi testovi čuvaju konverziju na
 * jednom mjestu.
 */
import { describe, expect, it } from 'vitest';
import { toDatabaseDate } from '../../src/common/dates.js';

describe('toDatabaseDate', () => {
  it('date-only string tumači kao UTC ponoć', () => {
    const date = toDatabaseDate('2026-09-11');
    expect(date).toBeInstanceOf(Date);
    expect(date?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('`Date` prolazi nepromijenjen', () => {
    const value = new Date('2026-09-11T00:00:00.000Z');
    expect(toDatabaseDate(value)).toBe(value);
  });

  it('`null` i `undefined` ostaju `null` (nullable kolone)', () => {
    expect(toDatabaseDate(null)).toBeNull();
    expect(toDatabaseDate(undefined)).toBeNull();
  });

  it('pun ISO DateTime se prihvata', () => {
    expect(toDatabaseDate('2026-09-11T14:30:00.000Z')?.toISOString()).toBe('2026-09-11T14:30:00.000Z');
  });

  it('neispravan datum se odbija', () => {
    expect(() => toDatabaseDate('nije-datum')).toThrow(/Neispravan datum/u);
    expect(() => toDatabaseDate('2026-02-30')).toThrow(/Neispravan datum/u);
    expect(() => toDatabaseDate(new Date('nope'))).toThrow(/Invalid Date/u);
  });
});
