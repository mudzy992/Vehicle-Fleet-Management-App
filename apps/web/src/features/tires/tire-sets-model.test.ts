/** Lista i unos kompleta: query i pretvaranje KM u feninge ne smiju odstupati od API-ja. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIRE_SET_FILTERS, buildTireSetPayload, buildTireSetQuery } from './tire-sets-model.js';

const versionId = '11111111-1111-4111-8111-111111111111';

describe('Kompleti guma — model ekrana', () => {
  it('prazne filtere ne šalje, a dostupnost šalje kao true', () => {
    expect(buildTireSetQuery(DEFAULT_TIRE_SET_FILTERS, 1, 25)).toEqual({
      page: 1,
      pageSize: 25,
      sortBy: 'code',
      sortOrder: 'asc',
    });
    expect(
      buildTireSetQuery(
        { ...DEFAULT_TIRE_SET_FILTERS, q: ' G-001 ', season: 'WINTER', availableOnly: true },
        2,
        25,
      ),
    ).toMatchObject({ q: 'G-001', season: 'WINTER', availableOnly: 'true', page: 2 });
  });

  it('gradi DTO bez praznih opcionalnih polja i s cijenom u feningama', () => {
    expect(
      buildTireSetPayload(
        {
          code: ' G-Z-001 ',
          brand: ' Izmišljena marka ',
          season: 'WINTER',
          tireCount: '',
          purchasePrice: '600,50',
          currentLocation: ' Skladište A ',
        },
        { supplier: 'Dobavljač' },
        versionId,
      ),
    ).toEqual({
      code: 'G-Z-001',
      brand: 'Izmišljena marka',
      season: 'WINTER',
      tireCount: 4,
      purchasePrice: 60050,
      currentLocation: 'Skladište A',
      formData: { supplier: 'Dobavljač' },
      formSchemaVersionId: versionId,
    });
  });

  it('odbija nepotpun ili neispravan unos prije zahtjeva', () => {
    const base = { code: 'G-001', season: 'SUMMER', tireCount: '4' };
    expect(() => buildTireSetPayload({ ...base, code: ' ' }, {}, versionId)).toThrow('Kod kompleta');
    expect(() => buildTireSetPayload({ ...base, season: '' }, {}, versionId)).toThrow('sezonu');
    expect(() => buildTireSetPayload({ ...base, tireCount: '9' }, {}, versionId)).toThrow('Broj guma');
    expect(() => buildTireSetPayload({ ...base, purchasePrice: '-1' }, {}, versionId)).toThrow('cijenu');
  });
});
