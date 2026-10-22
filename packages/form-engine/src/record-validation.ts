/**
 * Validacija zapisa prema verziji forme (docs/04-FORM_ENGINE.md §9, P11).
 *
 * Ulaz je **tačna verzija** kojom zapis nastaje (`formSchemaVersionId`) i sirove
 * `formValues`; izlaz su očišćene vrijednosti, serverski izračunata polja,
 * normalizovane kolone i lista grešaka. Pravila:
 *
 * - nikad tiha reinterpretacija: nepoznat ključ → `UNKNOWN_FIELD`, skriveno
 *   polje → `FIELD_NOT_VISIBLE`, pogrešan tip → `TYPE` (nema konverzije);
 * - `COMPUTED` računa **server**; klijentska vrijednost se odbacuje, a razlika
 *   ide u `warnings` (`COMPUTED_MISMATCH`) — audit WARN, ne blokada;
 * - nova zapis traži `PUBLISHED` verziju; `RETIRED` je dozvoljen samo pri
 *   uređivanju postojećeg zapisa (`isNew: false`), `DRAFT` nikad;
 * - `SECTION` ne nosi vrijednost, pa se u `formValues` odbija;
 * - normalizacija ide kroz `definition.normalizedName` (§7) i to samo kad
 *   validacija prođe.
 */
import type { FieldDefinition, FormDefinition, SectionDefinition } from './definition.schema.js';
import { computedFields, findField, inputFields } from './definition.schema.js';
import type { FieldType } from './field-types.js';
import {
  FIELD_VALUE_KIND,
  FORM_CURRENCIES,
  isMobileCompatible,
  REFERENCE_ENTITY_TYPES,
} from './field-types.js';
import { isFieldVisible } from './conditions.js';
import { evaluateExpression } from './expression/evaluator.js';
import type { ExpressionValue } from './expression/functions.js';
import { parseIsoDate, roundTo } from './expression/functions.js';

/** Kôd greške po polju (`details.fieldErrors[].code` u API odgovoru). */
export const RECORD_ERROR_CODES = [
  'UNKNOWN_FIELD',
  'FIELD_NOT_VISIBLE',
  'REQUIRED',
  'TYPE',
  'MIN',
  'MAX',
  'MIN_LENGTH',
  'MAX_LENGTH',
  'PATTERN',
  'PRECISION',
  'STEP',
  'OPTION',
  'MIN_SELECT',
  'MAX_SELECT',
  'DUPLICATE_OPTION',
  'MIN_FILES',
  'MAX_FILES',
  'ATTACHMENT_UNKNOWN',
  'ATTACHMENT_MIME',
  'ATTACHMENT_SIZE',
  'NOT_IN_FUTURE',
  'NOT_IN_PAST',
  'REQUIRED_TRUE',
  'CURRENCY',
  'COMPUTED_NOT_EVALUABLE',
] as const;
export type RecordErrorCode = (typeof RECORD_ERROR_CODES)[number];

/** Greška koja blokira cijeli zapis (prije validacije polja). */
export const RECORD_VERSION_ERRORS = ['FORM_VERSION_NOT_PUBLISHED', 'FORM_VERSION_INVALID'] as const;
export type RecordVersionError = (typeof RECORD_VERSION_ERRORS)[number];

export interface RecordFieldError {
  readonly key: string;
  readonly code: RecordErrorCode;
  readonly message: string;
}

export const RECORD_WARNING_CODES = ['COMPUTED_MISMATCH', 'COMPUTED_IGNORED'] as const;
export type RecordWarningCode = (typeof RECORD_WARNING_CODES)[number];

export interface RecordWarning {
  readonly key: string;
  readonly code: RecordWarningCode;
  readonly message: string;
}

export type FormSchemaVersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface RecordVersionRef {
  readonly id: string;
  readonly version: number;
  readonly status: FormSchemaVersionStatus;
  readonly definition: FormDefinition;
}

/** Metapodaci priloga poznati serveru (mime i veličina se provjeravaju pri uploadu). */
export interface AttachmentFacts {
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface ValidateRecordOptions {
  readonly version: RecordVersionRef;
  readonly values: unknown;
  /** `true` (default) = novi zapis → verzija mora biti `PUBLISHED`. */
  readonly isNew?: boolean;
  /** Serverski datum (`YYYY-MM-DD`) za `today()` i `notInFuture`/`notInPast`. */
  readonly today?: string;
  /** Poznati prilozi (id → mime/veličina); bez mape se prisustvo ne provjerava. */
  readonly attachments?: ReadonlyMap<string, AttachmentFacts>;
}

export interface RecordValidationResult {
  readonly ok: boolean;
  /** Postavljeno kad cijeli zapis ne prolazi (pogrešna verzija / oblik unosa). */
  readonly versionError: RecordVersionError | null;
  readonly errors: readonly RecordFieldError[];
  readonly warnings: readonly RecordWarning[];
  /** Očišćene vrijednosti: trim, bez skrivenih/nepoznatih polja, s izračunatim. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Vrijednosti `COMPUTED` polja (uvijek serverski izračunate). */
  readonly computed: Readonly<Record<string, unknown>>;
  /** Kolone entiteta iz `normalizedName` (prazno kad validacija nije prošla). */
  readonly normalized: Readonly<Record<string, unknown>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/** Gornja granica ulaza koji se pušta kroz JavaScript regex. */
export const MAX_PATTERN_INPUT_LENGTH = 4096;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/u;

interface Ctx {
  readonly values: Record<string, unknown>;
  readonly errors: RecordFieldError[];
  readonly warnings: RecordWarning[];
}

function fail(ctx: Ctx, key: string, code: RecordErrorCode, message: string): void {
  ctx.errors.push({ key, code, message });
}

function hasErrorFor(ctx: Ctx, key: string): boolean {
  return ctx.errors.some((error) => error.key === key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Prazno = `undefined`/`null`/prazan tekst/prazan niz (`0` i `false` nisu prazni). */
export function isEmptyRecordValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function ruleNumber(field: FieldDefinition, key: string): number | undefined {
  const value = field.validation?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function ruleString(field: FieldDefinition, key: string): string | undefined {
  const value = field.validation?.[key];
  return typeof value === 'string' ? value : undefined;
}

function ruleBoolean(field: FieldDefinition, key: string): boolean {
  return field.validation?.[key] === true;
}

function ruleStringArray(field: FieldDefinition, key: string): string[] | undefined {
  const value = field.validation?.[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function staticOptionValues(field: FieldDefinition): Set<string> | null {
  const source = field.optionsSource;
  if (!source || source.kind !== 'STATIC') return null;
  return new Set(source.items.map((item) => item.value));
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [mantissa, exponent] = value.toString().split('e');
  const fraction = mantissa?.split('.')[1]?.length ?? 0;
  return fraction + (exponent ? Math.max(0, -Number(exponent)) : 0);
}

/** `MONEY` vrijednost: `{ amount, currency }`, `amount` u feninzima (cijeli broj). */
export function parseMoneyValue(value: unknown): { amount: number; currency: string } | null {
  if (!isPlainObject(value)) return null;
  const { amount, currency } = value;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return null;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) return null;
  return { amount, currency };
}

// -----------------------------------------------------------------------------
//  Provjere po tipu polja (§9 tačka 4)
// -----------------------------------------------------------------------------

function checkText(ctx: Ctx, field: FieldDefinition, key: string, value: string): string {
  const trimmed = field.validation?.['trim'] === false ? value : value.trim();
  const minLength = ruleNumber(field, 'minLength');
  const maxLength = ruleNumber(field, 'maxLength');
  if (minLength !== undefined && trimmed.length < minLength) {
    fail(ctx, key, 'MIN_LENGTH', `Najmanje ${minLength} znakova (uneseno ${trimmed.length}).`);
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    fail(ctx, key, 'MAX_LENGTH', `Najviše ${maxLength} znakova (uneseno ${trimmed.length}).`);
  }
  const pattern = ruleString(field, 'pattern');
  if (pattern && trimmed.length > MAX_PATTERN_INPUT_LENGTH) {
    fail(
      ctx,
      key,
      'MAX_LENGTH',
      `Vrijednost s regex provjerom može imati najviše ${MAX_PATTERN_INPUT_LENGTH} znakova.`,
    );
    return trimmed;
  }
  if (pattern) {
    try {
      if (!new RegExp(pattern, 'u').test(trimmed)) {
        fail(ctx, key, 'PATTERN', 'Vrijednost ne odgovara propisanom formatu.');
      }
    } catch {
      // Neispravan uzorak je greška definicije (hvata se pri objavi), ne unosa.
    }
  }
  return trimmed;
}

function checkNumber(ctx: Ctx, field: FieldDefinition, key: string, value: number): void {
  const min = ruleNumber(field, 'min');
  const max = ruleNumber(field, 'max');
  if (min !== undefined && value < min) fail(ctx, key, 'MIN', `Najmanja dozvoljena vrijednost je ${min}.`);
  if (max !== undefined && value > max) fail(ctx, key, 'MAX', `Najveća dozvoljena vrijednost je ${max}.`);
  const step = ruleNumber(field, 'step');
  if (step !== undefined && step > 0) {
    const steps = (value - (min ?? 0)) / step;
    if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-9) {
      fail(ctx, key, 'STEP', `Vrijednost mora biti u koracima od ${step}.`);
    }
  }
}

function checkMoney(ctx: Ctx, field: FieldDefinition, key: string, value: unknown): unknown {
  const money = parseMoneyValue(value);
  if (!money) {
    fail(ctx, key, 'TYPE', 'Novčani iznos mora biti { amount (feninzi, cijeli broj), currency }.');
    return undefined;
  }
  const currency = ruleString(field, 'currency');
  if (!FORM_CURRENCIES.some((allowedCurrency) => allowedCurrency === money.currency)) {
    fail(ctx, key, 'CURRENCY', `Dozvoljene valute: ${FORM_CURRENCIES.join(', ')}.`);
  } else if (currency && money.currency !== currency) {
    fail(ctx, key, 'CURRENCY', `Valuta mora biti ${currency}.`);
  }
  // `min`/`max` su u KM (glavnoj jedinici), a `amount` je u feninzima.
  const major = money.amount / 100;
  const min = ruleNumber(field, 'min');
  const max = ruleNumber(field, 'max');
  if (min !== undefined && major < min) fail(ctx, key, 'MIN', `Najmanji dozvoljeni iznos je ${min} KM.`);
  if (max !== undefined && major > max) fail(ctx, key, 'MAX', `Najveći dozvoljeni iznos je ${max} KM.`);
  return { amount: money.amount, currency: money.currency };
}

function checkDateLike(
  ctx: Ctx,
  field: FieldDefinition,
  key: string,
  value: unknown,
  kind: 'date' | 'datetime',
  today: string | undefined,
): unknown {
  if (typeof value !== 'string') {
    fail(ctx, key, 'TYPE', 'Datum mora biti tekst u ISO formatu.');
    return undefined;
  }
  if (kind === 'date') {
    if (!DATE_PATTERN.test(value) || !parseIsoDate(value)) {
      fail(ctx, key, 'TYPE', 'Datum mora biti ISO oblika YYYY-MM-DD.');
      return undefined;
    }
  } else if (!DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    fail(ctx, key, 'TYPE', 'Datum i vrijeme moraju biti ISO 8601 s vremenskom zonom (Z ili ±hh:mm).');
    return undefined;
  }

  const iso = kind === 'date' ? value : new Date(value).toISOString();
  const day = iso.slice(0, 10);
  const minDate = ruleString(field, 'minDate')?.slice(0, 10);
  const maxDate = ruleString(field, 'maxDate')?.slice(0, 10);
  if (minDate && day < minDate) fail(ctx, key, 'MIN', `Najraniji datum je ${minDate}.`);
  if (maxDate && day > maxDate) fail(ctx, key, 'MAX', `Najkasniji datum je ${maxDate}.`);
  if (today) {
    if (ruleBoolean(field, 'notInFuture') && day > today) {
      fail(ctx, key, 'NOT_IN_FUTURE', 'Datum ne smije biti u budućnosti.');
    }
    if (ruleBoolean(field, 'notInPast') && day < today) {
      fail(ctx, key, 'NOT_IN_PAST', 'Datum ne smije biti u prošlosti.');
    }
  }
  return iso;
}

function checkAttachments(
  ctx: Ctx,
  field: FieldDefinition,
  key: string,
  value: unknown,
  attachments: ReadonlyMap<string, AttachmentFacts> | undefined,
): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !UUID_PATTERN.test(item))) {
    fail(ctx, key, 'TYPE', 'Prilozi moraju biti niz UUID-ova.');
    return undefined;
  }
  const ids = value as string[];
  const minFiles = ruleNumber(field, 'minFiles');
  const maxFiles = ruleNumber(field, 'maxFiles');
  if (minFiles !== undefined && ids.length < minFiles)
    fail(ctx, key, 'MIN_FILES', `Najmanje ${minFiles} prilog(a).`);
  if (maxFiles !== undefined && ids.length > maxFiles)
    fail(ctx, key, 'MAX_FILES', `Najviše ${maxFiles} prilog(a).`);

  if (!attachments) return ids;
  const mimeTypes = ruleStringArray(field, 'mimeTypes');
  const maxSizeMb = ruleNumber(field, 'maxSizeMb');
  for (const id of ids) {
    const facts = attachments.get(id);
    if (!facts) {
      fail(ctx, key, 'ATTACHMENT_UNKNOWN', 'Prilog ne postoji ili ne pripada ovom zapisu.');
      continue;
    }
    if (mimeTypes && mimeTypes.length > 0 && !mimeTypes.includes(facts.mimeType)) {
      fail(ctx, key, 'ATTACHMENT_MIME', `Dozvoljeni formati: ${mimeTypes.join(', ')}.`);
    }
    if (maxSizeMb !== undefined && facts.sizeBytes > maxSizeMb * 1024 * 1024) {
      fail(ctx, key, 'ATTACHMENT_SIZE', `Najveća veličina priloga je ${maxSizeMb} MB.`);
    }
  }
  return ids;
}

function checkFieldValue(
  ctx: Ctx,
  field: FieldDefinition,
  value: unknown,
  options: ValidateRecordOptions,
): unknown {
  const key = field.key;
  const kind = FIELD_VALUE_KIND[field.type as FieldType];

  switch (kind) {
    case 'string': {
      if (typeof value !== 'string') {
        fail(ctx, key, 'TYPE', 'Vrijednost mora biti tekst.');
        return undefined;
      }
      const text = checkText(ctx, field, key, value);
      const allowed = staticOptionValues(field);
      if (allowed && !allowed.has(text)) {
        fail(ctx, key, 'OPTION', 'Vrijednost nije među ponuđenim opcijama.');
      }
      return text;
    }

    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        fail(ctx, key, 'TYPE', 'Vrijednost mora biti cijeli broj.');
        return undefined;
      }
      checkNumber(ctx, field, key, value);
      return value;
    }

    case 'decimal': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(ctx, key, 'TYPE', 'Vrijednost mora biti broj.');
        return undefined;
      }
      checkNumber(ctx, field, key, value);
      const precision = ruleNumber(field, 'precision');
      if (precision !== undefined && decimalPlaces(value) > precision) {
        fail(ctx, key, 'PRECISION', `Najviše ${precision} decimalna mjesta.`);
      }
      return value;
    }

    case 'money':
      return checkMoney(ctx, field, key, value);

    case 'currency': {
      if (typeof value !== 'string') {
        fail(ctx, key, 'TYPE', 'Valuta mora biti tekstualni kod.');
        return undefined;
      }
      const configured = ruleStringArray(field, 'allowedCurrencies');
      const allowed = configured && configured.length > 0 ? configured : [...FORM_CURRENCIES];
      if (!FORM_CURRENCIES.some((currency) => currency === value) || !allowed.includes(value)) {
        fail(ctx, key, 'CURRENCY', `Dozvoljene valute: ${allowed.join(', ')}.`);
      }
      return value;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        fail(ctx, key, 'TYPE', 'Vrijednost mora biti true ili false.');
        return undefined;
      }
      if (ruleBoolean(field, 'requiredTrue') && !value) {
        fail(ctx, key, 'REQUIRED_TRUE', 'Polje mora biti potvrđeno.');
      }
      return value;
    }

    case 'date':
      return checkDateLike(ctx, field, key, value, 'date', options.today);

    case 'datetime':
      return checkDateLike(ctx, field, key, value, 'datetime', options.today);

    case 'stringArray': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        fail(ctx, key, 'TYPE', 'Vrijednost mora biti niz tekstova.');
        return undefined;
      }
      const items = value as string[];
      if (new Set(items).size !== items.length) {
        fail(ctx, key, 'DUPLICATE_OPTION', 'Ista opcija je odabrana više puta.');
      }
      const minSelect = ruleNumber(field, 'minSelect');
      const maxSelect = ruleNumber(field, 'maxSelect');
      if (minSelect !== undefined && items.length < minSelect) {
        fail(ctx, key, 'MIN_SELECT', `Odaberi najmanje ${minSelect}.`);
      }
      if (maxSelect !== undefined && items.length > maxSelect) {
        fail(ctx, key, 'MAX_SELECT', `Odaberi najviše ${maxSelect}.`);
      }
      const allowed = staticOptionValues(field);
      if (allowed) {
        for (const item of items) {
          if (!allowed.has(item)) fail(ctx, key, 'OPTION', `Opcija "${item}" nije dozvoljena.`);
        }
      }
      return items;
    }

    case 'attachmentIds':
      return checkAttachments(ctx, field, key, value, options.attachments);

    case 'uuid': {
      if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        fail(ctx, key, 'TYPE', 'Referenca mora biti UUID.');
        return undefined;
      }
      return value;
    }

    case 'recordReference': {
      const entityType = isPlainObject(value) ? value['entityType'] : undefined;
      const entityId = isPlainObject(value) ? value['entityId'] : undefined;
      const expectedType = ruleString(field, 'entityType');
      if (
        typeof entityType !== 'string' ||
        !REFERENCE_ENTITY_TYPES.some((allowedType) => allowedType === entityType) ||
        (expectedType !== undefined && entityType !== expectedType) ||
        typeof entityId !== 'string' ||
        !UUID_PATTERN.test(entityId)
      ) {
        fail(
          ctx,
          key,
          'TYPE',
          `Referenca mora biti { entityType: ${expectedType ?? 'dozvoljeni tip'}, entityId: UUID }.`,
        );
        return undefined;
      }
      return { entityType, entityId };
    }

    case 'none':
      fail(ctx, key, 'TYPE', 'Ovo polje ne nosi vrijednost.');
      return undefined;

    case 'computed':
      // Klijentska vrijednost se odbacuje — računa se na serveru.
      return undefined;

    default:
      fail(ctx, key, 'TYPE', 'Nepodržan tip polja.');
      return undefined;
  }
}

// -----------------------------------------------------------------------------
//  Normalizacija (§7)
// -----------------------------------------------------------------------------

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'da', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'ne', 'no'].includes(normalized)) return false;
  }
  return null;
}

/**
 * Primjenjuje `normalizedName` na očišćene vrijednosti i vraća mapu
 * `kolona → vrijednost`. Nemoguća transformacija baca grešku (definicija je
 * provjerena pri objavi, pa je ovo odbrana od ručnog kvara u bazi).
 */
export function normalizeRecordValues(
  definition: FormDefinition,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const mapping of definition.normalizedName ?? []) {
    if (mapping.column === null || mapping.transform === null) continue;
    const raw = values[mapping.fieldKey];
    if (raw === undefined || raw === null) continue;

    switch (mapping.transform) {
      case 'TO_INT': {
        const parsed = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(parsed)) {
          throw new Error(`Polje ${mapping.fieldKey} se ne može pretvoriti u cijeli broj.`);
        }
        normalized[mapping.column] = parsed;
        break;
      }
      case 'TO_DECIMAL': {
        const parsed = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Polje ${mapping.fieldKey} se ne može pretvoriti u broj.`);
        }
        normalized[mapping.column] = parsed;
        break;
      }
      case 'TO_DATE':
      case 'TO_DATETIME': {
        if (typeof raw !== 'string') {
          throw new Error(`Polje ${mapping.fieldKey} se ne može pretvoriti u datum.`);
        }
        if (mapping.transform === 'TO_DATE' && DATE_PATTERN.test(raw)) {
          normalized[mapping.column] = raw;
          break;
        }
        const parsed = Date.parse(raw);
        if (Number.isNaN(parsed)) {
          throw new Error(`Polje ${mapping.fieldKey} se ne može pretvoriti u datum.`);
        }
        normalized[mapping.column] = new Date(parsed).toISOString();
        break;
      }
      case 'TO_BOOL': {
        const parsed = toBoolean(raw);
        if (parsed === null) {
          throw new Error(`Polje ${mapping.fieldKey} se ne može pretvoriti u boolean.`);
        }
        normalized[mapping.column] = parsed;
        break;
      }
      case 'TO_TEXT': {
        normalized[mapping.column] = typeof raw === 'string' ? raw : String(raw);
        break;
      }
      case 'MONEY_TO_FENINZI': {
        const money = parseMoneyValue(raw);
        if (!money) throw new Error(`Polje ${mapping.fieldKey} nije novčani iznos.`);
        normalized[mapping.column] = money.amount;
        break;
      }
      case 'FENINZI_TO_MONEY': {
        const amount = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(amount)) {
          throw new Error(`Polje ${mapping.fieldKey} nije iznos u feninzima.`);
        }
        normalized[mapping.column] = { amount, currency: 'BAM' };
        break;
      }
      default:
        throw new Error(`Nepoznata transformacija za ${mapping.fieldKey}.`);
    }
  }
  return normalized;
}

// -----------------------------------------------------------------------------
//  Izračunata polja (§6.4, §9 tačka 5)
// -----------------------------------------------------------------------------

function coerceComputedValue(
  value: ExpressionValue,
  resultType: string,
  precision: number | undefined,
): ExpressionValue {
  if (value === null) return null;
  switch (resultType) {
    case 'INTEGER':
      return typeof value === 'number' ? Math.round(value) : value;
    case 'DECIMAL':
      return typeof value === 'number' ? roundTo(value, precision ?? 2) : value;
    case 'TEXT':
      return typeof value === 'string' ? value : String(value);
    case 'BOOLEAN':
      return typeof value === 'boolean' ? value : Boolean(value);
    case 'DATE':
      return typeof value === 'string' ? value.slice(0, 10) : value;
    default:
      return value;
  }
}

// -----------------------------------------------------------------------------
//  Vidljivost i ulazna validacija
// -----------------------------------------------------------------------------

function sectionOf(definition: FormDefinition, key: string): SectionDefinition | undefined {
  return definition.sections.find((section) => section.fields.some((candidate) => candidate.key === key));
}

/**
 * Pogled na unos za evaluaciju uslova: tekstovi su trimovani, pa `" FULL "` ne
 * mijenja vidljivost polja (isto kao što `checkText` trimuje vrijednost).
 */
function conditionView(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      view[key] = value.trim();
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      view[key] = (value as string[]).map((item) => item.trim());
    } else {
      view[key] = value;
    }
  }
  return view;
}

function isVisible(
  definition: FormDefinition,
  field: FieldDefinition,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const section = sectionOf(definition, field.key);
  if (!section) return false;
  return isFieldVisible([section.visibleWhen, field.visibleWhen], values);
}

function resolveVersionError(options: ValidateRecordOptions, isNew: boolean): RecordVersionError | null {
  const status = options.version.status;
  if (status === 'PUBLISHED') return null;
  if (status === 'RETIRED' && !isNew) return null;
  return 'FORM_VERSION_NOT_PUBLISHED';
}

function invalidResult(
  versionError: RecordVersionError,
  errors: readonly RecordFieldError[] = [],
): RecordValidationResult {
  return {
    ok: false,
    versionError,
    errors,
    warnings: [],
    values: {},
    computed: {},
    normalized: {},
  };
}

/**
 * Validira `formValues` prema verziji forme.
 *
 * Za korisnički unos nikad ne baca — sve greške su u `errors`. Baca samo kod
 * nemoguće normalizacije (neispravna definicija u bazi), što API mapira na
 * `422 NORMALIZATION_MISMATCH`.
 */
export function validateRecord(options: ValidateRecordOptions): RecordValidationResult {
  const isNew = options.isNew ?? true;
  const versionError = resolveVersionError(options, isNew);
  if (versionError) return invalidResult(versionError);

  const raw = options.values ?? {};
  if (!isPlainObject(raw)) {
    return invalidResult('FORM_VERSION_INVALID', [
      { key: '$', code: 'TYPE', message: '`formValues` mora biti objekat.' },
    ]);
  }

  const definition = options.version.definition;
  const ctx: Ctx = { values: {}, errors: [], warnings: [] };
  const view = conditionView(raw);

  // 1) Ključevi koji ne pripadaju unosu (nepoznato / SECTION / COMPUTED).
  for (const key of Object.keys(raw)) {
    const found = findField(definition, key)?.field;
    if (!found) {
      fail(ctx, key, 'UNKNOWN_FIELD', 'Polje ne postoji u ovoj verziji forme.');
      continue;
    }
    if (found.type === 'COMPUTED') continue; // server računa; klijentska vrijednost se odbacuje
    if (found.type === 'SECTION') {
      fail(ctx, key, 'TYPE', 'Sekcija ne nosi vrijednost.');
      continue;
    }
    if (!isVisible(definition, found, view) && !isEmptyRecordValue(raw[key])) {
      fail(ctx, key, 'FIELD_NOT_VISIBLE', 'Polje je skriveno za odabrane vrijednosti.');
    }
  }

  // 2) Obavezna polja i tipske provjere vidljivih polja.
  for (const { field } of inputFields(definition)) {
    if (!isVisible(definition, field, view)) continue;
    const value = raw[field.key];

    if (isEmptyRecordValue(value)) {
      if (field.required) fail(ctx, field.key, 'REQUIRED', 'Polje je obavezno.');
      continue;
    }

    const checked = checkFieldValue(ctx, field, value, options);
    if (checked === undefined) continue;
    // Vrijednost se prihvata samo ako polje nije dobilo nijednu grešku.
    if (!hasErrorFor(ctx, field.key)) ctx.values[field.key] = checked;
  }

  // 3) Izračunata polja — uvijek na serveru, i to nad prihvaćenim unosom.
  const computed: Record<string, unknown> = {};
  // Izračun ima smisla samo nad ispravnim unosom — inače bi greška izraza
  // maskirala pravu grešku polja (`COMPUTED_NOT_EVALUABLE` uz `TYPE`).
  for (const { field } of ctx.errors.length === 0 ? computedFields(definition) : []) {
    if (!isVisible(definition, field, view)) continue;
    const expression = field.computed?.expression;
    if (!expression) continue;

    const clientValue = raw[field.key];
    try {
      const result = evaluateExpression(expression, {
        values: { ...ctx.values, ...computed },
        today: options.today,
      });
      const value = coerceComputedValue(
        result.value,
        field.computed?.resultType ?? 'TEXT',
        field.computed?.precision,
      );
      computed[field.key] = value;
      if (field.storeInFormData !== false) ctx.values[field.key] = value;
      if (clientValue !== undefined && JSON.stringify(clientValue) !== JSON.stringify(value)) {
        ctx.warnings.push({
          key: field.key,
          code: 'COMPUTED_MISMATCH',
          message: 'Poslana vrijednost izračunatog polja je odbačena — server je izračunao drugu.',
        });
      }
    } catch (error) {
      computed[field.key] = null;
      fail(
        ctx,
        field.key,
        'COMPUTED_NOT_EVALUABLE',
        error instanceof Error ? error.message : 'Izračunato polje se ne može izračunati.',
      );
    }
  }

  const ok = ctx.errors.length === 0;
  return {
    ok,
    versionError: null,
    errors: ctx.errors,
    warnings: ctx.warnings,
    values: ctx.values,
    computed,
    normalized: ok ? normalizeRecordValues(definition, ctx.values) : {},
  };
}

/**
 * Tipovi polja bez mobilne kontrole (§11) — objava je blokirana bez
 * `allowWebOnly`. Trenutno svi tipovi imaju mobilnu kontrolu, pa je rezultat
 * prazan; funkcija postoji da novi tip ne prođe tiho.
 */
export function webOnlyFieldTypes(definition: FormDefinition): FieldType[] {
  const types = new Set<FieldType>();
  for (const { field } of [...inputFields(definition), ...computedFields(definition)]) {
    if (!isMobileCompatible(field.type)) types.add(field.type);
  }
  return [...types];
}
