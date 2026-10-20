/**
 * Uslovna vidljivost polja i sekcija (docs/04-FORM_ENGINE.md §4).
 *
 * Isti evaluator koriste web, mobilna aplikacija i server — pa polje nije
 * skriveno po jednoj logici na klijentu, a po drugoj na serveru. Skriveno polje
 * se **ne validira** i **ne šalje**; ako ipak stigne, odbija se `UNKNOWN_FIELD`.
 */
import { LIST_OPERATORS, NILADIC_OPERATORS, isLeaf, type VisibleWhenNode } from './definition.schema.js';
import type { StaticType, FieldTypeMap } from './expression/static-check.js';

/** Vrijednosti forme za evaluaciju uslova (`fieldKey → vrijednost`). */
export type ConditionValues = Readonly<Record<string, unknown>>;

/** Vrijednost uporediva u uslovu (`IN` liste). */
type Comparable = string | number | boolean | null;

function normalize(value: unknown): Comparable | readonly Comparable[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Comparable =>
        item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    );
  }
  // `MONEY` ({amount, currency}) → iznos; ostali objekti nisu uporedivi.
  if (typeof value === 'object') {
    const amount = (value as { amount?: unknown }).amount;
    if (typeof amount === 'number') return amount;
  }
  return undefined;
}

/** Prazno = `null`, `undefined`, prazan tekst ili prazna lista (docs/04 §4). */
function isEmpty(value: unknown): boolean {
  const normalized = normalize(value);
  if (normalized === undefined || normalized === null) return true;
  if (typeof normalized === 'string') return normalized.trim().length === 0;
  if (Array.isArray(normalized)) return normalized.length === 0;
  return false;
}

function looseEquals(left: Comparable, right: Comparable): boolean {
  // Datumi i brojevi iz forme mogu stići kao tekst ("2026-01-05" ili "5");
  // poređenje s literalom u definiciji mora raditi u oba slučaja.
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left === 'number' && typeof right === 'string') return String(left) === right;
  if (typeof left === 'string' && typeof right === 'number') return left === String(right);
  return false;
}

function compareOrdered(left: Comparable, right: Comparable): number | null {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === 'number' && typeof right === 'string') {
    const parsed = Number(right);
    return Number.isFinite(parsed) ? left - parsed : null;
  }
  if (typeof left === 'string' && typeof right === 'number') {
    const parsed = Number(left);
    return Number.isFinite(parsed) ? parsed - right : null;
  }
  return null;
}

/**
 * Evaluira `visibleWhen` čvor.
 *
 * Nepoznate/nepopunjene vrijednosti: `IS_EMPTY` → `true`, `IS_NOT_EMPTY` →
 * `false`, svi ostali operatori → `false` (polje se ne prikazuje dok uslov nije
 * ispunjen; nikad se ne baca greška zbog korisničkog unosa).
 */
export function evaluateCondition(
  node: VisibleWhenNode | null | undefined,
  values: ConditionValues,
): boolean {
  if (!node) return true;

  if (isLeaf(node)) {
    const actual = normalize(values[node.field]);
    const expected = node.value;

    if (node.op === 'IS_EMPTY') return isEmpty(values[node.field]);
    if (node.op === 'IS_NOT_EMPTY') return !isEmpty(values[node.field]);

    if (actual === undefined) return false;

    switch (node.op) {
      case 'IN':
        return Array.isArray(actual)
          ? Array.isArray(expected) &&
              actual.some((item) => expected.some((candidate) => looseEquals(item, candidate as Comparable)))
          : Array.isArray(expected) &&
              expected.some((candidate) => looseEquals(actual as Comparable, candidate as Comparable));

      case 'NOT_IN':
        return !evaluateCondition({ ...node, op: 'IN' } as VisibleWhenNode, values);

      case 'CONTAINS': {
        if (Array.isArray(actual)) {
          return Array.isArray(expected)
            ? expected.every((candidate) => actual.some((item) => looseEquals(item, candidate as Comparable)))
            : actual.some((item) => looseEquals(item, expected as Comparable));
        }
        return typeof actual === 'string' && typeof expected === 'string' ? actual.includes(expected) : false;
      }

      case 'BETWEEN': {
        if (!Array.isArray(expected) || expected.length !== 2) return false;
        const low = compareOrdered(actual as Comparable, expected[0] as Comparable);
        const high = compareOrdered(actual as Comparable, expected[1] as Comparable);
        return low !== null && high !== null && low >= 0 && high <= 0;
      }

      case '==':
        return Array.isArray(actual) ? false : looseEquals(actual as Comparable, expected as Comparable);

      case '!=':
        return Array.isArray(actual) ? true : !looseEquals(actual as Comparable, expected as Comparable);

      case '>':
      case '>=':
      case '<':
      case '<=': {
        if (Array.isArray(actual)) return false;
        const diff = compareOrdered(actual as Comparable, expected as Comparable);
        if (diff === null) return false;
        if (node.op === '>') return diff > 0;
        if (node.op === '>=') return diff >= 0;
        if (node.op === '<') return diff < 0;
        return diff <= 0;
      }

      default:
        return false;
    }
  }

  if ('not' in node) return !evaluateCondition(node.not, values);
  if ('all' in node) return node.all.every((child) => evaluateCondition(child, values));
  return node.any.some((child) => evaluateCondition(child, values));
}

export interface ConditionIssue {
  readonly code: 'UNKNOWN_FIELD' | 'UNUSABLE_FIELD' | 'INVALID_OPERATOR_VALUE';
  readonly field: string;
  readonly message: string;
}

/**
 * Statička provjera uslova pri objavi: referencira li postojeća polja i
 * odgovara li tip polja operatoru.
 */
export function checkCondition(
  node: VisibleWhenNode | null | undefined,
  fieldTypes: FieldTypeMap,
): readonly ConditionIssue[] {
  const issues: ConditionIssue[] = [];

  const visit = (current: VisibleWhenNode): void => {
    if (isLeaf(current)) {
      const type: StaticType | undefined = fieldTypes[current.field];
      if (type === undefined) {
        issues.push({
          code: 'UNKNOWN_FIELD',
          field: current.field,
          message: `Uslov referencira polje "${current.field}" koje ne postoji u ovoj verziji forme.`,
        });
        return;
      }
      if (type === 'unusable') {
        issues.push({
          code: 'UNUSABLE_FIELD',
          field: current.field,
          message: `Polje "${current.field}" je tipa koji se ne može koristiti u uslovu.`,
        });
        return;
      }

      const niladic = NILADIC_OPERATORS.includes(current.op);
      const list = LIST_OPERATORS.includes(current.op);
      const between = current.op === 'BETWEEN';

      if (niladic && current.value !== undefined) {
        issues.push({
          code: 'INVALID_OPERATOR_VALUE',
          field: current.field,
          message: `${current.op} ne prima vrijednost.`,
        });
      }
      if (!niladic && !list && !between && current.value === undefined) {
        issues.push({
          code: 'INVALID_OPERATOR_VALUE',
          field: current.field,
          message: `${current.op} zahtijeva vrijednost.`,
        });
      }
      if ((list || between) && !Array.isArray(current.value)) {
        issues.push({
          code: 'INVALID_OPERATOR_VALUE',
          field: current.field,
          message: `${current.op} zahtijeva listu vrijednosti.`,
        });
      }
      if (between && Array.isArray(current.value) && current.value.length !== 2) {
        issues.push({
          code: 'INVALID_OPERATOR_VALUE',
          field: current.field,
          message: 'BETWEEN zahtijeva tačno dvije vrijednosti [od, do].',
        });
      }
      return;
    }

    if ('not' in current) {
      visit(current.not);
      return;
    }
    const children = 'all' in current ? current.all : current.any;
    for (const child of children) visit(child);
  };

  if (node) visit(node);
  return issues;
}

/** Vrijednost polja je vidljiva (i validira se) ako svi roditeljski uslovi prolaze. */
export function isFieldVisible(
  conditions: readonly (VisibleWhenNode | null | undefined)[],
  values: ConditionValues,
): boolean {
  return conditions.every((condition) => evaluateCondition(condition, values));
}
