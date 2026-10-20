/**
 * Katalog tipova polja (docs/04-FORM_ENGINE.md §3) — **zatvorena lista**.
 *
 * Enumi tipova žive u `@vfm/shared` (jedan izvor istine za API/web/mobilnu);
 * ovdje su samo metapodaci koje engine treba: vrijednost u JSON-u, dozvoljeni
 * validacijski ključevi po tipu i mobilna podrška.
 */
import { ATTACHMENT_STAGES, FIELD_TYPES, FORM_SUBJECTS } from '@vfm/shared';
import type { AttachmentStage, FieldType, FormSubject } from '@vfm/shared';

export { FIELD_TYPES };
export type { FieldType };

/** Vrsta vrijednosti koju tip polja upisuje u `formData` (§3, kolona "Vrijednost"). */
export const FIELD_VALUE_KINDS = [
  'string',
  'integer',
  'decimal',
  'date',
  'datetime',
  'boolean',
  'stringArray',
  'money',
  'currency',
  'attachmentIds',
  'uuid',
  'recordReference',
  'computed',
  'none',
] as const;
export type FieldValueKind = (typeof FIELD_VALUE_KINDS)[number];

/** Mapiranje tip → vrsta vrijednosti (koristi se za validaciju zapisa, §9). */
export const FIELD_VALUE_KIND: Readonly<Record<FieldType, FieldValueKind>> = {
  TEXT: 'string',
  TEXTAREA: 'string',
  INTEGER: 'integer',
  DECIMAL: 'decimal',
  DATE: 'date',
  DATETIME: 'datetime',
  BOOLEAN: 'boolean',
  SINGLE_CHOICE: 'string',
  MULTI_CHOICE: 'stringArray',
  DROPDOWN: 'string',
  MONEY: 'money',
  CURRENCY: 'currency',
  PHOTO: 'attachmentIds',
  FILE: 'attachmentIds',
  REFERENCE_VEHICLE: 'uuid',
  REFERENCE_DRIVER: 'uuid',
  REFERENCE_RECORD: 'recordReference',
  SECTION: 'none',
  COMPUTED: 'computed',
};

/**
 * Dozvoljeni ključevi unutar `validation` po tipu polja (§3, kolona "Validacije").
 * Sve ostalo → `422 FORM_VALIDATION_FAILED` (nepoznat ključ), jer bi tiha
 * ignorisanja značila da pravilo ne važi ni na serveru ni na klijentu.
 */
export const ALLOWED_VALIDATION_KEYS: Readonly<Record<FieldType, readonly string[]>> = {
  TEXT: ['minLength', 'maxLength', 'pattern', 'trim'],
  TEXTAREA: ['minLength', 'maxLength', 'pattern', 'trim', 'rows'],
  INTEGER: ['min', 'max', 'step'],
  DECIMAL: ['min', 'max', 'precision', 'step'],
  DATE: ['minDate', 'maxDate', 'notInFuture', 'notInPast'],
  DATETIME: ['minDate', 'maxDate', 'notInFuture', 'notInPast', 'granularity'],
  BOOLEAN: ['requiredTrue'],
  SINGLE_CHOICE: ['minSelect', 'maxSelect'],
  MULTI_CHOICE: ['minSelect', 'maxSelect', 'unique'],
  DROPDOWN: ['minLength', 'maxLength'],
  MONEY: ['min', 'max', 'currency'],
  CURRENCY: ['allowedCurrencies'],
  PHOTO: ['minFiles', 'maxFiles', 'maxSizeMb', 'mimeTypes', 'requireStage'],
  FILE: ['minFiles', 'maxFiles', 'maxSizeMb', 'mimeTypes', 'requireStage', 'allowedExtensions'],
  REFERENCE_VEHICLE: ['filterStatus'],
  REFERENCE_DRIVER: ['filterActive', 'piiScope'],
  REFERENCE_RECORD: ['entityType'],
  SECTION: [],
  COMPUTED: [],
};

/** Tipovi koji nose vrijednost u `formData` (SECTION je grupa, COMPUTED se računa). */
export const INPUT_FIELD_TYPES: readonly FieldType[] = FIELD_TYPES.filter(
  (type) => type !== 'SECTION' && type !== 'COMPUTED',
);

/** Tipovi kojima je obavezan `optionsSource`. */
export const FIELD_TYPES_WITH_OPTIONS: readonly FieldType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'];

/**
 * Mobilna podrška (§3 kolona "Mobilna kontrola", §11): svaki trenutni tip ima
 * mobilnu kontrolu, pa je `mobileCompatible=true`. Mehanizam postoji da bi se
 * objava blokirala za **novi** tip bez mobilne implementacije (docs/04 §8/7).
 */
export const MOBILE_COMPATIBLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(
  FIELD_TYPES.filter((type) => type !== 'SECTION'),
);

export function isMobileCompatible(type: FieldType): boolean {
  return MOBILE_COMPATIBLE_FIELD_TYPES.has(type);
}

/** Da li je vrijednost poznati tip polja (za runtime provjere iz JSON-a). */
export function isKnownFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

export function allowedValidationKeysFor(type: FieldType): readonly string[] {
  return ALLOWED_VALIDATION_KEYS[type];
}

/** ISO 4217 whitelist za polja `MONEY`/`CURRENCY` (docs/04 §3). */
export const FORM_CURRENCIES = ['BAM', 'EUR'] as const;
export type FormCurrency = (typeof FORM_CURRENCIES)[number];

/** Dozvoljene MIME tipove za upload drži definicija; ovo je siguran minimum. */
export const DEFAULT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Faza u kojoj je attachment obavezan (za `requireStage`). */
export { ATTACHMENT_STAGES };
export type { AttachmentStage };

/** Entiteti na koje `REFERENCE_RECORD` može pokazivati (zatvorena lista). */
export const REFERENCE_ENTITY_TYPES = FORM_SUBJECTS;
export type ReferenceEntityType = FormSubject;

/**
 * Whitelist unaprijed definisanih upita za `optionsSource.kind = 'QUERY'`
 * (docs/04 §3). **Nikad** slobodan SQL: svaki `queryId` je implementiran u
 * backendu kao fiksni, parametrizirani upit.
 */
export const ALLOWED_OPTION_QUERY_IDS = [
  'ACTIVE_VEHICLES',
  'ACTIVE_DRIVERS',
  'OPEN_TASK_TYPES',
  'WORKSHOPS',
  'TIRE_SETS_BY_VEHICLE',
] as const;
export type AllowedOptionQueryId = (typeof ALLOWED_OPTION_QUERY_IDS)[number];

/** Rezultati koje `COMPUTED` polje smije vratiti (docs/04 §6.3 "Tipovi"). */
export const COMPUTED_RESULT_TYPES = [
  'INTEGER',
  'DECIMAL',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'MONEY',
] as const;
export type ComputedResultType = (typeof COMPUTED_RESULT_TYPES)[number];

/** Jedinice koje se smiju prikazati uz izračun (informativno, ne validira se). */
export const KNOWN_COMPUTED_UNITS = [
  'km',
  'KM/min',
  'min',
  'h',
  'l',
  'l/100km',
  'KM',
  'KM/l',
  '%',
  'dana',
] as const;
