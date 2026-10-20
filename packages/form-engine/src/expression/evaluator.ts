/**
 * Interpreter sigurnih izraza (docs/04-FORM_ENGINE.md §6.3/§6.4).
 *
 * Evaluacija je sinhrona, bez I/O i bez pristupa okruženju:
 * - vrijednosti polja dolaze iz **eksplicitno proslijeđenog** objekta,
 * - `today()` dolazi iz opcije `today` (server ga snapshot-uje u `formData`),
 * - sve funkcije su iz zatvorenog registra ({@link FUNCTION_REGISTRY}).
 *
 * `null` je legitimna vrijednost (nepopunjeno opciono polje): aritmetika s njim
 * daje `null`, uslovi ga tretiraju kao netačan, a poređenje s `null` je
 * dozvoljeno (`== null` / `!= null`). Tako forma ne pada zbog neobaveznog polja,
 * a `if(...)` i `coalesce(...)` služe za eksplicitne slučajeve.
 */
import {
  ExpressionError,
  type AstNode,
  type BinaryOperator,
  type ParsedExpression,
  EXPRESSION_LIMITS,
  parseExpression,
} from './parser.js';
import {
  FUNCTION_REGISTRY,
  arityIssue,
  asBoolean,
  isContextualFunction,
  type ExpressionValue,
  type FunctionSpec,
} from './functions.js';

/** Kontekst evaluacije: vrijednosti polja + fiksirano „danas". */
export interface EvaluationContext {
  /** Vrijednosti polja po `fieldKey` (nedostajuće polje = `null`). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Današnji datum (`YYYY-MM-DD`, UTC) za `today()`. */
  readonly today?: string;
  /** Maksimalno trajanje evaluacije u ms (default 10 ms, docs/04 §6.3). */
  readonly timeoutMs?: number;
}

export interface EvaluationResult {
  readonly value: ExpressionValue;
  /** Tip vraćene vrijednosti (`null` kad je vrijednost `null`). */
  readonly type: 'number' | 'string' | 'boolean' | 'null' | 'date';
}

const DEFAULT_TIMEOUT_MS = 10;

/** `MONEY` polje je `{amount, currency}` — u izrazima se koristi iznos u feninzima. */
function coerceFieldValue(raw: unknown): ExpressionValue {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'object') {
    const amount = (raw as { amount?: unknown }).amount;
    if (typeof amount === 'number' && Number.isFinite(amount)) return amount;
    // Nizovi (PHOTO/FILE) i objekti bez `amount` nisu upotrebljivi u izrazima.
    return null;
  }
  return null;
}

/** ISO datum (`YYYY-MM-DD` ili puni ISO) — prepoznaje se za `type` rezultata. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/u;

function valueType(value: ExpressionValue): EvaluationResult['type'] {
  if (value === null) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return ISO_DATE_PATTERN.test(value) ? 'date' : 'string';
}

function isNumber(value: ExpressionValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Numerička vrijednost: number ostaje, `null` propagira, sve ostalo je TYPE_ERROR. */
function numeric(value: ExpressionValue, context: string): number | null {
  if (value === null) return null;
  if (!isNumber(value)) {
    throw new ExpressionError('TYPE_ERROR', `${context}: očekivan je broj.`);
  }
  return value;
}

function compare(left: ExpressionValue, right: ExpressionValue, op: BinaryOperator): boolean {
  if (left === null || right === null) {
    // Poređenje s nepopunjenim poljem nije greška — uslov je prosto netačan,
    // osim `==`/`!=` koji su jedini smisleni nad `null`.
    if (op === '==' || op === '!=') {
      const equal = left === right;
      return op === '==' ? equal : !equal;
    }
    return false;
  }

  if (isNumber(left) && isNumber(right)) {
    return applyOrdering(left, right, op);
  }

  if (typeof left === 'string' && typeof right === 'string') {
    // ISO datumi se porede leksikografski = hronološki.
    return applyOrdering(left, right, op);
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    throw new ExpressionError('TYPE_ERROR', 'Boolean se može samo porediti s == ili !=.');
  }

  throw new ExpressionError('TYPE_ERROR', `Nije dozvoljeno porediti ${describe(left)} s ${describe(right)}.`);
}

function describe(value: ExpressionValue): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return 'broj';
  if (typeof value === 'boolean') return 'boolean';
  return ISO_DATE_PATTERN.test(value) ? 'datum' : 'tekst';
}

function applyOrdering<T extends number | string>(left: T, right: T, op: BinaryOperator): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      throw new ExpressionError('TYPE_ERROR', `Operator ${op} nije poređenje.`);
  }
}

class Interpreter {
  private nodes = 0;
  private calls = 0;
  private readonly deadline: number;
  private readonly todayValue: string | undefined;

  constructor(private readonly context: EvaluationContext) {
    const timeout = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deadline = Date.now() + timeout;
    this.todayValue = context.today;
  }

  /** Tvrda granica rada: i pored limita iz parsera, evaluacija se prekida. */
  private guard(): void {
    // Prvih nekoliko čvorova se provjerava uvijek (da i mali izraz padne kad je
    // budžet već potrošen), dalje svakih 64 čvora — `Date.now()` nije besplatan.
    if ((this.nodes <= 8 || (this.nodes & 0x3f) === 0) && Date.now() > this.deadline) {
      throw new ExpressionError('COMPUTED_TIMEOUT', 'Izračun je prekoračio dozvoljeno vrijeme (10 ms).');
    }
  }

  evaluate(node: AstNode): ExpressionValue {
    this.nodes += 1;
    this.guard();

    switch (node.kind) {
      case 'literal':
        return node.value;

      case 'field':
        return coerceFieldValue(this.context.values[node.name]);

      case 'unary': {
        const operand = this.evaluate(node.operand);
        if (node.op === '!') return !asBoolean(operand, 'Operator !');
        const value = numeric(operand, 'Unarni minus');
        return value === null ? null : -value;
      }

      case 'binary':
        return this.binary(node.op, node.left, node.right);

      case 'call':
        return this.call(node.name, node.args);

      default:
        throw new ExpressionError('UNEXPECTED_TOKEN', 'Nepoznat čvor izraza.');
    }
  }

  private binary(op: BinaryOperator, leftNode: AstNode, rightNode: AstNode): ExpressionValue {
    // Kratko spajanje: desna strana se ne evaluira kad ishod ne zavisi od nje.
    if (op === '&&' || op === '||') {
      const left = asBoolean(this.evaluate(leftNode), `Operator ${op}`);
      if (op === '&&' && !left) return false;
      if (op === '||' && left) return true;
      return asBoolean(this.evaluate(rightNode), `Operator ${op}`);
    }

    const left = this.evaluate(leftNode);
    const right = this.evaluate(rightNode);

    switch (op) {
      case '==':
      case '!=':
      case '>':
      case '>=':
      case '<':
      case '<=':
        return compare(left, right, op);

      case '+':
        // `+` je numerički: spajanje teksta ide kroz `concat()` (bez implicitne
        // konverzije, da `1 + "2"` ne postane `"12"`).
        return this.arith(left, right, '+', (a, b) => a + b);

      case '-':
        return this.arith(left, right, '-', (a, b) => a - b);

      case '*':
        return this.arith(left, right, '*', (a, b) => a * b);

      case '/': {
        if (isNumber(right) && right === 0) {
          throw new ExpressionError('DIVISION_BY_ZERO', 'Dijeljenje nulom.');
        }
        if (right === null) return null;
        return this.arith(left, right, '/', (a, b) => a / b);
      }

      case '%': {
        if (isNumber(right) && right === 0) {
          throw new ExpressionError('DIVISION_BY_ZERO', 'Ostatak pri dijeljenju nulom.');
        }
        return this.arith(left, right, '%', (a, b) => a % b);
      }

      default:
        throw new ExpressionError('UNEXPECTED_TOKEN', `Operator ${op} nije podržan.`);
    }
  }

  private arith(
    left: ExpressionValue,
    right: ExpressionValue,
    op: string,
    apply: (left: number, right: number) => number,
  ): ExpressionValue {
    const a = numeric(left, `Operator ${op}`);
    const b = numeric(right, `Operator ${op}`);
    if (a === null || b === null) return null;
    const result = apply(a, b);
    if (!Number.isFinite(result)) {
      throw new ExpressionError('DIVISION_BY_ZERO', `Rezultat operatora ${op} nije konačan broj.`);
    }
    return result;
  }

  private call(name: string, argNodes: readonly AstNode[]): ExpressionValue {
    this.calls += 1;
    if (this.calls > EXPRESSION_LIMITS.maxFunctionCalls) {
      throw new ExpressionError('TOO_MANY_CALLS', 'Previše poziva funkcija u izrazu.');
    }

    const spec: FunctionSpec | undefined = FUNCTION_REGISTRY.get(name);
    if (!spec) {
      throw new ExpressionError('UNKNOWN_FUNCTION', `Funkcija "${name}" nije dozvoljena.`);
    }

    const arity = arityIssue(spec, argNodes.length);
    if (arity) {
      throw new ExpressionError('WRONG_ARITY', arity);
    }

    if (isContextualFunction(name)) {
      if (!this.todayValue) {
        throw new ExpressionError('NOT_EVALUABLE', 'today() zahtijeva serverski datum (opcija `today`).');
      }
      return this.todayValue;
    }

    // `if` mora lijeno evaluirati grane: inače bi `if(x != 0, 10/x, 0)` pukao
    // na dijeljenju nulom i pored zaštite koja je upravo napisana.
    if (name === 'if') {
      const condition = asBoolean(this.evaluate(argNodes[0] as AstNode), 'if()');
      return this.evaluate(argNodes[condition ? 1 : 2] as AstNode);
    }

    if (name === 'and' || name === 'or') {
      const values = argNodes.map((arg) => asBoolean(this.evaluate(arg), `${name}()`));
      return name === 'and' ? values.every(Boolean) : values.some(Boolean);
    }

    if (name === 'coalesce') {
      for (const arg of argNodes) {
        const value = this.evaluate(arg);
        if (value !== null) return value;
      }
      return null;
    }

    const args = argNodes.map((arg) => this.evaluate(arg));
    return spec.call(args);
  }
}

/** Evaluira parsiran izraz nad datim vrijednostima. */
export function evaluateParsed(parsed: ParsedExpression, context: EvaluationContext): EvaluationResult {
  const value = new Interpreter(context).evaluate(parsed.ast);
  return { value, type: valueType(value) };
}

/** Parsira i evaluira izraz (kraći put za već validirane izraze). */
export function evaluateExpression(source: string, context: EvaluationContext): EvaluationResult {
  return evaluateParsed(parseExpression(source), context);
}

/**
 * Vrijednost za upis u `formData` (docs/04 §6.4): `null` ostaje `null`,
 * brojevi/stringovi/boolean idu kako jesu.
 */
export function toFormDataValue(result: EvaluationResult): ExpressionValue {
  return result.value;
}
