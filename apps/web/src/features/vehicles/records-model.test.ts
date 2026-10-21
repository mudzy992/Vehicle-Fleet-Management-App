/**
 * Registracije/osiguranje — novac i period (docs/04 §7, docs/07 §2.6).
 *
 * Testovi čuvaju dvije greške koje se lako vrate: decimalni novac umjesto
 * feninga i period koji „pojede" dan (registracija od 20.10. do 19.10.).
 */
import { describe, expect, it } from 'vitest';
import { addDays, defaultPeriod, feninziToInput, isPeriodOverlap, moneyToFeninzi } from './records-model.js';
import { buildUpdatePayload, recordToCoreValues } from './records-fields.js';
import { buildRecordsQuery, toRecordRows } from './records-model.js';

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

describe('buildUpdatePayload', () => {
  const record = { id: 'r1', version: 3, status: 'ACTIVE' };

  it('šalje `version` i sva polja; prazno opciono polje je `null` (može se obrisati)', () => {
    expect(
      buildUpdatePayload('INSURANCE', record, {
        policyNumber: '  ',
        insuranceCompany: 'Sarajevo osiguranje',
        type: '',
        validFrom: '2026-10-20',
        validUntil: '2027-10-19',
        premiumAmount: '250,00',
        deductibleAmount: '',
        notes: '',
      }),
    ).toEqual({
      version: 3,
      policyNumber: null,
      insuranceCompany: 'Sarajevo osiguranje',
      type: null,
      validFrom: '2026-10-20',
      validUntil: '2027-10-19',
      premiumAmount: 25_000,
      deductibleAmount: null,
      notes: null,
    });
  });

  it('obavezna polja šalje samo kad su popunjena (prazno = ne diraj, ne `null`)', () => {
    const payload = buildUpdatePayload('REGISTRATION', record, {
      registrationNumber: '',
      validFrom: '2026-10-20',
      validUntil: '2027-10-19',
      costAmount: '100',
    });
    expect(payload).not.toHaveProperty('registrationNumber');
    expect(payload.costAmount).toBe(10_000);
  });

  it('`status` šalje samo kad je promijenjen', () => {
    const core = { registrationNumber: 'A1', validFrom: '2026-10-20', validUntil: '2027-10-19' };
    expect(buildUpdatePayload('REGISTRATION', record, core, 'ACTIVE')).not.toHaveProperty('status');
    expect(buildUpdatePayload('REGISTRATION', record, core, 'EXPIRED').status).toBe('EXPIRED');
  });
});

describe('recordToCoreValues', () => {
  it('`null` → prazno, novac u feningama → KM, ostalo tekst', () => {
    expect(
      recordToCoreValues('REGISTRATION', {
        registrationNumber: '12-A-345',
        validFrom: '2026-10-20',
        validUntil: '2027-10-19',
        issuedBy: null,
        costAmount: 4550,
        notes: undefined,
      }),
    ).toEqual({
      registrationNumber: '12-A-345',
      validFrom: '2026-10-20',
      validUntil: '2027-10-19',
      issuedBy: '',
      costAmount: '45.50',
      notes: '',
    });
  });
});

describe('buildRecordsQuery', () => {
  it('ne šalje prazne filtere (URL ostaje čitljiv)', () => {
    expect(buildRecordsQuery({ q: '  ', status: '', vehicleId: '', windowDays: '' }, 1, 25)).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('šalje pretragu, vozilo, status i prozor roka kao broj', () => {
    expect(
      buildRecordsQuery({ q: ' 12-A-345 ', status: 'ACTIVE', vehicleId: 'v1', windowDays: '30' }, 2, 25),
    ).toEqual({
      page: 2,
      pageSize: 25,
      q: '12-A-345',
      vehicleId: 'v1',
      status: 'ACTIVE',
      expiringInDays: 30,
    });
  });
});

describe('toRecordRows', () => {
  it('registracija: broj, trošak i izdavalac', () => {
    expect(
      toRecordRows('REGISTRATION', [
        {
          id: 'r1',
          vehicleId: 'v1',
          registrationNumber: '12-A-345',
          validFrom: '2026-10-20',
          validUntil: '2027-10-19',
          status: 'ACTIVE',
          costAmount: 4550,
          issuedBy: null,
        },
      ])[0],
    ).toEqual({
      id: 'r1',
      vehicleId: 'v1',
      number: '12-A-345',
      validFrom: '2026-10-20',
      validUntil: '2027-10-19',
      status: 'ACTIVE',
      amount: 4550,
      extra: '—',
    });
  });

  it('osiguranje: polisa, premija i kuća (fallback na vrstu)', () => {
    const [row] = toRecordRows('INSURANCE', [
      {
        id: 'i1',
        vehicleId: 'v1',
        policyNumber: null,
        insuranceCompany: '',
        type: 'KASKO',
        validFrom: '2026-10-20',
        validUntil: '2027-10-19',
        status: 'ACTIVE',
        premiumAmount: null,
      },
    ]);
    expect(row).toMatchObject({ number: '—', amount: null, extra: 'KASKO' });
  });
});
