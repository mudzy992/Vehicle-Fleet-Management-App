/**
 * Vozila — testovi čiste logike ekrana (pragovi rokova, filteri, widget).
 *
 * Boje rokova su poslovno pravilo (docs/06 §7.6), ne stil — zato imaju test.
 */
import { describe, expect, it } from 'vitest';
import type { VehicleSummary } from '@vfm/shared/schemas';
import {
  buildVehicleQuery,
  collectDeadlines,
  daysBetween,
  deadlineLabel,
  deadlineTone,
  isFilteredEmpty,
  toQueryString,
} from './vehicles-model.js';

const TODAY = '2026-10-20';

function vehicle(overrides: Partial<VehicleSummary> = {}): VehicleSummary {
  return {
    id: `id-${overrides.internalNo ?? '001'}`,
    internalNo: 'VFM-001',
    make: 'VW',
    model: 'Golf',
    year: 2019,
    plateNumber: 'A12-M-345',
    fuelType: 'DIESEL',
    status: 'ACTIVE',
    odometerKm: 120_000,
    odometerUpdatedAt: null,
    registrationExpiresAt: null,
    insuranceExpiresAt: null,
    archivedAt: null,
    version: 1,
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('računa razliku u danima bez uticaja vremenske zone', () => {
    expect(daysBetween('2026-10-20', '2026-10-25')).toBe(5);
    expect(daysBetween('2026-10-20', '2026-10-20')).toBe(0);
    expect(daysBetween('2026-10-20', '2026-10-15')).toBe(-5);
  });

  it('prelaz na zimsko vrijeme ne pomjera dan', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('deadlineTone', () => {
  it('nema roka → `none`', () => {
    expect(deadlineTone(null, TODAY)).toBe('none');
  });

  it('preko 30 dana → `ok`', () => {
    expect(deadlineTone('2026-12-01', TODAY)).toBe('ok');
  });

  it('tačno 30 dana → `warn`, 7 dana → `soon`', () => {
    expect(deadlineTone('2026-11-19', TODAY)).toBe('warn');
    expect(deadlineTone('2026-10-27', TODAY)).toBe('soon');
  });

  it('danas je `soon`, jučer je `overdue`', () => {
    expect(deadlineTone('2026-10-20', TODAY)).toBe('soon');
    expect(deadlineTone('2026-10-19', TODAY)).toBe('overdue');
  });
});

describe('deadlineLabel', () => {
  it('opisuje rok ljudski', () => {
    expect(deadlineLabel(null, TODAY)).toBe('—');
    expect(deadlineLabel('2026-10-20', TODAY)).toBe('danas');
    expect(deadlineLabel('2026-10-25', TODAY)).toBe('za 5 d');
    expect(deadlineLabel('2026-10-15', TODAY)).toBe('isteklo prije 5 d');
  });
});

describe('collectDeadlines', () => {
  it('uzima registraciju i osiguranje, sortira po hitnosti', () => {
    const entries = collectDeadlines(
      [
        vehicle({ internalNo: 'A', registrationExpiresAt: '2026-10-28', insuranceExpiresAt: '2026-11-05' }),
        vehicle({ internalNo: 'B', registrationExpiresAt: '2026-10-22' }),
      ],
      { todayIso: TODAY },
    );

    expect(entries.map((entry) => [entry.internalNo, entry.label, entry.days])).toEqual([
      ['B', 'Registracija', 2],
      ['A', 'Registracija', 8],
      ['A', 'Osiguranje', 16],
    ]);
  });

  it('preskače arhivirana vozila i rokove dalje od prozora', () => {
    const entries = collectDeadlines(
      [
        vehicle({ internalNo: 'ARH', status: 'ARCHIVED', registrationExpiresAt: '2026-10-21' }),
        vehicle({ internalNo: 'DALEKO', registrationExpiresAt: '2027-06-01' }),
        vehicle({ internalNo: 'BLIZU', insuranceExpiresAt: '2026-10-24' }),
      ],
      { todayIso: TODAY },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.internalNo).toBe('BLIZU');
  });

  it('poštuje `limit`', () => {
    const entries = collectDeadlines(
      Array.from({ length: 10 }, (_, index) =>
        vehicle({ internalNo: `V${index}`, registrationExpiresAt: '2026-10-25' }),
      ),
      { todayIso: TODAY, limit: 3 },
    );
    expect(entries).toHaveLength(3);
  });
});

describe('buildVehicleQuery', () => {
  it('prazne filtere ne šalje, `q` trimuje', () => {
    expect(
      buildVehicleQuery({ q: '  golf  ', status: '', sortBy: 'internalNo', sortOrder: 'asc' }, 2, 25),
    ).toEqual({ page: 2, pageSize: 25, sortBy: 'internalNo', q: 'golf' });
  });

  it('status i obrnut redoslijed se šalju kad postoje', () => {
    expect(
      buildVehicleQuery({ q: '', status: 'ARCHIVED', sortBy: 'odometerKm', sortOrder: 'desc' }, 1, 25),
    ).toEqual({ page: 1, pageSize: 25, sortBy: 'odometerKm', sortOrder: 'desc', status: 'ARCHIVED' });
  });
});

describe('toQueryString', () => {
  it('preskače prazne vrijednosti i enkodira', () => {
    expect(toQueryString({ page: 1, q: 'golf gti', status: '', includeArchived: true })).toBe(
      'page=1&q=golf+gti&includeArchived=true',
    );
  });
});

describe('isFilteredEmpty', () => {
  it('razlikuje prazan registar od praznog rezultata filtera', () => {
    expect(isFilteredEmpty(0, { q: '', status: '', sortBy: 'internalNo', sortOrder: 'asc' })).toBe(false);
    expect(isFilteredEmpty(0, { q: 'golf', status: '', sortBy: 'internalNo', sortOrder: 'asc' })).toBe(true);
    expect(isFilteredEmpty(0, { q: '', status: 'ACTIVE', sortBy: 'internalNo', sortOrder: 'asc' })).toBe(
      true,
    );
    expect(isFilteredEmpty(5, { q: 'golf', status: '', sortBy: 'internalNo', sortOrder: 'asc' })).toBe(false);
  });
});
