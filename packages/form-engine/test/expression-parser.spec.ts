import { describe, expect, it } from 'vitest';
import {
  EXPRESSION_LIMITS,
  ExpressionError,
  astDepth,
  parseExpression,
  printAst,
  tokenize,
} from '../src/index.js';

function errorOf(fn: () => unknown): ExpressionError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpressionError);
    return error as ExpressionError;
  }
  throw new Error('Očekivana je ExpressionError.');
}

describe('lexer (docs/04 §6.1)', () => {
  it('prepoznaje brojeve, tekst, identifikatore i ključne riječi', () => {
    const tokens = tokenize('washCost > 12.5 && true != null');

    expect(tokens.map((token) => token.type)).toEqual([
      'IDENT',
      'OPERATOR',
      'NUMBER',
      'OPERATOR',
      'TRUE',
      'OPERATOR',
      'NULL',
      'EOF',
    ]);
    expect(tokens[2]?.numeric).toBe(12.5);
  });

  it('odbija sve što nije u gramatici (bez izuzetka)', () => {
    // Svaki od ovih bi u JS-u bio izvršiv — ovdje ne smije ni proći lexer.
    for (const source of [
      'a.b',
      'a[0]',
      'a = 1',
      '1; 2',
      'obj.prop',
      'x ? 1 : 2',
      'a & b',
      'a | b',
      '`x`',
      'a // komentar',
      '/* x */ 1',
      '1e5',
      '$x',
      'π',
    ]) {
      // `1e5` prolazi lexer (broj + identifikator), ali ne i parser — zato se
      // ovdje provjerava cijeli put do AST-a, ne samo tokenizacija.
      const error = errorOf(() => parseExpression(source));
      expect(['UNEXPECTED_CHARACTER', 'UNEXPECTED_TOKEN'], source).toContain(error.code);
    }
  });

  it('dozvoljava escape sekvence u tekstu, ali ne proizvoljne', () => {
    expect(tokenize('"a\\"b"')[0]?.value).toBe('a"b');
    expect(tokenize('"a\\nb"')[0]?.value).toBe('a\nb');

    expect(errorOf(() => tokenize('"a\\qb"')).code).toBe('UNEXPECTED_CHARACTER');
    expect(errorOf(() => tokenize('"nezatvoren')).code).toBe('UNTERMINATED_STRING');
  });

  it('odbija prazan izraz i predugačak izraz', () => {
    expect(errorOf(() => tokenize('   ')).code).toBe('EMPTY_EXPRESSION');
    expect(errorOf(() => tokenize('1'.repeat(EXPRESSION_LIMITS.maxLength + 1))).code).toBe(
      'EXPRESSION_TOO_LONG',
    );
  });
});

describe('parser (docs/04 §6.1)', () => {
  it('poštuje prioritet operatora (množenje prije sabiranja)', () => {
    expect(printAst(parseExpression('1 + 2 * 3').ast)).toBe('(1+(2*3))');
    expect(printAst(parseExpression('(1 + 2) * 3').ast)).toBe('((1+2)*3)');
    expect(printAst(parseExpression('1 - 2 - 3').ast)).toBe('((1-2)-3)');
  });

  it('poštuje prioritet poređenja i logičkih operatora', () => {
    expect(printAst(parseExpression('a > 1 && b < 2 || c == 3').ast)).toBe('(((a>1)&&(b<2))||(c==3))');
  });

  it('parsira ugniježđene pozive funkcija i broji reference', () => {
    const parsed = parseExpression('if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)');

    expect([...parsed.fieldRefs].sort()).toEqual(['washCost', 'washDurationMin']);
    expect([...parsed.functionRefs].sort()).toEqual(['if', 'round']);
    expect(parsed.functionCalls).toBe(2);
    expect(astDepth(parsed.ast)).toBeGreaterThan(3);
  });

  it('odbija lančano poređenje (a < b < c nije u gramatici)', () => {
    expect(errorOf(() => parseExpression('1 < 2 < 3')).code).toBe('UNEXPECTED_TOKEN');
  });

  it('odbija prazne i nezatvorene zagrade', () => {
    expect(errorOf(() => parseExpression('()')).code).toBe('UNEXPECTED_TOKEN');
    expect(errorOf(() => parseExpression('(1')).code).toBe('UNEXPECTED_TOKEN');
  });

  it('odbija prekoračenje limita: dubina, čvorovi, pozivi', () => {
    const deep = `${'('.repeat(12)}1${')'.repeat(12)}`;
    expect(errorOf(() => parseExpression(deep)).code).toBe('TOO_DEEP');

    const manyNodes = Array.from({ length: 120 }, () => '1').join('+');
    expect(errorOf(() => parseExpression(manyNodes)).code).toBe('TOO_MANY_NODES');

    const manyCalls = Array.from({ length: 51 }, () => 'abs(1)').join('+');
    expect(errorOf(() => parseExpression(manyCalls)).code).toBe('TOO_MANY_CALLS');
  });

  it('funkcija bez argumenata je dozvoljena (today())', () => {
    const parsed = parseExpression('today()');

    expect(parsed.functionCalls).toBe(1);
    expect(astDepth(parsed.ast)).toBe(1);
  });
});
