import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  deadlineInfo,
  deadlineLevel,
  endOfLocalDay,
  formatConsumption,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatMoney,
  formatOdometer,
  humanizeRemaining,
  majorToMinor,
  maskEmail,
  maskPlate,
  minorToMajor,
  pluralize,
  toLocalDateString,
  truncate,
} from '../dist/index.js';

describe('novac (integer feningi → KM)', () => {
  it('majorToMinor je stabilan na float greške', () => {
    expect(majorToMinor(19.99)).toBe(1999);
    expect(majorToMinor(0.07)).toBe(7);
    expect(majorToMinor(1)).toBe(100);
    expect(majorToMinor('1234,56')).toBe(123456);
    expect(majorToMinor('0.1')).toBe(10);
  });

  it('minorToMajor je inverzna operacija', () => {
    for (const value of [0, 1, 7, 100, 1999, 123456, 999999999]) {
      expect(majorToMinor(minorToMajor(value))).toBe(value);
    }
  });

  it('bacanja greške na ne-numeričkom ulazu', () => {
    expect(() => majorToMinor('abc')).toThrow(RangeError);
    expect(() => majorToMinor(Number.NaN)).toThrow(RangeError);
  });

  it('formatira bs formatom: 1.234,56 KM', () => {
    const formatted = formatMoney(123456);
    expect(formatted).toBe('1.234,56 KM');
    expect(formatMoney(0)).toBe('0,00 KM');
    expect(formatMoney(7)).toBe('0,07 KM');
    expect(formatMoney(123456, { withCurrency: false })).toBe('1.234,56');
  });

  it('negativni iznosi zadržavaju predznak', () => {
    expect(formatMoney(-123456)).toContain('1.234,56');
    expect(formatMoney(-123456)).toMatch(/^-/u);
  });
});

describe('kilometraža, potrošnja, veličina, trajanje', () => {
  it('formatOdometer koristi bs separator hiljada', () => {
    expect(formatOdometer(123456)).toBe('123.456 km');
    expect(formatOdometer(0)).toBe('0 km');
  });

  it('formatConsumption daje l/100km s dvije decimale', () => {
    expect(formatConsumption(7.85)).toBe('7,85 l/100km');
    expect(formatConsumption(0)).toBe('0,00 l/100km');
  });

  it('formatFileSize prelazi preko jedinica', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1.023 B');
    expect(formatFileSize(1024)).toBe('1,0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1,0 MB');
    expect(formatFileSize(-5)).toBe('0 B');
  });

  it('formatDuration sastavlja jedinice', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(83 * 60_000)).toBe('1h 23m');
    expect(formatDuration(52 * 3_600_000)).toBe('2d 4h');
    expect(formatDuration(-1)).toBe('0s');
  });
});

describe('datum i vrijeme (UTC → Europe/Sarajevo)', () => {
  it('formatDateTime prikazuje lokalno vrijeme Sarajeva', () => {
    // 19.01.2026 23:30 UTC → 20.01.2026 00:30 CET
    expect(formatDateTime('2026-01-19T23:30:00.000Z')).toBe('20.01.2026 00:30');
    // ljetno vrijeme: 19.07.2026 22:30 UTC → 20.07.2026 00:30 CEST
    expect(formatDateTime('2026-07-19T22:30:00.000Z')).toBe('20.07.2026 00:30');
  });

  it('toLocalDateString vraća lokalni dan, ne UTC dan', () => {
    expect(toLocalDateString('2026-01-19T23:30:00.000Z')).toBe('2026-01-20');
    expect(toLocalDateString('2026-07-19T22:30:00.000Z')).toBe('2026-07-20');
    expect(toLocalDateString('2026-07-19T21:30:00.000Z')).toBe('2026-07-19');
  });

  it('endOfLocalDay vraća 23:59:59.999 lokalno (zimi = 22:59:59.999 UTC)', () => {
    const end = endOfLocalDay('2026-01-20T08:00:00.000Z');
    expect(toLocalDateString(end)).toBe('2026-01-20');
    expect(end.toISOString()).toBe('2026-01-20T22:59:59.999Z');
  });

  it('endOfLocalDay ljeti = 21:59:59.999 UTC (CEST)', () => {
    const end = endOfLocalDay('2026-07-20T08:00:00.000Z');
    expect(toLocalDateString(end)).toBe('2026-07-20');
    expect(end.toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });

  it('bacanja greške na neispravnom datumu', () => {
    expect(() => formatDateTime('nije-datum')).toThrow(RangeError);
  });
});

describe('rokovi (deadline)', () => {
  it('daysUntil računa po lokalnim danima, ne po 24h blokovima', () => {
    expect(daysUntil('2026-03-10T23:00:00.000Z', '2026-03-01T01:00:00.000Z')).toBe(10);
    expect(daysUntil('2026-03-01T01:00:00.000Z', '2026-03-01T22:00:00.000Z')).toBe(0);
    expect(daysUntil('2026-02-28T12:00:00.000Z', '2026-03-01T12:00:00.000Z')).toBe(-1);
  });

  it.each([
    [31, 'success'],
    [30, 'info'],
    [8, 'info'],
    [7, 'warning'],
    [1, 'warning'],
    [0, 'danger'],
    [-5, 'danger'],
  ] as const)('deadlineLevel(%i) === %s', (days, level) => {
    expect(deadlineLevel(days)).toBe(level);
  });

  it('deadlineInfo kombinuje dane i nivo', () => {
    const info = deadlineInfo('2026-03-05T12:00:00.000Z', '2026-03-01T12:00:00.000Z');
    expect(info.days).toBe(4);
    expect(info.level).toBe('warning');
  });

  it('humanizeRemaining daje čitljiv bs opis', () => {
    expect(humanizeRemaining(0)).toBe('danas');
    expect(humanizeRemaining(1)).toBe('za 1 dan');
    expect(humanizeRemaining(3)).toBe('za 3 dana');
    expect(humanizeRemaining(5)).toBe('za 5 dana');
    expect(humanizeRemaining(-2)).toBe('prije 2 dana');
  });
});

describe('bosanska pluralizacija', () => {
  it.each([
    [1, '1 dan'],
    [2, '2 dana'],
    [4, '4 dana'],
    [5, '5 dana'],
    [11, '11 dana'],
    [21, '21 dan'],
    [22, '22 dana'],
    [25, '25 dana'],
    [101, '101 dan'],
    [111, '111 dana'],
  ] as const)('pluralize(%i, dan/dana/dana) === %s', (n, expected) => {
    expect(pluralize(n, 'dan', 'dana', 'dana')).toBe(expected);
  });
});

describe('maskiranje i tekstualne pomoćne funkcije', () => {
  it('maskEmail skriva lokalni dio', () => {
    expect(maskEmail('ana.ana@example.com')).toBe('a******@example.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
    expect(maskEmail('bez-at-signa')).toBe('***');
  });

  it('maskPlate zadržava prepoznatljivost', () => {
    expect(maskPlate('A12-E-345')).toBe('A12-**-345');
    expect(maskPlate('AB12')).toBe('****');
  });

  it('truncate skraćuje s elipsom', () => {
    expect(truncate('kratko', 20)).toBe('kratko');
    expect(truncate('ovo je predugacak tekst', 12)).toHaveLength(12);
    expect(truncate('ovo je predugacak tekst', 12)).toMatch(/…$/u);
  });
});
