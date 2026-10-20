/** Konverzije za pregled forme u Builder-u (W21). */
import { describe, expect, it } from 'vitest';
import {
  inputValue,
  moneyInputValue,
  parseInputValue,
  sarajevoToday,
  toggleMulti,
} from './forms-preview-values.js';

describe('parseInputValue', () => {
  it('prazno polje ne postaje 0', () => {
    expect(parseInputValue('NUMBER', '')).toBeUndefined();
    expect(parseInputValue('NUMBER', '   ')).toBeUndefined();
    expect(parseInputValue('MONEY', '')).toBeUndefined();
  });

  it('NUMBER vraća broj, neispravan unos ostaje undefined (validira engine)', () => {
    expect(parseInputValue('NUMBER', '12.5')).toBe(12.5);
    expect(parseInputValue('NUMBER', '-3')).toBe(-3);
    expect(parseInputValue('NUMBER', '12a')).toBeUndefined();
  });

  it('MONEY pretvara KM u feninze i nosi valutu', () => {
    expect(parseInputValue('MONEY', '200.00')).toEqual({ amount: 20000, currency: 'BAM' });
    expect(parseInputValue('MONEY', '0.005')).toEqual({ amount: 1, currency: 'BAM' });
    expect(parseInputValue('MONEY', '15', 'EUR')).toEqual({ amount: 1500, currency: 'EUR' });
  });

  it('ostali tipovi ostaju trimovan tekst', () => {
    expect(parseInputValue('TEXT', '  Golf  ')).toBe('Golf');
    expect(parseInputValue('DATE', ' 2026-10-20 ')).toBe('2026-10-20');
  });
});

describe('inputValue / moneyInputValue', () => {
  it('formatira vrijednosti iz modela za kontrolu', () => {
    expect(inputValue(undefined)).toBe('');
    expect(inputValue(null)).toBe('');
    expect(inputValue(42)).toBe('42');
    expect(inputValue(['A', 'B'])).toBe('A, B');
    expect(inputValue({ amount: 1 })).toBe('');
  });

  it('MONEY prikazuje KM sa dvije decimale', () => {
    expect(moneyInputValue({ amount: 20000, currency: 'BAM' })).toBe('200.00');
    expect(moneyInputValue({ amount: 5, currency: 'BAM' })).toBe('0.05');
    expect(moneyInputValue(undefined)).toBe('');
    expect(moneyInputValue({ currency: 'BAM' })).toBe('');
  });
});

describe('toggleMulti', () => {
  it('dodaje i uklanja kod, bez duplikata', () => {
    expect(toggleMulti(undefined, 'A')).toEqual(['A']);
    expect(toggleMulti(['A'], 'B')).toEqual(['A', 'B']);
    expect(toggleMulti(['A', 'B'], 'A')).toEqual(['B']);
    expect(toggleMulti('nije lista', 'A')).toEqual(['A']);
  });
});

describe('sarajevoToday', () => {
  it('računa datum u Europe/Sarajevo, ne u UTC', () => {
    // 19.10.2026. 23:30 UTC = 20.10.2026. 01:30 u Sarajevu (CET, +1).
    expect(sarajevoToday(new Date('2026-10-19T23:30:00.000Z'))).toBe('2026-10-20');
    // Ljeti (CEST, +2).
    expect(sarajevoToday(new Date('2026-07-01T22:30:00.000Z'))).toBe('2026-07-02');
    expect(sarajevoToday(new Date('2026-07-01T12:00:00.000Z'))).toBe('2026-07-01');
  });
});
