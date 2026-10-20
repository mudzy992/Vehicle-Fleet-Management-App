import { describe, expect, it } from 'vitest';
import { ExpressionError, evaluateExpression, type EvaluationContext } from '../src/index.js';

const TODAY = '2026-10-20';

function ctx(
  values: Record<string, unknown> = {},
  extra: Partial<EvaluationContext> = {},
): EvaluationContext {
  return { values, today: TODAY, ...extra };
}

function value(source: string, values: Record<string, unknown> = {}): unknown {
  return evaluateExpression(source, ctx(values)).value;
}

function errorOf(source: string, values: Record<string, unknown> = {}): ExpressionError {
  try {
    evaluateExpression(source, ctx(values));
  } catch (error) {
    expect(error).toBeInstanceOf(ExpressionError);
    return error as ExpressionError;
  }
  throw new Error(`Očekivana je greška za: ${source}`);
}

describe('evaluator — primjer iz dokumentacije (§2)', () => {
  it('izračuna cijenu po minuti uz zaštitu od dijeljenja nulom', () => {
    const source = 'if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)';

    expect(value(source, { washDurationMin: 30, washCost: 9000 })).toBe(300);
    expect(value(source, { washDurationMin: 45, washCost: 10000 })).toBe(222.22);
    // Zaštita radi: nula ne izaziva grešku nego vraća 0.
    expect(value(source, { washDurationMin: 0, washCost: 9000 })).toBe(0);
    expect(value(source, { washDurationMin: null, washCost: 9000 })).toBe(0);
  });
});

describe('evaluator — aritmetika i logika', () => {
  it('računa osnovne operatore s prioritetom', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('10 / 4')).toBe(2.5);
    expect(value('10 % 3')).toBe(1);
    expect(value('-5 + 2')).toBe(-3);
  });

  it('short-circuit: desna strana se ne evaluira kad ishod ne zavisi od nje', () => {
    expect(value('false && unknownField > 0')).toBe(false);
    expect(value('true || unknownField > 0')).toBe(true);
    expect(value('true && 1 == 1')).toBe(true);
  });

  it('poredi brojeve, tekstove, datume i boolean', () => {
    expect(value('"abc" < "abd"')).toBe(true);
    expect(value('"2026-01-01" < "2026-12-31"')).toBe(true);
    expect(value('true == true')).toBe(true);
    expect(value('5 >= 5')).toBe(true);
    expect(value('"a" != "b"')).toBe(true);
  });

  it('null (nepopunjeno polje) ne ruši izraz', () => {
    const values = { odometerKm: null };

    expect(value('odometerKm + 1', values)).toBeNull();
    expect(value('odometerKm > 100', values)).toBe(false);
    expect(value('odometerKm == null', values)).toBe(true);
    expect(value('odometerKm != null', values)).toBe(false);
    expect(value('coalesce(odometerKm, 0) + 1', values)).toBe(1);
  });

  it('MONEY polje ({amount, currency}) koristi iznos u feninzima', () => {
    expect(value('washCost / 100', { washCost: { amount: 9000, currency: 'BAM' } })).toBe(90);
  });
});

describe('evaluator — whitelist funkcija (§6.2)', () => {
  it('matematičke', () => {
    expect(value('round(2.345, 2)')).toBe(2.35);
    expect(value('round(2.5)')).toBe(3);
    expect(value('floor(2.9)')).toBe(2);
    expect(value('ceil(2.1)')).toBe(3);
    expect(value('abs(-4)')).toBe(4);
    expect(value('min(3, 1, 2)')).toBe(1);
    expect(value('max(3, 1, 2)')).toBe(3);
    expect(value('sum(1, 2, 3)')).toBe(6);
    expect(value('avg(2, 4)')).toBe(3);
    expect(value('clamp(15, 0, 10)')).toBe(10);
    expect(value('clamp(-5, 0, 10)')).toBe(0);
  });

  it('logičke', () => {
    expect(value('and(true, false)')).toBe(false);
    expect(value('or(false, true)')).toBe(true);
    expect(value('not(false)')).toBe(true);
    expect(value('if(1 > 2, "a", "b")')).toBe('b');
    expect(value('coalesce(null, null, "x")')).toBe('x');
  });

  it('datumske (UTC, ISO stringovi)', () => {
    expect(value('today()')).toBe(TODAY);
    expect(value('daysBetween("2026-01-01", "2026-10-20")')).toBe(292);
    expect(value('daysBetween("2026-10-20", "2026-10-01")')).toBe(-19);
    expect(value('monthsBetween("2026-01-15", "2026-10-20")')).toBe(9);
    expect(value('year("2026-10-20")')).toBe(2026);
    expect(value('month("2026-10-20")')).toBe(10);
    expect(value('day("2026-10-20")')).toBe(20);
    expect(value('addDays("2026-10-20", 15)')).toBe('2026-11-04');
    expect(value('addDays("2026-01-01", -1)')).toBe('2025-12-31');
    expect(value('daysBetween("2026-02-28", "2026-03-01")')).toBe(1);
  });

  it('tekstualne', () => {
    expect(value('len("abc")')).toBe(3);
    expect(value('upper("abc")')).toBe('ABC');
    expect(value('lower("ABC")')).toBe('abc');
    expect(value('concat("a", "-", "b")')).toBe('a-b');
    expect(value('concat("a", null, "b")')).toBe('ab');
  });

  it('domenske', () => {
    expect(value('kmDiff(1000, 1500)')).toBe(500);
    expect(value('fenToKm(9000)')).toBe(90);
    expect(value('kmToFen(90.5)')).toBe(9050);
    expect(value('l100km(45, 600)')).toBe(7.5);
    // Nula kilometara nije greška — vraća se null (nema smislen rezultat).
    expect(value('l100km(45, 0)')).toBeNull();
  });
});

describe('evaluator — sigurnost i greške', () => {
  it('nepoznata funkcija se odbija (nema pristupa runtime-u)', () => {
    expect(errorOf('eval("1+1")').code).toBe('UNKNOWN_FUNCTION');
    expect(errorOf('require("fs")').code).toBe('UNKNOWN_FUNCTION');
    expect(errorOf('process.exit(1)').code).toBe('UNEXPECTED_CHARACTER');
  });

  it('pogrešan broj argumenata i tipovi', () => {
    expect(errorOf('round()').code).toBe('WRONG_ARITY');
    expect(errorOf('round(1, 2, 3)').code).toBe('WRONG_ARITY');
    expect(errorOf('min()').code).toBe('WRONG_ARITY');
    expect(errorOf('round("x")').code).toBe('TYPE_ERROR');
    expect(errorOf('upper(5)').code).toBe('TYPE_ERROR');
    expect(errorOf('daysBetween("nije-datum", "2026-01-01")').code).toBe('INVALID_ARGUMENT');
    expect(errorOf('if(1, 2, 3)').code).toBe('TYPE_ERROR');
    expect(errorOf('not(1)').code).toBe('TYPE_ERROR');
  });

  it('miješanje tipova u aritmetici je greška (nema implicitne konverzije)', () => {
    expect(errorOf('1 + "2"').code).toBe('TYPE_ERROR');
    expect(errorOf('true + 1').code).toBe('TYPE_ERROR');
    expect(errorOf('-"a"').code).toBe('TYPE_ERROR');
    expect(errorOf('"a" > 1').code).toBe('TYPE_ERROR');
    expect(errorOf('true > false').code).toBe('TYPE_ERROR');
    expect(errorOf('!5').code).toBe('TYPE_ERROR');
  });

  it('dijeljenje nulom je greška (kad nije zaštićeno)', () => {
    expect(errorOf('10 / 0').code).toBe('DIVISION_BY_ZERO');
    expect(errorOf('10 % 0').code).toBe('DIVISION_BY_ZERO');
    expect(errorOf('10 / (2 - 2)').code).toBe('DIVISION_BY_ZERO');
  });

  it('today() bez serverskog datuma se odbija', () => {
    expect(() => evaluateExpression('today()', { values: {} })).toThrow(ExpressionError);
    try {
      evaluateExpression('today()', { values: {} });
    } catch (error) {
      expect((error as ExpressionError).code).toBe('NOT_EVALUABLE');
    }
  });

  it('prekoračenje vremena se odbija (COMPUTED_TIMEOUT)', () => {
    try {
      evaluateExpression('1 + 1', { values: {}, timeoutMs: -1 });
      throw new Error('trebalo je baciti');
    } catch (error) {
      expect((error as ExpressionError).code).toBe('COMPUTED_TIMEOUT');
    }
  });

  it('vraća tip rezultata (za `resultType` provjeru)', () => {
    expect(evaluateExpression('1 + 1', ctx()).type).toBe('number');
    expect(evaluateExpression('"a"', ctx()).type).toBe('string');
    expect(evaluateExpression('"2026-10-20"', ctx()).type).toBe('date');
    expect(evaluateExpression('true', ctx()).type).toBe('boolean');
    expect(evaluateExpression('null', ctx()).type).toBe('null');
  });
});
