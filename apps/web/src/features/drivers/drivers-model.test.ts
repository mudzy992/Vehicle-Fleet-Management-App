/**
 * Vozači — testovi čiste logike (filteri, rok dozvole, widget).
 *
 * Rok dozvole nije PII (docs/05 §8.2) i mora se vidjeti i bez `driver:view_pii`,
 * pa je boja/tekst poslovno pravilo, ne stil.
 */
import { describe, expect, it } from 'vitest';
import type { DriverSummary } from '@vfm/shared/schemas';
import {
  DEFAULT_DRIVER_FILTERS,
  buildDriverQuery,
  collectLicenseDeadlines,
  isDriverFilteredEmpty,
} from './drivers-model.js';

const TODAY = '2026-10-20';

function driver(overrides: Partial<DriverSummary> = {}): DriverSummary {
  return {
    id: `id-${overrides.lastName ?? 'Hodzic'}`,
    firstName: 'Fikret',
    lastName: 'Hodžić',
    employeeNumber: 'ZAP-001',
    employmentStatus: 'STALNI',
    status: 'ACTIVE',
    licenseExpiresAt: null,
    categories: ['B'],
    licenseDaysLeft: null,
    version: 1,
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildDriverQuery', () => {
  it('ne šalje prazne filtere, trimuje pretragu i normalizuje kategoriju', () => {
    expect(
      buildDriverQuery({ ...DEFAULT_DRIVER_FILTERS, q: '  fikret ', licenseCategory: 'ce' }, 2, 25),
    ).toEqual({ page: 2, pageSize: 25, sortBy: 'lastName', q: 'fikret', licenseCategory: 'CE' });
  });

  it('šalje status, obrnut redoslijed i arhivirane kad se traže', () => {
    expect(
      buildDriverQuery(
        {
          ...DEFAULT_DRIVER_FILTERS,
          status: 'INACTIVE',
          sortBy: 'licenseExpiresAt',
          sortOrder: 'desc',
          includeArchived: true,
        },
        1,
        25,
      ),
    ).toEqual({
      page: 1,
      pageSize: 25,
      sortBy: 'licenseExpiresAt',
      sortOrder: 'desc',
      status: 'INACTIVE',
      includeArchived: true,
    });
  });

  it('prazan filteri daju samo paginaciju i sortiranje', () => {
    expect(buildDriverQuery(DEFAULT_DRIVER_FILTERS, 1, 25)).toEqual({
      page: 1,
      pageSize: 25,
      sortBy: 'lastName',
    });
  });
});

describe('collectLicenseDeadlines', () => {
  it('uzima samo dozvole unutar 30 dana, najhitnije prve', () => {
    const entries = collectLicenseDeadlines(
      [
        driver({ lastName: 'Daleko', licenseExpiresAt: '2027-05-01' }),
        driver({ lastName: 'Blizu', licenseExpiresAt: '2026-10-24' }),
        driver({ lastName: 'Istekla', licenseExpiresAt: '2026-10-01' }),
        driver({ lastName: 'Bez', licenseExpiresAt: null }),
      ],
      { todayIso: TODAY },
    );

    expect(entries.map((entry) => [entry.name, entry.days, entry.tone])).toEqual([
      ['Fikret Istekla', -19, 'overdue'],
      ['Fikret Blizu', 4, 'soon'],
    ]);
  });

  it('preskače arhivirane vozače', () => {
    const entries = collectLicenseDeadlines(
      [driver({ lastName: 'Arhiv', status: 'ARCHIVED', licenseExpiresAt: '2026-10-21' })],
      { todayIso: TODAY },
    );
    expect(entries).toHaveLength(0);
  });

  it('poštuje `limit` i `withinDays`', () => {
    const entries = collectLicenseDeadlines(
      Array.from({ length: 6 }, (_, index) =>
        driver({ lastName: `V${index}`, licenseExpiresAt: '2026-10-25' }),
      ),
      { todayIso: TODAY, limit: 3, withinDays: 60 },
    );
    expect(entries).toHaveLength(3);
  });

  it('računa dane iz datuma, ne iz `licenseDaysLeft` (widget i tabela se slažu)', () => {
    const entries = collectLicenseDeadlines(
      [driver({ licenseExpiresAt: '2026-10-25', licenseDaysLeft: 999 })],
      { todayIso: TODAY },
    );
    expect(entries[0]!.days).toBe(5);
  });
});

describe('isDriverFilteredEmpty', () => {
  it('razlikuje prazan registar od praznog rezultata filtera', () => {
    expect(isDriverFilteredEmpty(0, DEFAULT_DRIVER_FILTERS)).toBe(false);
    expect(isDriverFilteredEmpty(0, { ...DEFAULT_DRIVER_FILTERS, q: 'fikret' })).toBe(true);
    expect(isDriverFilteredEmpty(0, { ...DEFAULT_DRIVER_FILTERS, status: 'ACTIVE' })).toBe(true);
    expect(isDriverFilteredEmpty(0, { ...DEFAULT_DRIVER_FILTERS, licenseCategory: 'C' })).toBe(true);
    expect(isDriverFilteredEmpty(3, { ...DEFAULT_DRIVER_FILTERS, q: 'fikret' })).toBe(false);
  });
});
