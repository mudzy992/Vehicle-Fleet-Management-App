/**
 * Registracije/osiguranje — novac i period (docs/04 §7, docs/07 §2.6).
 *
 * Testovi čuvaju dvije greške koje se lako vrate: decimalni novac umjesto
 * feninga i period koji „pojede" dan (registracija od 20.10. do 19.10.).
 */
import { describe, expect, it } from 'vitest';
import { addDays, defaultPeriod, feninziToInput, isPeriodOverlap, moneyToFeninzi } from './records-model.js';

describe('moneyToFeninzi', () => {
  it('pretvara KM u feninge, uključujući decimalni zarez', () => {
    expect(moneyToFeninzi('45.50')).toBe(4550);
    expect(moneyToFeninzi('45,50')).toBe(4550);
    expect(moneyToFeninzi('0.05')).toBe(5);
    expect(moneyToFeninzi(' 1200 ')).toBe(120_000);
  });

  it('prazno polje ostaje neobavezno, neispravno se ne pretvara u 0', () => {
    expect(moneyToFeninzi('')).toBeNull();
    expect(moneyToFeninzi('   ')).toBeNull();
    expect(moneyToFeninzi('abc')).toBeNull();
    expect(moneyToFeninzi('-5')).toBeNull();
  });

  it('zaokružuje na cijeli fening (bez float ostatka)', () => {
    expect(moneyToFeninzi('0.1')).toBe(10);
    expect(moneyToFeninzi('19.999')).toBe(2000);
  });
});

describe('feninziToInput', () => {
  it('vraća dvije decimale za kontrolu, prazno za `null`', () => {
    expect(feninziToInput(4550)).toBe('45.50');
    expect(feninziToInput(0)).toBe('0.00');
    expect(feninziToInput(null)).toBe('');
  });
});

describe('defaultPeriod', () => {
  it('traje godinu dana, uključujući oba dana', () => {
    expect(defaultPeriod('2026-10-20')).toEqual({
      validFrom: '2026-10-20',
      validUntil: '2027-10-19',
    });
  });

  it('29.02. ne prelazi u 01.03. sljedeće godine', () => {
    expect(defaultPeriod('2024-02-29')).toEqual({
      validFrom: '2024-02-29',
      validUntil: '2025-02-27',
    });
  });
});

describe('addDays', () => {
  it('prelazi mjesec i godinu bez vremenske zone', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isPeriodOverlap', () => {
  it('prepoznaje samo `PERIOD_OVERLAP`', () => {
    expect(isPeriodOverlap('PERIOD_OVERLAP')).toBe(true);
    expect(isPeriodOverlap('VALIDATION_ERROR')).toBe(false);
    expect(isPeriodOverlap(undefined)).toBe(false);
  });
});
