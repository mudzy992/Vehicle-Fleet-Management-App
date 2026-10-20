/**
 * Strukturni diff dvije verzije definicije (docs/04 §12, „Uporedi s prethodnom
 * verzijom").
 *
 * Poredi se po `fieldKey` (ključ je stabilan identitet polja u cijeloj formi), a
 * ne po redoslijedu — premještanje polja nije „izmijenjeno polje". Rezultat je
 * namijenjen UI prikazu i bilješci o promjeni pri objavi.
 */
import type { FormDefinition } from './definition.schema.js';
import { flattenFields } from './definition.schema.js';

export interface DefinitionValueChange {
  /** Putanja unutar polja, npr. `validation.max`. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface DefinitionFieldChange {
  readonly key: string;
  readonly label: string;
  readonly changes: readonly DefinitionValueChange[];
}

export interface DefinitionDiff {
  readonly meta: readonly DefinitionValueChange[];
  readonly addedFields: readonly string[];
  readonly removedFields: readonly string[];
  readonly changedFields: readonly DefinitionFieldChange[];
  readonly addedSections: readonly string[];
  readonly removedSections: readonly string[];
  readonly normalizationChanged: boolean;
  /** `true` kad nema nijedne razlike (ista definicija). */
  readonly empty: boolean;
}

type Comparable = Record<string, unknown>;

const FIELD_PROPS = [
  'type',
  'label',
  'helpText',
  'placeholder',
  'required',
  'order',
  'visibleWhen',
  'disabled',
  'visibleOnForm',
  'storeInFormData',
  'optionsSource',
  'validation',
  'computed',
] as const;

const META_PROPS = ['title', 'description', 'subject', 'language', 'estimatedMinutes'] as const;

function isPlainObject(value: unknown): value is Comparable {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rekurzivno poređenje dvije vrijednosti → lista promjena s putanjama. */
export function diffValues(before: unknown, after: unknown, path = ''): DefinitionValueChange[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      return diffValues(before[key], after[key], nextPath);
    });
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length) {
      return before.flatMap((item, index) => diffValues(item, after[index], `${path}[${index}]`));
    }
    return [{ path, before, after }];
  }

  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }];
}

/** Diff dvije validirane definicije (oba ulaza prolaze `parseDefinition`). */
export function diffDefinitions(from: FormDefinition, to: FormDefinition): DefinitionDiff {
  const meta = META_PROPS.flatMap((prop) => diffValues(from.meta[prop], to.meta[prop], `meta.${prop}`));

  const fromFields = new Map(flattenFields(from).map(({ field }) => [field.key, field] as const));
  const toFields = new Map(flattenFields(to).map(({ field }) => [field.key, field] as const));

  const addedFields = [...toFields.keys()].filter((key) => !fromFields.has(key));
  const removedFields = [...fromFields.keys()].filter((key) => !toFields.has(key));

  const changedFields: DefinitionFieldChange[] = [];
  for (const [key, before] of fromFields) {
    const after = toFields.get(key);
    if (!after) continue;
    const changes = FIELD_PROPS.flatMap((prop) => diffValues(before[prop], after[prop], String(prop)));
    if (changes.length > 0) {
      changedFields.push({ key, label: after.label, changes });
    }
  }

  const fromSections = from.sections.map((section) => section.key);
  const toSections = to.sections.map((section) => section.key);
  const addedSections = toSections.filter((key) => !fromSections.includes(key));
  const removedSections = fromSections.filter((key) => !toSections.includes(key));

  const normalizationChanged =
    JSON.stringify(from.normalizedName ?? []) !== JSON.stringify(to.normalizedName ?? []);

  return {
    meta,
    addedFields,
    removedFields,
    changedFields,
    addedSections,
    removedSections,
    normalizationChanged,
    empty:
      meta.length === 0 &&
      addedFields.length === 0 &&
      removedFields.length === 0 &&
      changedFields.length === 0 &&
      addedSections.length === 0 &&
      removedSections.length === 0 &&
      !normalizationChanged,
  };
}

/** Kratak sažetak za audit bilješku (`3 dodana, 1 uklonjeno, 2 izmijenjena`). */
export function summarizeDiff(diff: DefinitionDiff): string {
  const parts = [
    diff.addedFields.length > 0 ? `${diff.addedFields.length} dodano` : null,
    diff.removedFields.length > 0 ? `${diff.removedFields.length} uklonjeno` : null,
    diff.changedFields.length > 0 ? `${diff.changedFields.length} izmijenjeno` : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? 'Bez strukturnih promjena.' : `${parts.join(', ')} polja.`;
}
