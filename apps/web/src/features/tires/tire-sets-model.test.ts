/** Lista, unos i izmjena kompleta ne smiju odstupati od API ugovora. */
import { describe, expect, it } from 'vitest';
import type { TireSetDetail } from '@vfm/shared/schemas';
import {
  DEFAULT_TIRE_SET_FILTERS,
  buildTireSetPayload,
  buildTireSetQuery,
  buildTireSetUpdatePayload,
  tireSetCoreValues,
  tireSetStatusOptions,
} from './tire-sets-model.js';

const versionId = '11111111-1111-4111-8111-111111111111';

const detail: TireSetDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'G-Z-001',
  brand: 'Izmišljena marka',
  model: 'Zimska proba',
  size: '205/55 R16',
  season: 'WINTER',
  tireCount: 4,
  purchaseDate: '2025-10-01',
  purchasePrice: 60050,
  currency: 'BAM',
  status: 'IN_STOCK',
  currentLocation: 'Skladište A',
  notes: null,
  mountedVehicleId: null,
  mountedVehicleInternalNo: null,
  mountedVehiclePlateNumber: null,
  version: 2,
  formSchemaId: '33333333-3333-4333-8333-333333333333',
  formSchemaVersionId: versionId,
  formData: { invoiceNumber: 'F-001', supplier: 'Stari dobavljač' },
};

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

  it('detalj prevodi u kontrole, a statusne opcije prate aktivnu montažu i terminalna stanja', () => {
    expect(tireSetCoreValues(detail)).toMatchObject({
      code: 'G-Z-001',
      purchasePrice: '600.50',
      status: 'IN_STOCK',
    });
    expect(tireSetStatusOptions(detail)).toEqual(['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'SCRAPPED']);
    expect(
      tireSetStatusOptions({
        status: 'MOUNTED',
        mountedVehicleId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toEqual(['MOUNTED']);
    expect(tireSetStatusOptions({ status: 'MOUNTED', mountedVehicleId: null })).toEqual([
      'MOUNTED',
      'IN_STOCK',
      'IN_REPAIR',
      'RETIRED',
      'SCRAPPED',
    ]);
    expect(tireSetStatusOptions({ status: 'SCRAPPED', mountedVehicleId: null })).toEqual(['SCRAPPED']);
  });

  it('PATCH šalje verziju i samo izmjene; prazna opcionalna polja postaju null', () => {
    const core = {
      ...tireSetCoreValues(detail),
      brand: '',
      purchaseDate: '',
      purchasePrice: '',
      status: 'IN_REPAIR',
    };

    expect(
      buildTireSetUpdatePayload(detail, core, {
        supplier: undefined,
        invoiceNumber: 'F-001',
      }),
    ).toEqual({
      version: 2,
      brand: null,
      purchaseDate: null,
      purchasePrice: null,
      status: 'IN_REPAIR',
      formData: { supplier: null, invoiceNumber: 'F-001' },
    });
  });

  it('bez stvarne izmjene ne šalje PATCH, a neizmijenjen formData se izostavlja', () => {
    const core = tireSetCoreValues(detail);
    expect(() =>
      buildTireSetUpdatePayload(detail, core, {
        supplier: 'Stari dobavljač',
        invoiceNumber: 'F-001',
      }),
    ).toThrow('Nema izmjena');

    expect(
      buildTireSetUpdatePayload(
        detail,
        { ...core, brand: 'Nova marka' },
        { invoiceNumber: 'F-001', supplier: 'Stari dobavljač' },
      ),
    ).toEqual({ version: 2, brand: 'Nova marka' });
  });

  it('montiran komplet dozvoljava opisnu ispravku, ali ne ručnu promjenu statusa', () => {
    const mounted: TireSetDetail = {
      ...detail,
      status: 'MOUNTED',
      mountedVehicleId: '44444444-4444-4444-8444-444444444444',
      mountedVehicleInternalNo: 'V-001',
      mountedVehiclePlateNumber: 'A01-K-001',
    };
    const core = tireSetCoreValues(mounted);

    expect(buildTireSetUpdatePayload(mounted, { ...core, brand: 'Ispravka' })).toEqual({
      version: 2,
      brand: 'Ispravka',
    });
    expect(() => buildTireSetUpdatePayload(mounted, { ...core, status: 'IN_STOCK' })).toThrow('demontažom');
  });

  it('nekonzistentan MOUNTED bez aktivne montaže može se ispraviti; SCRAPPED ostaje terminalan', () => {
    const inconsistent: TireSetDetail = { ...detail, status: 'MOUNTED' };
    expect(
      buildTireSetUpdatePayload(inconsistent, {
        ...tireSetCoreValues(inconsistent),
        status: 'IN_STOCK',
      }),
    ).toEqual({ version: 2, status: 'IN_STOCK' });

    const scrapped: TireSetDetail = { ...detail, status: 'SCRAPPED' };
    expect(() =>
      buildTireSetUpdatePayload(scrapped, { ...tireSetCoreValues(scrapped), status: 'IN_STOCK' }),
    ).toThrow('nije dozvoljen');
  });

  it('legacy zapis bez forme mijenja strukturirana polja, ali ne i formData', () => {
    const legacy: TireSetDetail = {
      ...detail,
      formSchemaId: null,
      formSchemaVersionId: null,
      formData: {},
    };
    const core = tireSetCoreValues(legacy);

    expect(buildTireSetUpdatePayload(legacy, { ...core, brand: 'Legacy' })).toEqual({
      version: 2,
      brand: 'Legacy',
    });
    expect(() =>
      buildTireSetUpdatePayload(legacy, { ...core, brand: 'Legacy' }, { supplier: 'Novi' }),
    ).toThrow('nema zapisnu verziju');
  });
});
