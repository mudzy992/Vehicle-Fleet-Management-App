import { describe, expect, it } from 'vitest';
import {
  assertExpression,
  checkExpression,
  nonZeroProofs,
  parseExpression,
  printAst,
  type FieldTypeMap,
} from '../src/index.js';

const TYPES: FieldTypeMap = {
  washDurationMin: 'number',
  washCost: 'money',
  washType: 'string',
  photosAfter: 'unusable',
  isCompanyCar: 'boolean',
  dueDate: 'date',
  costPerMinute: 'number',
};

function codes(source: string, expectedResultType?: string): string[] {
  return checkExpression(source, TYPES, expectedResultType).issues.map((issue) => issue.code);
}

describe('statička provjera izraza (docs/04 §6.3)', () => {
  it('prihvata primjer iz dokumentacije', () => {
    const result = checkExpression(
      'if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)',
      TYPES,
      'DECIMAL',
    );

    expect(result.ok).toBe(true);
    expect(result.resultType).toBe('number');
    expect([...result.fieldRefs].sort()).toEqual(['washCost', 'washDurationMin']);
    expect(result.functionRefs).toEqual(['if', 'round']);
  });

  it('nepostojeće polje → UNKNOWN_FIELD', () => {
    expect(codes('nepostojecePolje + 1')).toEqual(['UNKNOWN_FIELD']);
    expect(checkExpression('nepostojecePolje', TYPES).ok).toBe(false);
  });

  it('polje koje se ne može koristiti u izrazima → TYPE_ERROR', () => {
    expect(codes('photosAfter == null')).toEqual(['TYPE_ERROR']);
  });

  it('nepoznata funkcija i pogrešan broj argumenata', () => {
    expect(codes('eval("x")')).toEqual(['UNKNOWN_FUNCTION']);
    expect(codes('round()')).toEqual(['WRONG_ARITY']);
    expect(codes('round(1, 2, 3)')).toEqual(['WRONG_ARITY']);
  });

  it('nesklad tipova → TYPE_ERROR', () => {
    expect(codes('upper(washCost)')).toEqual(['TYPE_ERROR']);
    expect(codes('washType + 1')).toEqual(['TYPE_ERROR']);
    expect(codes('isCompanyCar > 1')).toEqual(['TYPE_ERROR']);
  });

  it('dijeljenje literalnom nulom → DIVISION_BY_ZERO', () => {
    expect(codes('washCost / 0')).toEqual(['DIVISION_BY_ZERO']);
    expect(codes('washCost % 0')).toEqual(['DIVISION_BY_ZERO']);
  });

  it('dijeljenje nenultim literalom je dozvoljeno', () => {
    expect(checkExpression('washCost / 3', TYPES, 'DECIMAL').ok).toBe(true);
    expect(checkExpression('washCost / 100', TYPES, 'DECIMAL').ok).toBe(true);
  });

  it('dijeljenje poljem je dozvoljeno SAMO uz dokaz da nije nula', () => {
    expect(codes('washCost / washDurationMin')).toEqual(['DIVISION_BY_ZERO']);

    for (const guard of ['> 0', '>= 1', '>= 0.5', '!= 0']) {
      const source = `if(washDurationMin ${guard}, washCost / washDurationMin, 0)`;
      expect(checkExpression(source, TYPES, 'DECIMAL').ok, guard).toBe(true);
    }

    // Obrnuti redoslijed i `&&` takođe dokazuju.
    expect(checkExpression('if(0 < washDurationMin, washCost / washDurationMin, 0)', TYPES).ok).toBe(true);
    expect(
      checkExpression('if(washDurationMin != 0 && washCost > 0, washCost / washDurationMin, 0)', TYPES).ok,
    ).toBe(true);
    // Dokaz važi samo u `then` grani — `else` grana nije zaštićena.
    expect(codes('if(washDurationMin > 0, 1, washCost / washDurationMin)')).toEqual(['DIVISION_BY_ZERO']);
  });

  it('nesklad rezultata s `resultType` → RESULT_TYPE_MISMATCH', () => {
    expect(codes('upper("a")', 'DECIMAL')).toEqual(['RESULT_TYPE_MISMATCH']);
    expect(codes('1 + 1', 'TEXT')).toEqual(['RESULT_TYPE_MISMATCH']);
    expect(codes('1 > 0', 'INTEGER')).toEqual(['RESULT_TYPE_MISMATCH']);
    expect(codes('1 + 1', 'NEPOZNAT')).toEqual(['RESULT_TYPE_MISMATCH']);

    expect(checkExpression('1 + 1', TYPES, 'INTEGER').ok).toBe(true);
    expect(checkExpression('washCost / 2', TYPES, 'MONEY').ok).toBe(true);
    expect(checkExpression('today()', TYPES, 'DATE').ok).toBe(true);
    expect(checkExpression('1 > 0', TYPES, 'BOOLEAN').ok).toBe(true);
  });

  it('greške parsiranja se vraćaju kao issue (ne bacaju)', () => {
    const result = checkExpression('a.b', TYPES);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('UNEXPECTED_CHARACTER');
    expect(result.fieldRefs).toEqual([]);
  });

  it('assertExpression baca na prvi problem, a vraća rezultat kad je ispravno', () => {
    expect(() => assertExpression('nepostojecePolje', TYPES)).toThrow(/ne postoji/u);
    expect(assertExpression('1 + 1', TYPES, 'INTEGER').resultType).toBe('number');
  });

  it('nonZeroProofs izvlači dokazane izraze iz uslova', () => {
    const proofs = nonZeroProofs(parseExpression('washDurationMin > 0 && washCost != 0').ast);

    expect([...proofs].sort()).toEqual([printAst(parseExpression('washCost').ast), 'washDurationMin'].sort());
    expect(nonZeroProofs(parseExpression('washDurationMin > -1').ast).size).toBe(0);
    expect(nonZeroProofs(parseExpression('washDurationMin == 0').ast).size).toBe(0);
  });
});
