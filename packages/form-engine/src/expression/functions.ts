/**
 * Whitelist funkcija za sigurne izraze (docs/04-FORM_ENGINE.md §6.2).
 *
 * Zatvorena lista: funkcija koja nije ovdje **ne postoji** za parser/evaluator,
 * pa nema načina da se iz definicije dozove bilo šta iz Node runtime-a.
 *
 * Vrijednosti su `number | string | boolean | null`; datumi su ISO stringovi
 * (`YYYY-MM-DD` ili puni ISO 8601), što ih čini poredivim leksikografski.
 */
import { ExpressionError, type ValueType } from './parser.js';

/** Vrijednost koju funkcija prima/vraća. */
export type ExpressionValue = number | string | boolean | null;

/** Opis parametra: tip i da li je opcion. */
export interface ParameterSpec {
  readonly type: ValueType;
  readonly optional?: boolean;
  readonly label: string;
}

/** Definicija jedne whitelist funkcije. */
export interface FunctionSpec {
  readonly name: string;
  readonly returns: ValueType;
  readonly params: readonly ParameterSpec[];
  /** Da li prima varijabilan broj argumenata (npr. `min`/`max`/`concat`). */
  readonly variadic?: { readonly min: number; readonly type: ValueType };
  readonly summary: string;
  readonly call: (args: readonly ExpressionValue[]) => ExpressionValue;
}

const number = (value: ExpressionValue): number | null => {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return null;
};

/** Pretvara vrijednost u broj ili baca `TYPE_ERROR` (za funkcije koje ga traže). */
function requireNumber(value: ExpressionValue, fn: string, label: string): number {
  if (value === null) {
    throw new ExpressionError('NOT_EVALUABLE', `${fn}(): parametar "${label}" je prazan (null).`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExpressionError('TYPE_ERROR', `${fn}(): parametar "${label}" mora biti broj.`);
  }
  return value;
}

function requireString(value: ExpressionValue, fn: string, label: string): string {
  if (value === null) {
    throw new ExpressionError('NOT_EVALUABLE', `${fn}(): parametar "${label}" je prazan (null).`);
  }
  if (typeof value !== 'string') {
    throw new ExpressionError('TYPE_ERROR', `${fn}(): parametar "${label}" mora biti tekst.`);
  }
  return value;
}

/** Parsira ISO datum (UTC). Vraća `null` za neispravan format. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/u.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
  );
  if (Number.isNaN(date.getTime())) return null;
  // Provjera da datum postoji (npr. 2026-02-31 → 3. mart se odbija).
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

function requireDate(value: ExpressionValue, fn: string, label: string): Date {
  const text = requireString(value, fn, label);
  const date = parseIsoDate(text);
  if (!date) {
    throw new ExpressionError('INVALID_ARGUMENT', `${fn}(): "${label}" nije ISO datum (YYYY-MM-DD).`);
  }
  return date;
}

const DAY_MS = 86_400_000;

/** Formatira datum kao `YYYY-MM-DD` (UTC) — jedini format koji funkcije vraćaju. */
export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Skraćuje na `precision` decimala (bez negativnog pomaka kao kod `toFixed`). */
export function roundTo(value: number, precision = 0): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

function clampPrecision(value: ExpressionValue | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ExpressionError('INVALID_ARGUMENT', 'round(): preciznost mora biti cijeli broj.');
  }
  if (value < 0 || value > 10) {
    throw new ExpressionError('INVALID_ARGUMENT', 'round(): preciznost mora biti 0–10.');
  }
  return value;
}

/** Numeričke virjednosti iz varijabilnog spiska argumenata. */
function numbers(args: readonly ExpressionValue[], fn: string): number[] {
  return args.map((arg, index) => requireNumber(arg, fn, `arg${index + 1}`));
}

/** Sva imena funkcija — koristi se i za `FunctionRefs` i za dokumentaciju u UI-u. */
export const FUNCTION_SPECS: readonly FunctionSpec[] = [
  // --- Matematičke ---
  {
    name: 'round',
    returns: 'number',
    params: [
      { type: 'number', label: 'x' },
      { type: 'number', label: 'precision', optional: true },
    ],
    summary: 'Zaokružuje na zadati broj decimala (default 0).',
    call: (args) => roundTo(requireNumber(args[0] ?? null, 'round', 'x'), clampPrecision(args[1])),
  },
  {
    name: 'floor',
    returns: 'number',
    params: [{ type: 'number', label: 'x' }],
    summary: 'Najmanji cijeli broj ≤ x.',
    call: (args) => Math.floor(requireNumber(args[0] ?? null, 'floor', 'x')),
  },
  {
    name: 'ceil',
    returns: 'number',
    params: [{ type: 'number', label: 'x' }],
    summary: 'Najveći cijeli broj ≥ x.',
    call: (args) => Math.ceil(requireNumber(args[0] ?? null, 'ceil', 'x')),
  },
  {
    name: 'abs',
    returns: 'number',
    params: [{ type: 'number', label: 'x' }],
    summary: 'Apsolutna vrijednost.',
    call: (args) => Math.abs(requireNumber(args[0] ?? null, 'abs', 'x')),
  },
  {
    name: 'min',
    returns: 'number',
    params: [],
    variadic: { min: 1, type: 'number' },
    summary: 'Najmanja vrijednost u listi.',
    call: (args) => Math.min(...numbers(args, 'min')),
  },
  {
    name: 'max',
    returns: 'number',
    params: [],
    variadic: { min: 1, type: 'number' },
    summary: 'Najveća vrijednost u listi.',
    call: (args) => Math.max(...numbers(args, 'max')),
  },
  {
    name: 'sum',
    returns: 'number',
    params: [],
    variadic: { min: 1, type: 'number' },
    summary: 'Zbir svih vrijednosti.',
    call: (args) => numbers(args, 'sum').reduce((total, current) => total + current, 0),
  },
  {
    name: 'avg',
    returns: 'number',
    params: [],
    variadic: { min: 1, type: 'number' },
    summary: 'Prosjek svih vrijednosti.',
    call: (args) => {
      const values = numbers(args, 'avg');
      return values.reduce((total, current) => total + current, 0) / values.length;
    },
  },
  {
    name: 'clamp',
    returns: 'number',
    params: [
      { type: 'number', label: 'x' },
      { type: 'number', label: 'min' },
      { type: 'number', label: 'max' },
    ],
    summary: 'Ograničava x na interval [min, max].',
    call: (args) => {
      const value = requireNumber(args[0] ?? null, 'clamp', 'x');
      const low = requireNumber(args[1] ?? null, 'clamp', 'min');
      const high = requireNumber(args[2] ?? null, 'clamp', 'max');
      if (low > high) {
        throw new ExpressionError('INVALID_ARGUMENT', 'clamp(): min je veći od max.');
      }
      return Math.min(Math.max(value, low), high);
    },
  },

  // --- Logičke ---
  {
    name: 'if',
    returns: 'string',
    params: [
      { type: 'boolean', label: 'condition' },
      { type: 'string', label: 'whenTrue' },
      { type: 'string', label: 'whenFalse' },
    ],
    summary:
      'Vraća `whenTrue` ako je uslov istinit, inače `whenFalse` (vrijednosti mogu biti bilo kojeg tipa).',
    call: (args) => {
      const condition = args[0] ?? null;
      if (typeof condition !== 'boolean') {
        throw new ExpressionError('TYPE_ERROR', 'if(): prvi argument mora biti uslov (boolean).');
      }
      return condition ? (args[1] ?? null) : (args[2] ?? null);
    },
  },
  {
    name: 'and',
    returns: 'boolean',
    params: [],
    variadic: { min: 2, type: 'boolean' },
    summary: 'Logičko I nad svim argumentima.',
    call: (args) => args.every((arg) => arg === true),
  },
  {
    name: 'or',
    returns: 'boolean',
    params: [],
    variadic: { min: 2, type: 'boolean' },
    summary: 'Logičko ILI nad svim argumentima.',
    call: (args) => args.some((arg) => arg === true),
  },
  {
    name: 'not',
    returns: 'boolean',
    params: [{ type: 'boolean', label: 'x' }],
    summary: 'Logička negacija.',
    call: (args) => {
      const value = args[0] ?? null;
      if (typeof value !== 'boolean') {
        throw new ExpressionError('TYPE_ERROR', 'not(): argument mora biti boolean.');
      }
      return !value;
    },
  },
  {
    name: 'coalesce',
    returns: 'string',
    params: [],
    variadic: { min: 1, type: 'string' },
    summary: 'Prva vrijednost koja nije null.',
    call: (args) => args.find((arg) => arg !== null) ?? null,
  },

  // --- Datumske ---
  {
    name: 'daysBetween',
    returns: 'number',
    params: [
      { type: 'date', label: 'from' },
      { type: 'date', label: 'to' },
    ],
    summary: 'Broj dana između dva datuma (`to − from`; pozitivno ako je `to` kasnije).',
    call: (args) => {
      const from = requireDate(args[0] ?? null, 'daysBetween', 'from');
      const to = requireDate(args[1] ?? null, 'daysBetween', 'to');
      return Math.round((to.getTime() - from.getTime()) / DAY_MS);
    },
  },
  {
    name: 'monthsBetween',
    returns: 'number',
    params: [
      { type: 'date', label: 'from' },
      { type: 'date', label: 'to' },
    ],
    summary: 'Broj kalendarskih mjeseci između dva datuma (`to − from`).',
    call: (args) => {
      const from = requireDate(args[0] ?? null, 'monthsBetween', 'from');
      const to = requireDate(args[1] ?? null, 'monthsBetween', 'to');
      return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    },
  },
  {
    name: 'year',
    returns: 'number',
    params: [{ type: 'date', label: 'date' }],
    summary: 'Godina datuma.',
    call: (args) => requireDate(args[0] ?? null, 'year', 'date').getUTCFullYear(),
  },
  {
    name: 'month',
    returns: 'number',
    params: [{ type: 'date', label: 'date' }],
    summary: 'Mjesec datuma (1–12).',
    call: (args) => requireDate(args[0] ?? null, 'month', 'date').getUTCMonth() + 1,
  },
  {
    name: 'day',
    returns: 'number',
    params: [{ type: 'date', label: 'date' }],
    summary: 'Dan u mjesecu (1–31).',
    call: (args) => requireDate(args[0] ?? null, 'day', 'date').getUTCDate(),
  },
  {
    name: 'addDays',
    returns: 'date',
    params: [
      { type: 'date', label: 'date' },
      { type: 'number', label: 'days' },
    ],
    summary: 'Dodaje (ili oduzima) dane datumu; vraća `YYYY-MM-DD`.',
    call: (args) => {
      const date = requireDate(args[0] ?? null, 'addDays', 'date');
      const days = requireNumber(args[1] ?? null, 'addDays', 'days');
      return formatIsoDate(new Date(date.getTime() + Math.trunc(days) * DAY_MS));
    },
  },
  {
    name: 'today',
    returns: 'date',
    params: [],
    summary:
      'Današnji datum (server, UTC). Jedina nedeterministička funkcija — rezultat se snapshot-uje u formData.',
    call: () => {
      throw new ExpressionError(
        'NOT_EVALUABLE',
        'today() se izvršava samo kroz evaluator (nema pristup vremenu u registru funkcija).',
      );
    },
  },

  // --- Tekst ---
  {
    name: 'len',
    returns: 'number',
    params: [{ type: 'string', label: 'text' }],
    summary: 'Dužina teksta.',
    call: (args) => requireString(args[0] ?? null, 'len', 'text').length,
  },
  {
    name: 'upper',
    returns: 'string',
    params: [{ type: 'string', label: 'text' }],
    summary: 'Tekst velikim slovima.',
    call: (args) => requireString(args[0] ?? null, 'upper', 'text').toUpperCase(),
  },
  {
    name: 'lower',
    returns: 'string',
    params: [{ type: 'string', label: 'text' }],
    summary: 'Tekst malim slovima.',
    call: (args) => requireString(args[0] ?? null, 'lower', 'text').toLowerCase(),
  },
  {
    name: 'concat',
    returns: 'string',
    params: [],
    variadic: { min: 1, type: 'string' },
    summary: 'Spaja tekstove (null se preskače).',
    call: (args) =>
      args
        .filter((arg): arg is string | number | boolean => arg !== null)
        .map((arg) => String(arg))
        .join(''),
  },

  // --- Domen ---
  {
    name: 'kmDiff',
    returns: 'number',
    params: [
      { type: 'number', label: 'from' },
      { type: 'number', label: 'to' },
    ],
    summary: 'Pređeni kilometri (`to − from`); npr. novi − stari odometer.',
    call: (args) => {
      const from = requireNumber(args[0] ?? null, 'kmDiff', 'from');
      const to = requireNumber(args[1] ?? null, 'kmDiff', 'to');
      return to - from;
    },
  },
  {
    name: 'fenToKm',
    returns: 'number',
    params: [{ type: 'number', label: 'feninzi' }],
    summary: 'Feninzi → KM (dijeli sa 100).',
    call: (args) => requireNumber(args[0] ?? null, 'fenToKm', 'feninzi') / 100,
  },
  {
    name: 'kmToFen',
    returns: 'number',
    params: [{ type: 'number', label: 'km' }],
    summary: 'KM → feninzi (množi sa 100, zaokruženo).',
    call: (args) => Math.round(requireNumber(args[0] ?? null, 'kmToFen', 'km') * 100),
  },
  {
    name: 'l100km',
    returns: 'number',
    params: [
      { type: 'number', label: 'liters' },
      { type: 'number', label: 'km' },
    ],
    summary: 'Potrošnja na 100 km; `null` ako su kilometri 0 ili negativni.',
    call: (args) => {
      const liters = requireNumber(args[0] ?? null, 'l100km', 'liters');
      const km = requireNumber(args[1] ?? null, 'l100km', 'km');
      if (km <= 0) return null;
      return roundTo((liters / km) * 100, 2);
    },
  },
];

/** Mapa za brzu provjeru (ime → specifikacija). */
export const FUNCTION_REGISTRY: ReadonlyMap<string, FunctionSpec> = new Map(
  FUNCTION_SPECS.map((spec) => [spec.name, spec]),
);

export function isKnownFunction(name: string): boolean {
  return FUNCTION_REGISTRY.has(name);
}

export function functionSpec(name: string): FunctionSpec | undefined {
  return FUNCTION_REGISTRY.get(name);
}

/**
 * Provjera broja argumenata. Vraća `null` ako je ispravno, inače poruku.
 * Koristi se i pri parsiranju (statička provjera) i pri evaluaciji.
 */
export function arityIssue(spec: FunctionSpec, count: number): string | null {
  if (spec.variadic) {
    return count >= spec.variadic.min
      ? null
      : `${spec.name}() traži barem ${spec.variadic.min} argument(a), a dobio je ${count}.`;
  }
  const required = spec.params.filter((param) => !param.optional).length;
  const max = spec.params.length;
  if (count < required) {
    return `${spec.name}() traži barem ${required} argument(a), a dobio je ${count}.`;
  }
  if (count > max) {
    return `${spec.name}() traži najviše ${max} argument(a), a dobio je ${count}.`;
  }
  return null;
}

/**
 * `today()` je jedina funkcija kojoj treba vanjski kontekst (server), pa je
 * evaluator izvršava sam — registar je čuva samo radi whitelist-a i arnosti.
 */
export function isContextualFunction(name: string): boolean {
  return name === 'today';
}

/** Provjera da je vrijednost logička (za `&&`/`||`/`!`). */
export function asBoolean(value: ExpressionValue, context: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null) return false;
  throw new ExpressionError('TYPE_ERROR', `${context}: očekivana je logička vrijednost (boolean).`);
}

export { number as toNumberOrNull };
