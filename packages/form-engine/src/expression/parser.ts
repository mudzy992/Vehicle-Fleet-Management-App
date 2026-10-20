/**
 * Lexer + parser za sigurne izraze (docs/04-FORM_ENGINE.md §6.1).
 *
 * 🔴 **Nijedan put u ovom fajlu ne koristi `eval`, `new Function`, `import` ni
 * `require`.** Izraz se prevodi u zatvoreni AST; sve što nije u gramatici ispod
 * se odbija pri parsiranju, prije bilo kakvog izvršavanja.
 *
 * ```
 * expression  := orExpr
 * orExpr      := andExpr ( "||" andExpr )*
 * andExpr     := cmpExpr ( "&&" cmpExpr )*
 * cmpExpr     := addExpr ( ( "==" | "!=" | ">" | ">=" | "<" | "<=" ) addExpr )?
 * addExpr     := mulExpr ( ( "+" | "-" ) mulExpr )*
 * mulExpr     := unary   ( ( "*" | "/" | "%" ) unary )*
 * unary       := ( "-" | "!" )? primary
 * primary     := NUMBER | STRING | BOOLEAN | NULL | IDENT | funcCall | "(" expression ")"
 * funcCall    := IDENT "(" ( expression ( "," expression )* )? ")"
 * ```
 */

/** Tvrdi limiti iz docs/04 §6.3 — prekoračenje se odbija pri parsiranju. */
export const EXPRESSION_LIMITS = {
  /** Maksimalna dužina izraza u znakovima. */
  maxLength: 500,
  /** Maksimalna dubina AST-a. */
  maxDepth: 10,
  /** Maksimalan broj čvorova AST-a. */
  maxNodes: 200,
  /** Maksimalan broj poziva funkcija. */
  maxFunctionCalls: 50,
} as const;

/** Vrsta vrijednosti koju čvor daje (runtime tipovi iz §6.3). */
export type ValueType = 'number' | 'string' | 'boolean' | 'null' | 'date';

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'TRUE'
  | 'FALSE'
  | 'NULL'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF';

export interface Token {
  readonly type: TokenType;
  /** Sirova vrijednost: broj za NUMBER, tekst za STRING/IDENT, operator za OPERATOR. */
  readonly value: string;
  /** Numerička vrijednost za NUMBER. */
  readonly numeric?: number;
  /** Pozicija u izvoru (za poruke o grešci). */
  readonly position: number;
}

/** Kodovi grešaka izraza — mapiraju se na `422` odgovore API-ja. */
export const EXPRESSION_ERROR_CODES = [
  'EMPTY_EXPRESSION',
  'EXPRESSION_TOO_LONG',
  'UNEXPECTED_CHARACTER',
  'UNTERMINATED_STRING',
  'UNEXPECTED_TOKEN',
  'UNEXPECTED_END',
  'TOO_DEEP',
  'TOO_MANY_NODES',
  'TOO_MANY_CALLS',
  'UNKNOWN_FUNCTION',
  'WRONG_ARITY',
  'INVALID_ARGUMENT',
  'UNKNOWN_FIELD',
  'TYPE_ERROR',
  'DIVISION_BY_ZERO',
  'COMPUTED_TIMEOUT',
  'RESULT_TYPE_MISMATCH',
  'NOT_EVALUABLE',
] as const;

export type ExpressionErrorCode = (typeof EXPRESSION_ERROR_CODES)[number];

/** Greška izraza (parser, statička provjera ili evaluacija). */
export class ExpressionError extends Error {
  constructor(
    readonly code: ExpressionErrorCode,
    message: string,
    readonly position?: number,
  ) {
    super(position === undefined ? message : `${message} (pozicija ${position})`);
    this.name = 'ExpressionError';
  }
}

// ---------------------------------------------------------------------------
//  AST
// ---------------------------------------------------------------------------

export interface LiteralNode {
  readonly kind: 'literal';
  readonly value: string | number | boolean | null;
}

export interface FieldNode {
  readonly kind: 'field';
  readonly name: string;
}

export interface UnaryNode {
  readonly kind: 'unary';
  readonly op: '-' | '!';
  readonly operand: AstNode;
}

export type BinaryOperator =
  '||' | '&&' | '==' | '!=' | '>' | '>=' | '<' | '<=' | '+' | '-' | '*' | '/' | '%';

export interface BinaryNode {
  readonly kind: 'binary';
  readonly op: BinaryOperator;
  readonly left: AstNode;
  readonly right: AstNode;
}

export interface CallNode {
  readonly kind: 'call';
  readonly name: string;
  readonly args: readonly AstNode[];
}

export type AstNode = LiteralNode | FieldNode | UnaryNode | BinaryNode | CallNode;

/** Rezultat parsiranja: AST + brojila (za limite i dijagnostiku). */
export interface ParsedExpression {
  readonly ast: AstNode;
  readonly source: string;
  readonly nodeCount: number;
  readonly functionCalls: number;
  readonly depth: number;
  /** Nazivi svih polja na koje se izraz referencira (za provjeru pri objavi). */
  readonly fieldRefs: readonly string[];
  /** Nazivi svih pozvanih funkcija (za provjeru whitelist-a). */
  readonly functionRefs: readonly string[];
}

const TWO_CHAR_OPERATORS = ['||', '&&', '==', '!=', '>=', '<='] as const;
const ONE_CHAR_OPERATORS = ['+', '-', '*', '/', '%', '>', '<', '!'] as const;

const KEYWORDS: Readonly<Record<string, TokenType>> = {
  true: 'TRUE',
  false: 'FALSE',
  null: 'NULL',
};

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/u.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/u.test(char);
}

/**
 * Tokenizacija. Odbija sve što nije u gramatici: `;`, komentare, `[`, `]`, `.`,
 * `{`, `}`, `?`, `:`, `&`, `|`, backtick, itd. Time se `a.b`, `a[0]`,
 * `a = 1` i slično ne mogu ni parsirati (zabrana iz §6.3).
 */
export function tokenize(source: string): Token[] {
  if (source.trim().length === 0) {
    throw new ExpressionError('EMPTY_EXPRESSION', 'Izraz je prazan.');
  }
  if (source.length > EXPRESSION_LIMITS.maxLength) {
    throw new ExpressionError(
      'EXPRESSION_TOO_LONG',
      `Izraz ima ${source.length} znakova, a maksimum je ${EXPRESSION_LIMITS.maxLength}.`,
    );
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }

    // Broj: 12, 12.5, .5 nije dozvoljeno (mora početi cifrom)
    if (isDigit(char)) {
      const start = index;
      while (index < source.length && isDigit(source[index] as string)) index += 1;
      if (source[index] === '.') {
        index += 1;
        if (!isDigit(source[index] ?? '')) {
          throw new ExpressionError('UNEXPECTED_CHARACTER', 'Nakon decimalne tačke ide cifra.', index);
        }
        while (index < source.length && isDigit(source[index] as string)) index += 1;
      }
      // Eksponent nije dozvoljen (1e5) — odbija se kao neočekivan znak `e`.
      const raw = source.slice(start, index);
      tokens.push({ type: 'NUMBER', value: raw, numeric: Number(raw), position: start });
      continue;
    }

    // String: samo dvostruki navodnici, bez escape sekvenci (definicija je JSON,
    // pa se navodnici u tekstu rješavaju JSON escape-om prije parsiranja).
    if (char === '"') {
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index] as string;
        if (current === '\\') {
          const next = source[index + 1];
          if (next === undefined) break;
          // Dozvoljeni escape-ovi: \" \\ \n \t
          const map: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };
          const decoded = map[next];
          if (decoded === undefined) {
            throw new ExpressionError(
              'UNEXPECTED_CHARACTER',
              `Escape sekvenca \\${next} nije dozvoljena.`,
              index,
            );
          }
          value += decoded;
          index += 2;
          continue;
        }
        if (current === '"') {
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        throw new ExpressionError('UNTERMINATED_STRING', 'String nije zatvoren.', start);
      }
      tokens.push({ type: 'STRING', value, position: start });
      continue;
    }

    // Identifikator ili ključna riječ
    if (isIdentifierStart(char)) {
      const start = index;
      while (index < source.length && isIdentifierPart(source[index] as string)) index += 1;
      const raw = source.slice(start, index);
      const keyword = KEYWORDS[raw];
      if (keyword) {
        tokens.push({ type: keyword, value: raw, position: start });
      } else {
        tokens.push({ type: 'IDENT', value: raw, position: start });
      }
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'COMMA', value: char, position: index });
      index += 1;
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if ((TWO_CHAR_OPERATORS as readonly string[]).includes(twoChar)) {
      tokens.push({ type: 'OPERATOR', value: twoChar, position: index });
      index += 2;
      continue;
    }

    if ((ONE_CHAR_OPERATORS as readonly string[]).includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char, position: index });
      index += 1;
      continue;
    }

    // `;`, `.`, `[`, `]`, `=`, `&`, `|`, komentari (`/` je operator, `//` se
    // odbija jer nakon `/` slijedi `/` što nije početak izraza)…
    throw new ExpressionError('UNEXPECTED_CHARACTER', `Znak "${char}" nije dozvoljen u izrazu.`, index);
  }

  tokens.push({ type: 'EOF', value: '', position: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
//  Parser (precedence climbing)
// ---------------------------------------------------------------------------

class Parser {
  private index = 0;
  private nodeCount = 0;
  private functionCalls = 0;
  private depth = 0;
  private maxDepthReached = 0;
  private readonly fields = new Set<string>();
  private readonly functions = new Set<string>();

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
  ) {}

  parse(): ParsedExpression {
    const ast = this.parseOr();
    const token = this.peek();
    if (token.type !== 'EOF') {
      throw new ExpressionError('UNEXPECTED_TOKEN', `Neočekivan token "${token.value}".`, token.position);
    }
    return {
      ast,
      source: this.source,
      nodeCount: this.nodeCount,
      functionCalls: this.functionCalls,
      depth: this.maxDepthReached,
      fieldRefs: [...this.fields],
      functionRefs: [...this.functions],
    };
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private matchOperator(...operators: readonly string[]): string | undefined {
    const token = this.peek();
    if (token.type === 'OPERATOR' && operators.includes(token.value)) {
      this.advance();
      return token.value;
    }
    return undefined;
  }

  private countNode(node: AstNode): AstNode {
    this.nodeCount += 1;
    if (this.nodeCount > EXPRESSION_LIMITS.maxNodes) {
      throw new ExpressionError('TOO_MANY_NODES', `Izraz ima više od ${EXPRESSION_LIMITS.maxNodes} čvorova.`);
    }
    return node;
  }

  private enter(): void {
    this.depth += 1;
    this.maxDepthReached = Math.max(this.maxDepthReached, this.depth);
    if (this.depth > EXPRESSION_LIMITS.maxDepth) {
      throw new ExpressionError('TOO_DEEP', `Izraz je dublji od ${EXPRESSION_LIMITS.maxDepth} nivoa.`);
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  private parseOr(): AstNode {
    this.enter();
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      const right = this.parseAnd();
      left = this.countNode({ kind: 'binary', op: '||', left, right });
    }
    this.leave();
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseComparison();
    while (this.matchOperator('&&')) {
      const right = this.parseComparison();
      left = this.countNode({ kind: 'binary', op: '&&', left, right });
    }
    return left;
  }

  private parseComparison(): AstNode {
    const left = this.parseAdditive();
    const operator = this.matchOperator('==', '!=', '>=', '<=', '>', '<');
    if (!operator) return left;
    const right = this.parseAdditive();
    // Lančana poređenja (`a < b < c`) nisu u gramatici — odbijaju se.
    const next = this.peek();
    if (next.type === 'OPERATOR' && ['==', '!=', '>=', '<=', '>', '<'].includes(next.value)) {
      throw new ExpressionError(
        'UNEXPECTED_TOKEN',
        'Lančano poređenje nije dozvoljeno — koristite `&&` (' + next.value + ').',
        next.position,
      );
    }
    return this.countNode({ kind: 'binary', op: operator as BinaryOperator, left, right });
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const operator = this.matchOperator('+', '-');
      if (!operator) return left;
      const right = this.parseMultiplicative();
      left = this.countNode({ kind: 'binary', op: operator as BinaryOperator, left, right });
    }
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    for (;;) {
      const operator = this.matchOperator('*', '/', '%');
      if (!operator) return left;
      const right = this.parseUnary();
      left = this.countNode({ kind: 'binary', op: operator as BinaryOperator, left, right });
    }
  }

  private parseUnary(): AstNode {
    const operator = this.matchOperator('-', '!');
    if (!operator) return this.parsePrimary();
    this.enter();
    const operand = this.parseUnary();
    this.leave();
    return this.countNode({ kind: 'unary', op: operator as '-' | '!', operand });
  }

  private parsePrimary(): AstNode {
    const token = this.peek();

    switch (token.type) {
      case 'NUMBER':
        this.advance();
        return this.countNode({ kind: 'literal', value: token.numeric as number });
      case 'STRING':
        this.advance();
        return this.countNode({ kind: 'literal', value: token.value });
      case 'TRUE':
        this.advance();
        return this.countNode({ kind: 'literal', value: true });
      case 'FALSE':
        this.advance();
        return this.countNode({ kind: 'literal', value: false });
      case 'NULL':
        this.advance();
        return this.countNode({ kind: 'literal', value: null });
      case 'LPAREN': {
        this.advance();
        this.enter();
        const inner = this.parseOr();
        this.leave();
        const closing = this.peek();
        if (closing.type !== 'RPAREN') {
          throw new ExpressionError('UNEXPECTED_TOKEN', 'Nedostaje zatvorena zagrada.', closing.position);
        }
        this.advance();
        return inner;
      }
      case 'IDENT': {
        this.advance();
        if (this.peek().type === 'LPAREN') {
          return this.parseCall(token);
        }
        this.fields.add(token.value);
        return this.countNode({ kind: 'field', name: token.value });
      }
      case 'EOF':
        throw new ExpressionError('UNEXPECTED_END', 'Izraz neočekivano završava.', token.position);
      default:
        throw new ExpressionError('UNEXPECTED_TOKEN', `Neočekivan token "${token.value}".`, token.position);
    }
  }

  private parseCall(nameToken: Token): AstNode {
    this.advance(); // (
    this.functions.add(nameToken.value);
    this.functionCalls += 1;
    if (this.functionCalls > EXPRESSION_LIMITS.maxFunctionCalls) {
      throw new ExpressionError(
        'TOO_MANY_CALLS',
        `Izraz ima više od ${EXPRESSION_LIMITS.maxFunctionCalls} poziva funkcija.`,
      );
    }

    const args: AstNode[] = [];
    if (this.peek().type === 'RPAREN') {
      this.advance();
      return this.countNode({ kind: 'call', name: nameToken.value, args });
    }

    this.enter();
    for (;;) {
      args.push(this.parseOr());
      const separator = this.peek();
      if (separator.type === 'COMMA') {
        this.advance();
        continue;
      }
      if (separator.type === 'RPAREN') {
        this.advance();
        break;
      }
      throw new ExpressionError(
        'UNEXPECTED_TOKEN',
        `Nedostaje "," ili ")" u pozivu ${nameToken.value}().`,
        separator.position,
      );
    }
    this.leave();

    return this.countNode({ kind: 'call', name: nameToken.value, args });
  }
}

/**
 * Parsira izraz u AST. Baca {@link ExpressionError} za sve što nije u
 * gramatici (uključujući prekoračenje limita iz §6.3).
 */
export function parseExpression(source: string): ParsedExpression {
  const tokens = tokenize(source);
  return new Parser(tokens, source).parse();
}

/** Dubina stabla (za testove i dijagnostiku). */
export function astDepth(node: AstNode): number {
  switch (node.kind) {
    case 'literal':
    case 'field':
      return 1;
    case 'unary':
      return 1 + astDepth(node.operand);
    case 'binary':
      return 1 + Math.max(astDepth(node.left), astDepth(node.right));
    case 'call':
      return 1 + Math.max(0, ...node.args.map((arg) => astDepth(arg)));
    default:
      return 1;
  }
}
