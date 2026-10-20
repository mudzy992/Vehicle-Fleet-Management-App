/**
 * Tipovi polja jedne verzije forme → apstraktni tipovi za statičku provjeru
 * izraza (docs/04-FORM_ENGINE.md §3, §6.3).
 *
 * Ovaj modul je jedini izvor mapiranja `FieldType → StaticType`; koriste ga
 * provjera izraza, provjera uslova i (kasnije) renderer.
 */
import type { FieldType } from './field-types.js';
import type { FormDefinition } from './definition.schema.js';
import { flattenFields } from './definition.schema.js';
import type { StaticType, FieldTypeMap } from './expression/static-check.js';

/** Apstraktni tip za polje polja `type` (bez obzira na konkretnu vrijednost). */
export const FIELD_STATIC_TYPE: Readonly<Record<FieldType, StaticType>> = {
  TEXT: 'string',
  TEXTAREA: 'string',
  INTEGER: 'number',
  DECIMAL: 'number',
  DATE: 'date',
  DATETIME: 'date',
  BOOLEAN: 'boolean',
  SINGLE_CHOICE: 'string',
  MULTI_CHOICE: 'unusable',
  DROPDOWN: 'string',
  MONEY: 'money',
  CURRENCY: 'string',
  PHOTO: 'unusable',
  FILE: 'unusable',
  REFERENCE_VEHICLE: 'string',
  REFERENCE_DRIVER: 'string',
  REFERENCE_RECORD: 'unusable',
  SECTION: 'unusable',
  COMPUTED: 'number',
};

/** `resultType` polja `COMPUTED` → apstraktni tip. */
export const COMPUTED_STATIC_TYPE: Readonly<Record<string, StaticType>> = {
  INTEGER: 'number',
  DECIMAL: 'number',
  MONEY: 'money',
  TEXT: 'string',
  BOOLEAN: 'boolean',
  DATE: 'date',
  DATETIME: 'date',
};

export interface FieldTypesResult {
  readonly types: FieldTypeMap;
  /** Ciklusi u izračunatim poljima (`a → b → a`); prazno = ispravno. */
  readonly cycles: readonly (readonly string[])[];
}

/**
 * Mapa `fieldKey → apstraktni tip` za statičku provjeru izraza.
 *
 * Polja tipa `COMPUTED` dobijaju tip iz `resultType`, a njihove međuzavisnosti
 * se provjeravaju na cikluse (ciklus bi značio da se izraz ne može izračunati).
 */
export function fieldTypesFromDefinition(definition: FormDefinition): FieldTypesResult {
  const types: Record<string, StaticType> = {};

  for (const { field } of flattenFields(definition)) {
    if (field.type === 'COMPUTED') {
      types[field.key] = COMPUTED_STATIC_TYPE[field.computed?.resultType ?? 'DECIMAL'] ?? 'number';
    } else {
      types[field.key] = FIELD_STATIC_TYPE[field.type];
    }
  }

  const cycles = findComputedCycles(definition);
  return { types, cycles };
}

/**
 * Detekcija ciklusa među izračunatim poljima (topološki pristup, DFS).
 *
 * Ciklus se vraća kao putanja (`['a', 'b', 'a']`) da poruka o grešci bude
 * razumljiva; objava forme je blokirana dok se ne ukloni.
 */
export function findComputedCycles(definition: FormDefinition): readonly (readonly string[])[] {
  const dependencies = new Map<string, readonly string[]>();

  for (const { field } of flattenFields(definition)) {
    if (field.type !== 'COMPUTED' || !field.computed) continue;
    const refs = referencedFields(field.computed.expression);
    dependencies.set(
      field.key,
      refs.filter((ref) => ref !== field.key),
    );
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      cycles.push([...stack.slice(start), key]);
      return;
    }
    visiting.add(key);
    stack.push(key);
    for (const dependency of dependencies.get(key) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
    }
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of dependencies.keys()) visit(key);
  return cycles;
}

/**
 * Nazivi polja na koje izraz referencira.
 *
 * Namjerno **best effort** (regex nad identifikatorima): koristi se samo za
 * detekciju ciklusa; puna provjera referenci ide kroz AST
 * ({@link import('./expression/static-check.js').checkExpression}).
 */
function referencedFields(expression: string): string[] {
  const refs = new Set<string>();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(expression)) !== null) {
    const name = match[1];
    // Poziv funkcije (`name(`) nije referenca na polje; ključne riječi također ne.
    if (!name || match[2] === '(') continue;
    if (name === 'true' || name === 'false' || name === 'null') continue;
    refs.add(name);
  }
  return [...refs];
}
