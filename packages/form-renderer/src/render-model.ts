/**
 * Headless render model — jedan izvor istine za web i mobilnu
 * (docs/04 §11/§12: „renderer isti rezultat na web i mobilnom").
 *
 * Zašto headless: komponente se razlikuju (React DOM vs. React Native), ali
 * **odluka šta se prikazuje** ne smije. Ova funkcija prima definiciju i
 * vrijednosti, a vraća potpuno opisano stablo (vidljivost, opcije, izračunate
 * vrijednosti, greške, progres) — bez ikakvog DOM-a, vremena ili I/O-a. Web i
 * mobilna samo mapiraju `widget` na svoju kontrolu.
 *
 * Pravila:
 * - vidljivost se računa istim uslovima kao na serveru (`isFieldVisible`), nad
 *   trimovanim unosom (identično `validateRecord`);
 * - `COMPUTED` se prikazuje kao read-only izlaz; vrijednost dolazi iz engine-a s
 *   istim `today` kao server (prosljeđuje se kroz opcije — nema „lokalnog danas");
 * - greške iz servera se mapiraju po `fieldKey`; polje s greškom ostaje vidljivo
 *   i kad uslov više nije ispunjen (korisnik mora vidjeti šta je poslao);
 * - opcije iz `LIST`/`QUERY` izvora ne rješavaju se ovdje (to radi server kroz
 *   whitelist upite) — model nosi `optionsSource` i `options: null`;
 * - funkcija je deterministička: isti ulaz → isti izlaz, bez `Date.now()`.
 */
import type { FieldDefinition, FormDefinition, SectionDefinition, VisibleWhenNode } from '@vfm/form-engine';
import { evaluateExpression, isFieldVisible, roundTo } from '@vfm/form-engine';
import type { FieldType } from '@vfm/form-engine';

/** Kontrola koju klijent treba nacrtati (mapiranje 1:1 na web/mobilnu). */
export const RENDER_WIDGETS = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'MONEY',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
  'PHOTO',
  'FILE',
  'REFERENCE',
  'OUTPUT',
  'GROUP',
] as const;
export type RenderWidget = (typeof RENDER_WIDGETS)[number];

const WIDGET_BY_TYPE: Readonly<Record<FieldType, RenderWidget>> = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  INTEGER: 'NUMBER',
  DECIMAL: 'NUMBER',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  BOOLEAN: 'BOOLEAN',
  SINGLE_CHOICE: 'SELECT',
  DROPDOWN: 'SELECT',
  MULTI_CHOICE: 'MULTI_SELECT',
  MONEY: 'MONEY',
  CURRENCY: 'CURRENCY',
  PHOTO: 'PHOTO',
  FILE: 'FILE',
  REFERENCE_VEHICLE: 'REFERENCE',
  REFERENCE_DRIVER: 'REFERENCE',
  REFERENCE_RECORD: 'REFERENCE',
  SECTION: 'GROUP',
  COMPUTED: 'OUTPUT',
};

export interface RenderOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface RenderFieldError {
  readonly code: string;
  readonly message: string;
}

export interface RenderField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly widget: RenderWidget;
  readonly helpText: string | null;
  readonly placeholder: string | null;
  /** Traži unos (server i dalje odlučuje; ovo je za oznaku „*"). */
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly visibleWhen: VisibleWhenNode | null;
  readonly validation: Readonly<Record<string, unknown>>;
  /** Vrijednost za prikaz (već očišćena: trim, izračunata polja iz engine-a). */
  readonly value: unknown;
  /** Opcije za `SELECT`/`MULTI_SELECT`; `null` kad ih rješava server. */
  readonly options: readonly RenderOption[] | null;
  readonly optionsSourceKind: 'STATIC' | 'LIST' | 'QUERY' | null;
  /** Greške iz servera ili lokalne validacije (ključ = `fieldKey`). */
  readonly errors: readonly RenderFieldError[];
  readonly hasError: boolean;
}

export interface RenderSection {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly order: number;
  readonly collapsible: boolean;
  readonly visible: boolean;
  readonly fields: readonly RenderField[];
}

export interface RenderProgress {
  readonly visibleFields: number;
  readonly requiredFields: number;
  readonly filledRequired: number;
  /** 0–100, za traku napretka; forma bez obaveznih polja je 100. */
  readonly percent: number;
}

export interface RenderModel {
  readonly formSchemaVersionId: string | null;
  readonly version: number | null;
  readonly title: string;
  readonly description: string | null;
  readonly language: string;
  readonly columns: number;
  readonly stickySubmit: boolean;
  readonly sections: readonly RenderSection[];
  readonly computed: Readonly<Record<string, unknown>>;
  /** Greške po `fieldKey` (za sažetak iznad forme i fokus na prvo polje). */
  readonly errors: Readonly<Record<string, RenderFieldError>>;
  readonly progress: RenderProgress;
  /** Prvo vidljivo polje s greškom (za skrol/fokus), ili `null`. */
  readonly firstErrorKey: string | null;
}

export interface FieldErrorInput {
  readonly key: string;
  readonly code: string;
  readonly message: string;
}

export interface BuildRenderModelOptions {
  readonly definition: FormDefinition;
  readonly values: Readonly<Record<string, unknown>>;
  /** Verzija koju zapis nosi (P10: stari zapis renderuje svoju verziju). */
  readonly formSchemaVersionId?: string | null;
  readonly version?: number | null;
  /** Greške iz `POST .../validate` ili lokalne provjere. */
  readonly errors?: readonly FieldErrorInput[];
  /** Serverski datum za izračunata polja (`today()` nema lokalnu vrijednost). */
  readonly today?: string;
}

/** Trimuje tekstove — ista priprema kao na serveru prije evaluacije uslova. */
function trimValues(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') trimmed[key] = value.trim();
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      trimmed[key] = (value as string[]).map((item) => item.trim());
    } else trimmed[key] = value;
  }
  return trimmed;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function sectionVisible(section: SectionDefinition, values: Readonly<Record<string, unknown>>): boolean {
  return isFieldVisible([section.visibleWhen], values);
}

function staticOptions(field: FieldDefinition): RenderOption[] | null {
  const source = field.optionsSource;
  if (!source || source.kind !== 'STATIC') return null;
  return source.items.map((item) => ({ value: item.value, label: item.label }));
}

function computedValue(field: FieldDefinition, values: Record<string, unknown>, today?: string): unknown {
  const expression = field.computed?.expression;
  if (!expression) return null;
  try {
    const result = evaluateExpression(expression, { values, today });
    if (result.value === null) return null;
    const precision = field.computed?.precision;
    if (field.computed?.resultType === 'INTEGER' && typeof result.value === 'number') {
      return Math.round(result.value);
    }
    if (field.computed?.resultType === 'DECIMAL' && typeof result.value === 'number') {
      return roundTo(result.value, precision ?? 2);
    }
    if (field.computed?.resultType === 'DATE' && typeof result.value === 'string') {
      return result.value.slice(0, 10);
    }
    return result.value;
  } catch {
    // Izraz se ne može izračunati nad trenutnim unosom — polje pokazuje „—".
    return null;
  }
}

/**
 * Gradi render model. Jedina funkcija koju web i mobilna dijele; sve ostalo su
 * prezentacijske komponente.
 */
export function buildRenderModel(options: BuildRenderModelOptions): RenderModel {
  const { definition } = options;
  const values = trimValues(options.values);
  const errorInputs = options.errors ?? [];

  const errorByKey = new Map<string, RenderFieldError[]>();
  for (const error of errorInputs) {
    const list = errorByKey.get(error.key) ?? [];
    list.push({ code: error.code, message: error.message });
    errorByKey.set(error.key, list);
  }

  // Izračunata polja se računaju nad unosom; redom iz definicije (već topološki
  // provjereno pri objavi, pa nema ciklusa).
  const computed: Record<string, unknown> = {};
  for (const section of definition.sections) {
    if (!sectionVisible(section, values)) continue;
    for (const field of section.fields) {
      if (field.type !== 'COMPUTED') continue;
      if (!isFieldVisible([field.visibleWhen], values)) continue;
      computed[field.key] = computedValue(field, { ...values, ...computed }, options.today);
    }
  }

  const sections: RenderSection[] = [];
  let visibleFields = 0;
  let requiredFields = 0;
  let filledRequired = 0;
  const errors: Record<string, RenderFieldError> = {};

  for (const section of definition.sections) {
    const visible = sectionVisible(section, values);
    const fields: RenderField[] = [];

    for (const field of section.fields) {
      const conditionVisible = visible && isFieldVisible([field.visibleWhen], values);
      // Polje s greškom ostaje vidljivo da korisnik vidi šta je poslao.
      const fieldErrors = errorByKey.get(field.key) ?? [];
      const isVisible = conditionVisible || fieldErrors.length > 0;

      if (fieldErrors.length > 0) errors[field.key] = fieldErrors[0]!;
      if (!isVisible) continue;

      const value =
        field.type === 'COMPUTED'
          ? (computed[field.key] ?? null)
          : field.storeInFormData === false
            ? null
            : (values[field.key] ?? null);

      if (field.type !== 'SECTION' && field.type !== 'COMPUTED') {
        visibleFields += 1;
        if (field.required) {
          requiredFields += 1;
          if (!isEmpty(value)) filledRequired += 1;
        }
      }

      const source = field.optionsSource;
      fields.push({
        key: field.key,
        label: field.label,
        type: field.type,
        widget: WIDGET_BY_TYPE[field.type],
        helpText: field.helpText ?? null,
        placeholder: field.placeholder ?? null,
        required: field.required,
        disabled: field.disabled,
        readOnly: field.type === 'COMPUTED' || field.disabled,
        visibleWhen: field.visibleWhen ?? null,
        validation: field.validation ?? {},
        value,
        options: staticOptions(field),
        optionsSourceKind: source?.kind ?? null,
        errors: fieldErrors,
        hasError: fieldErrors.length > 0,
      });
    }

    if (!visible && fields.length === 0) continue;
    sections.push({
      key: section.key,
      title: section.title,
      description: section.description ?? null,
      order: section.order,
      collapsible: definition.layout?.sectionsCollapsible ?? false,
      visible,
      fields,
    });
  }

  const firstErrorKey =
    errorInputs.length === 0
      ? null
      : (sections.flatMap((section) => section.fields).find((field) => field.hasError)?.key ?? null);

  return {
    formSchemaVersionId: options.formSchemaVersionId ?? null,
    version: options.version ?? null,
    title: definition.meta.title,
    description: definition.meta.description ?? null,
    language: definition.meta.language,
    columns: definition.layout?.columns ?? 1,
    stickySubmit: definition.layout?.stickySubmit ?? false,
    sections,
    computed,
    errors,
    progress: {
      visibleFields,
      requiredFields,
      filledRequired,
      percent: requiredFields === 0 ? 100 : Math.round((filledRequired / requiredFields) * 100),
    },
    firstErrorKey,
  };
}

/**
 * Vrijednosti za slanje na server: samo vidljiva polja koja nose vrijednost.
 * Skrivena polja se **ne šalju** (server bi ih odbio s `FIELD_NOT_VISIBLE`).
 */
export function collectSubmitValues(model: RenderModel): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const section of model.sections) {
    if (!section.visible) continue;
    for (const field of section.fields) {
      if (field.type === 'SECTION' || field.type === 'COMPUTED' || field.disabled) continue;
      if (field.value === null || field.value === undefined) continue;
      values[field.key] = field.value;
    }
  }
  return values;
}

/** Formatiranje za prikaz (bez lokalizacijskih iznenađenja — fiksni `bs-BA`). */
export function formatFieldValue(field: RenderField): string {
  const value = field.value;
  if (value === null || value === undefined || value === '') return '—';

  switch (field.widget) {
    case 'MONEY': {
      const money = value as { amount?: number; currency?: string };
      if (typeof money.amount !== 'number') return '—';
      return new Intl.NumberFormat('bs-BA', {
        style: 'currency',
        currency: money.currency ?? 'BAM',
        minimumFractionDigits: 2,
      }).format(money.amount / 100);
    }
    case 'DATE':
      return typeof value === 'string' ? formatDate(value) : '—';
    case 'DATETIME':
      return typeof value === 'string' ? `${formatDate(value.slice(0, 10))} ${value.slice(11, 16)}` : '—';
    case 'BOOLEAN':
      return value === true ? 'Da' : 'Ne';
    case 'MULTI_SELECT':
      return Array.isArray(value) ? value.join(', ') : '—';
    case 'OUTPUT':
      return typeof value === 'number' ? String(value) : String(value);
    default:
      return String(value);
  }
}

function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}.` : iso;
}
