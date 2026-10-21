/**
 * Registracije i osiguranje — polja i payload (unos i izmjena).
 *
 * Jedan izvor za oba ekrana: ako se polje doda samo u jedan, izmjena bi tiho
 * brisala vrijednost koju unos zna upisati. Zato su specifikacije polja i
 * pretvaranje u API payload ovdje, a forme (`record-form.tsx`,
 * `record-edit-form.tsx`) samo renderuju.
 *
 * Novac: API prima **feninge** (BAM × 100), pa se unos uvijek pretvara
 * `moneyToFeninzi`, a prikaz nazad `feninziToInput` (docs/04 §7).
 */
import type { CoreFieldSpec } from '../forms/form-fields.js';
import { feninziToInput, moneyToFeninzi } from './records-model.js';

export type RecordKind = 'REGISTRATION' | 'INSURANCE';

export interface RecordFieldSpec extends CoreFieldSpec {
  /** Polje je iznos u KM koje se u API šalje u feningama. */
  readonly money?: boolean;
}

const COMMON_FIELDS: readonly RecordFieldSpec[] = [
  { key: 'validFrom', label: 'Važi od', kind: 'DATE', required: true },
  { key: 'validUntil', label: 'Važi do', kind: 'DATE', required: true, hint: 'Uključivo.' },
  { key: 'notes', label: 'Napomena', kind: 'MULTILINE' },
];

export const RECORD_FIELDS: Readonly<Record<RecordKind, readonly RecordFieldSpec[]>> = {
  REGISTRATION: [
    { key: 'registrationNumber', label: 'Registarski broj', kind: 'TEXT', required: true },
    ...COMMON_FIELDS,
    { key: 'issuedBy', label: 'Izdavao', kind: 'TEXT' },
    { key: 'costAmount', label: 'Trošak (KM)', kind: 'TEXT', money: true },
  ],
  INSURANCE: [
    { key: 'policyNumber', label: 'Broj police', kind: 'TEXT' },
    { key: 'insuranceCompany', label: 'Osiguravajuća kuća', kind: 'TEXT' },
    { key: 'type', label: 'Vrsta pokrića', kind: 'TEXT', hint: 'npr. KASKO, ODGOVORNOST' },
    ...COMMON_FIELDS,
    { key: 'premiumAmount', label: 'Premija (KM)', kind: 'TEXT', money: true },
    { key: 'deductibleAmount', label: 'Franšiza (KM)', kind: 'TEXT', money: true },
  ],
};

export const RECORD_ENDPOINT: Readonly<Record<RecordKind, string>> = {
  REGISTRATION: '/registrations',
  INSURANCE: '/insurances',
};

/** Ključevi koje dinamička forma ne prikazuje ponovo (već su statične kontrole). */
export function recordHiddenKeys(kind: RecordKind): readonly string[] {
  return RECORD_FIELDS[kind].map((field) => field.key);
}

/** Red iz API-ja → vrijednosti kontrola (`null` → prazno, novac → KM). */
export function recordToCoreValues(
  kind: RecordKind,
  record: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of RECORD_FIELDS[kind]) {
    const raw = record[field.key];
    if (raw === null || raw === undefined) {
      values[field.key] = '';
      continue;
    }
    values[field.key] = field.money && typeof raw === 'number' ? feninziToInput(raw) : String(raw);
  }
  return values;
}

/** `POST` payload: samo popunjena polja (prazno ne postoji, umjesto `""`). */
export function buildCreatePayload(
  kind: RecordKind,
  vehicleId: string,
  core: Readonly<Record<string, string>>,
  formData: Readonly<Record<string, unknown>>,
  formSchemaVersionId: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { vehicleId, formData, formSchemaVersionId };
  for (const field of RECORD_FIELDS[kind]) {
    const raw = (core[field.key] ?? '').trim();
    if (field.money) {
      const amount = moneyToFeninzi(raw);
      if (amount !== null) payload[field.key] = amount;
      continue;
    }
    if (raw !== '') payload[field.key] = raw;
  }
  return payload;
}

/**
 * `PATCH` payload: `version` (optimističko zaključavanje) + **sva** polja.
 *
 * Namjerno sva, a ne samo izmijenjena: prazna opciona polja se šalju kao `null`
 * da se mogu obrisati, a izostavljanje bi značilo „ne diraj" — korisnik tada ne
 * bi mogao ukloniti pogrešan broj police.
 *
 * `status` se šalje samo kad je stvarno promijenjen status (servis provjerava
 * dozvoljene prelaze i vraća `VALIDATION_ERROR` s listom dozvoljenih).
 */
export function buildUpdatePayload(
  kind: RecordKind,
  record: Readonly<{ readonly version: number; readonly status: string }>,
  core: Readonly<Record<string, string>>,
  nextStatus?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { version: record.version };
  for (const field of RECORD_FIELDS[kind]) {
    const raw = (core[field.key] ?? '').trim();
    if (field.money) {
      payload[field.key] = moneyToFeninzi(raw);
      continue;
    }
    if (field.required) {
      if (raw !== '') payload[field.key] = raw;
      continue;
    }
    payload[field.key] = raw === '' ? null : raw;
  }
  if (nextStatus && nextStatus !== record.status) payload.status = nextStatus;
  return payload;
}
