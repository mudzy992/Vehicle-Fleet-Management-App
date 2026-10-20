/**
 * Statička provjera izraza pri objavi forme (docs/04-FORM_ENGINE.md §6.3).
 *
 * Prije objave se **bez izvršavanja** provjerava:
 * 1. referencira li izraz postojeća polja iste verzije (`UNKNOWN_FIELD`),
 * 2. postoje li funkcije i je li broj argumenata ispravan (`UNKNOWN_FUNCTION`, `WRONG_ARITY`),
 * 3. slažu li se tipovi (`TYPE_ERROR`) i odgovara li rezultat `resultType` (`RESULT_TYPE_MISMATCH`),
 * 4. je li dijeljenje zaštićeno od nule (`DIVISION_BY_ZERO`) — dozvoljeno je
 *    dijeljenje nenultim literalom ili djeljivom koji je u grani `if()`-a
 *    dokazano različit od nule (`if(x > 0, a / x, 0)`).
 *
 * Provjera je konzervativna: bolje je odbiti objavu s jasnom porukom nego
 * pustiti izraz koji puca korisniku pri popunjavanju.
 */
import {
  ExpressionError,
  type AstNode,
  type BinaryOperator,
  type ExpressionErrorCode,
  type ParsedExpression,
  parseExpression,
} from './parser.js';
import { FUNCTION_REGISTRY, arityIssue, type ExpressionValue } from './functions.js';

/** Apstraktni tipovi koje statička provjera razlikuje. */
export const STATIC_TYPES = [
  'number',
  'money',
  'string',
  'boolean',
  'date',
  'null',
  'any',
  'unusable',
] as const;
export type StaticType = (typeof STATIC_TYPES)[number];

/** Mapa `fieldKey → apstraktni tip` za jednu verziju forme. */
export type FieldTypeMap = Readonly<Record<string, StaticType>>;

export interface ExpressionIssue {
  readonly code: ExpressionErrorCode;
  readonly message: string;
}

export interface ExpressionCheckResult {
  readonly ok: boolean;
  readonly issues: readonly ExpressionIssue[];
  /** Zaključeni tip rezultata (`any` kad se ne može odrediti). */
  readonly resultType: StaticType;
  readonly fieldRefs: readonly string[];
  readonly functionRefs: readonly string[];
}

/** Rezultat kompatibilnosti tipa izraza s `resultType` polja `COMPUTED`. */
export const RESULT_TYPE_COMPATIBILITY: Readonly<Record<string, readonly StaticType[]>> = {
  INTEGER: ['number', 'money'],
  DECIMAL: ['number', 'money'],
  MONEY: ['money', 'number'],
  TEXT: ['string'],
  BOOLEAN: ['boolean'],
  DATE: ['date', 'string'],
  DATETIME: ['date', 'string'],
};

/** Vrijednosti koje se smiju koristiti u aritmetici. */
function isNumeric(type: StaticType): boolean {
  return type === 'number' || type === 'money' || type === 'null' || type === 'any';
}

function isComparable(left: StaticType, right: StaticType): boolean {
  if (left === 'null' || right === 'null' || left === 'any' || right === 'any') return true;
  if (left === right)
    return (
      left === 'number' || left === 'money' || left === 'string' || left === 'boolean' || left === 'date'
    );
  // number i money su ista porodica; datum je tekst (ISO) za poređenje.
  if (isNumeric(left) && isNumeric(right)) return true;
  if ((left === 'date' && right === 'string') || (left === 'string' && right === 'date')) return true;
  return false;
}

function mergeTypes(left: StaticType, right: StaticType): StaticType {
  if (left === right) return left;
  if (left === 'null') return right;
  if (right === 'null') return left;
  if (isNumeric(left) && isNumeric(right)) return 'number';
  return 'any';
}

/** Ispis AST-a natrag u kanonski tekst (koristi se za poređenje djelilaca). */
export function printAst(node: AstNode): string {
  switch (node.kind) {
    case 'literal':
      if (node.value === null) return 'null';
      if (typeof node.value === 'string') return JSON.stringify(node.value);
      return String(node.value);
    case 'field':
      return node.name;
    case 'unary':
      return `${node.op}${printAst(node.operand)}`;
    case 'binary':
      return `(${printAst(node.left)}${node.op}${printAst(node.right)})`;
    case 'call':
      return `${node.name}(${node.args.map((arg) => printAst(arg)).join(',')})`;
    default:
      return '?';
  }
}

/**
 * Iz uslova izvlači izraze za koje je u `true` grani dokazano da nisu nula.
 *
 * Podržani obrasci (dovoljni za praksu, i konzervativni):
 * `x > 0`, `x >= 1`, `x >= 0.5`, `x != 0`, `0 < x`, uz `&&` (unija).
 */
export function nonZeroProofs(condition: AstNode): Set<string> {
  const safe = new Set<string>();

  const visit = (node: AstNode): void => {
    if (node.kind === 'binary' && node.op === '&&') {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.kind !== 'binary') return;

    const op = node.op;
    const leftIsNumberLiteral = node.left.kind === 'literal' && typeof node.left.value === 'number';
    const rightIsNumberLiteral = node.right.kind === 'literal' && typeof node.right.value === 'number';

    // x > 0 / x >= 1 / x >= 0.5 / x != 0
    if (rightIsNumberLiteral && (op === '>' || op === '>=' || op === '!=')) {
      const bound = (node.right as { value: number }).value;
      // `x != 0` dokazuje da x nije nula; `x > 0` i `x >= 1` (ili `>= 0.5`) takođe.
      const proven = op === '!=' ? bound === 0 : op === '>' ? bound >= 0 : bound > 0;
      if (proven) safe.add(printAst(node.left));
      return;
    }
    // 0 < x
    if (leftIsNumberLiteral && (op === '<' || op === '<=')) {
      const bound = (node.left as { value: number }).value;
      const proven = op === '<' ? bound >= 0 : bound > 0;
      if (proven) safe.add(printAst(node.right));
    }
  };

  visit(condition);
  return safe;
}

interface CheckState {
  readonly fieldTypes: FieldTypeMap;
  readonly issues: ExpressionIssue[];
  readonly safe: Set<string>;
}

function addIssue(state: CheckState, code: ExpressionErrorCode, message: string): void {
  state.issues.push({ code, message });
}

/** Zaključi tip čvora; greške idu u `state.issues`, a vraća se `any` da se nastavi. */
function inferType(node: AstNode, state: CheckState): StaticType {
  switch (node.kind) {
    case 'literal': {
      const value: ExpressionValue = node.value;
      if (value === null) return 'null';
      if (typeof value === 'number') return 'number';
      if (typeof value === 'boolean') return 'boolean';
      return /^\d{4}-\d{2}-\d{2}/u.test(value) ? 'date' : 'string';
    }

    case 'field': {
      const type = state.fieldTypes[node.name];
      if (type === undefined) {
        addIssue(state, 'UNKNOWN_FIELD', `Polje "${node.name}" ne postoji u ovoj verziji forme.`);
        return 'any';
      }
      if (type === 'unusable') {
        addIssue(
          state,
          'TYPE_ERROR',
          `Polje "${node.name}" je tipa koji se ne može koristiti u izrazima (npr. prilozi ili višestruki izbor).`,
        );
        return 'any';
      }
      return type;
    }

    case 'unary': {
      const operand = inferType(node.operand, state);
      if (node.op === '!') {
        if (operand !== 'boolean' && operand !== 'any' && operand !== 'null') {
          addIssue(state, 'TYPE_ERROR', 'Operator ! traži logičku vrijednost.');
          return 'any';
        }
        return 'boolean';
      }
      if (!isNumeric(operand)) {
        addIssue(state, 'TYPE_ERROR', 'Unarni minus traži broj.');
        return 'any';
      }
      return 'number';
    }

    case 'binary':
      return inferBinary(node.op, node.left, node.right, state);

    case 'call':
      return inferCall(node, state);

    default:
      return 'any';
  }
}

function inferBinary(
  op: BinaryOperator,
  leftNode: AstNode,
  rightNode: AstNode,
  state: CheckState,
): StaticType {
  // `if` se ovdje ne pojavljuje (to je poziv funkcije), ali lijeva grana može
  // biti zaštićena; zato se provjera djelilaca radi u `inferCall`-u za `if`.
  const left = inferType(leftNode, state);
  const right = inferType(rightNode, state);

  if (op === '&&' || op === '||') {
    for (const type of [left, right]) {
      if (type !== 'boolean' && type !== 'any' && type !== 'null') {
        addIssue(state, 'TYPE_ERROR', `Operator ${op} traži logičke vrijednosti.`);
        return 'any';
      }
    }
    return 'boolean';
  }

  if (['==', '!=', '>', '>=', '<', '<='].includes(op)) {
    if (!isComparable(left, right)) {
      addIssue(state, 'TYPE_ERROR', `Nije dozvoljeno porediti ${left} s ${right} (operator ${op}).`);
      return 'any';
    }
    return 'boolean';
  }

  // Aritmetika
  if (!isNumeric(left) || !isNumeric(right)) {
    addIssue(state, 'TYPE_ERROR', `Operator ${op} traži brojeve (dobio ${left} i ${right}).`);
    return 'any';
  }

  if (op === '/' || op === '%') {
    assertDivisorSafe(rightNode, state, op);
  }

  return 'number';
}

/** Dijeljenje je sigurno ako je djelilac nenulti literal ili dokazano nenulti izraz. */
function assertDivisorSafe(divisor: AstNode, state: CheckState, op: string): void {
  if (divisor.kind === 'literal' && typeof divisor.value === 'number') {
    if (divisor.value === 0) {
      addIssue(state, 'DIVISION_BY_ZERO', `Dijeljenje nulom (operator ${op}).`);
    }
    return;
  }

  if (state.safe.has(printAst(divisor))) return;

  addIssue(
    state,
    'DIVISION_BY_ZERO',
    `Dijeljenje izrazom "${printAst(divisor)}" nije zaštićeno od nule — koristite ` +
      `if(${printAst(divisor)} > 0, …, …) ili nenulti broj.`,
  );
}

function inferCall(node: Extract<AstNode, { kind: 'call' }>, state: CheckState): StaticType {
  const spec = FUNCTION_REGISTRY.get(node.name);
  if (!spec) {
    addIssue(state, 'UNKNOWN_FUNCTION', `Funkcija "${node.name}" nije dozvoljena.`);
    // Argumenti se ipak provjere (da korisnik dobije sve greške odjednom).
    for (const arg of node.args) inferType(arg, state);
    return 'any';
  }

  const arity = arityIssue(spec, node.args.length);
  if (arity) {
    addIssue(state, 'WRONG_ARITY', arity);
  }

  // `if(cond, a, b)`: uslov je boolean, grane se provjeravaju s dokazima iz uslova.
  if (node.name === 'if' && node.args.length === 3) {
    const [condition, whenTrue, whenFalse] = node.args as [AstNode, AstNode, AstNode];
    const conditionType = inferType(condition, state);
    if (conditionType !== 'boolean' && conditionType !== 'any' && conditionType !== 'null') {
      addIssue(state, 'TYPE_ERROR', 'if(): prvi argument mora biti uslov (boolean).');
    }

    const proofs = nonZeroProofs(condition);
    const saved = new Set(state.safe);
    for (const proof of proofs) state.safe.add(proof);
    const trueType = inferType(whenTrue, state);
    state.safe.clear();
    for (const proof of saved) state.safe.add(proof);

    const falseType = inferType(whenFalse, state);
    return mergeTypes(trueType, falseType);
  }

  const argTypes = node.args.map((arg) => inferType(arg, state));

  // Provjera tipova argumenata prema specifikaciji (varijabilne funkcije: svi
  // argumenti istog tipa).
  if (spec.variadic) {
    for (const type of argTypes) {
      if (type === 'any' || type === 'null') continue;
      if (!typeMatches(spec.variadic.type, type)) {
        addIssue(state, 'TYPE_ERROR', `${spec.name}() traži ${spec.variadic.type}, a dobio je ${type}.`);
        break;
      }
    }
  } else {
    node.args.forEach((_, index) => {
      const param = spec.params[index];
      const type = argTypes[index];
      if (!param || type === undefined) return;
      if (type === 'any' || type === 'null') return;
      if (!typeMatches(param.type, type)) {
        addIssue(
          state,
          'TYPE_ERROR',
          `${spec.name}(): parametar "${param.label}" mora biti ${param.type}, a dobio je ${type}.`,
        );
      }
    });
  }

  if (node.name === 'coalesce' || node.name === 'concat') {
    return spec.returns === 'string' ? (argTypes[0] === 'money' ? 'money' : 'string') : spec.returns;
  }
  return spec.returns;
}

function typeMatches(expected: string, actual: StaticType): boolean {
  if (expected === 'number') return isNumeric(actual);
  if (expected === 'date') return actual === 'date' || actual === 'string';
  if (expected === 'string') return actual === 'string' || actual === 'date';
  if (expected === 'boolean') return actual === 'boolean';
  return true;
}

/**
 * Provjeri izraz prema tipovima polja jedne verzije forme.
 *
 * @param source izraz (`COMPUTED.expression`)
 * @param fieldTypes mapa `fieldKey → tip` (vidi `fieldTypesFromDefinition`)
 * @param expectedResultType `COMPUTED.resultType` (opciono — provjerava se kompatibilnost)
 */
export function checkExpression(
  source: string,
  fieldTypes: FieldTypeMap,
  expectedResultType?: string,
): ExpressionCheckResult {
  let parsed: ParsedExpression;
  try {
    parsed = parseExpression(source);
  } catch (error) {
    const code: ExpressionErrorCode = error instanceof ExpressionError ? error.code : 'UNEXPECTED_TOKEN';
    return {
      ok: false,
      issues: [{ code, message: error instanceof Error ? error.message : String(error) }],
      resultType: 'any',
      fieldRefs: [],
      functionRefs: [],
    };
  }

  const state: CheckState = { fieldTypes, issues: [], safe: new Set() };
  const resultType = inferType(parsed.ast, state);

  if (expectedResultType) {
    const allowed = RESULT_TYPE_COMPATIBILITY[expectedResultType];
    if (!allowed) {
      addIssue(state, 'RESULT_TYPE_MISMATCH', `Nepoznat resultType "${expectedResultType}".`);
    } else if (resultType !== 'any' && resultType !== 'null' && !allowed.includes(resultType)) {
      addIssue(
        state,
        'RESULT_TYPE_MISMATCH',
        `Izraz vraća ${resultType}, a polje je deklarisano kao ${expectedResultType}.`,
      );
    }
  }

  return {
    ok: state.issues.length === 0,
    issues: state.issues,
    resultType,
    fieldRefs: parsed.fieldRefs,
    functionRefs: parsed.functionRefs,
  };
}

/** Kao {@link checkExpression}, ali baca `ExpressionError` na prvi problem. */
export function assertExpression(
  source: string,
  fieldTypes: FieldTypeMap,
  expectedResultType?: string,
): ExpressionCheckResult {
  const result = checkExpression(source, fieldTypes, expectedResultType);
  const first = result.issues[0];
  if (!result.ok && first) {
    throw new ExpressionError(first.code, first.message);
  }
  return result;
}
