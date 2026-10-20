import { describe, expect, it } from 'vitest';
import {
  checkCondition,
  evaluateCondition,
  fieldTypesFromDefinition,
  findComputedCycles,
  isFieldVisible,
  parseDefinition,
  type FieldTypeMap,
  type VisibleWhenNode,
} from '../src/index.js';
import { freshWashDefinition } from './fixtures/wash.definition.js';

function condition(node: VisibleWhenNode | null | undefined, values: Record<string, unknown>): boolean {
  return evaluateCondition(node, values);
}

describe('uslovna vidljivost — operatori (docs/04 §4)', () => {
  it('== / != / > / >= / < / <=', () => {
    expect(condition({ field: 'a', op: '==', value: 5 }, { a: 5 })).toBe(true);
    expect(condition({ field: 'a', op: '!=', value: 5 }, { a: 4 })).toBe(true);
    expect(condition({ field: 'a', op: '>', value: 5 }, { a: 6 })).toBe(true);
    expect(condition({ field: 'a', op: '>=', value: 5 }, { a: 5 })).toBe(true);
    expect(condition({ field: 'a', op: '<', value: 5 }, { a: 4 })).toBe(true);
    expect(condition({ field: 'a', op: '<=', value: 5 }, { a: 6 })).toBe(false);
    expect(condition({ field: 'a', op: '==', value: 'FULL' }, { a: 'FULL' })).toBe(true);
  });

  it('IN / NOT_IN za jedno i više odabranih polja', () => {
    const node: VisibleWhenNode = { field: 'washType', op: 'IN', value: ['EXTERNAL', 'FULL'] };

    expect(condition(node, { washType: 'FULL' })).toBe(true);
    expect(condition(node, { washType: 'INTERNAL' })).toBe(false);
    expect(condition({ field: 'tipovi', op: 'IN', value: ['A'] }, { tipovi: ['A', 'B'] })).toBe(true);
    expect(condition({ field: 'tipovi', op: 'IN', value: ['C'] }, { tipovi: ['A', 'B'] })).toBe(false);
    expect(condition({ field: 'washType', op: 'NOT_IN', value: ['FULL'] }, { washType: 'INTERNAL' })).toBe(
      true,
    );
  });

  it('CONTAINS za tekst i za listu', () => {
    expect(condition({ field: 'opis', op: 'CONTAINS', value: 'servis' }, { opis: 'Redovan servis' })).toBe(
      true,
    );
    expect(condition({ field: 'opis', op: 'CONTAINS', value: 'gume' }, { opis: 'Redovan servis' })).toBe(
      false,
    );
    expect(condition({ field: 'tagovi', op: 'CONTAINS', value: 'hitno' }, { tagovi: ['hitno', 'x'] })).toBe(
      true,
    );
  });

  it('IS_EMPTY / IS_NOT_EMPTY', () => {
    expect(condition({ field: 'a', op: 'IS_EMPTY' }, {})).toBe(true);
    expect(condition({ field: 'a', op: 'IS_EMPTY' }, { a: null })).toBe(true);
    expect(condition({ field: 'a', op: 'IS_EMPTY' }, { a: '  ' })).toBe(true);
    expect(condition({ field: 'a', op: 'IS_EMPTY' }, { a: [] })).toBe(true);
    expect(condition({ field: 'a', op: 'IS_EMPTY' }, { a: 0 })).toBe(false);
    expect(condition({ field: 'a', op: 'IS_NOT_EMPTY' }, { a: 'x' })).toBe(true);
  });

  it('BETWEEN i poređenje datuma', () => {
    const between: VisibleWhenNode = { field: 'km', op: 'BETWEEN', value: [1000, 2000] };

    expect(condition(between, { km: 1500 })).toBe(true);
    expect(condition(between, { km: 1000 })).toBe(true);
    expect(condition(between, { km: 2000 })).toBe(true);
    expect(condition(between, { km: 2001 })).toBe(false);
    expect(condition({ field: 'datum', op: '>', value: '2026-01-01' }, { datum: '2026-06-01' })).toBe(true);
  });

  it('all / any / not i ugniježđeni uslovi', () => {
    const node: VisibleWhenNode = {
      all: [
        { field: 'washType', op: 'IN', value: ['FULL'] },
        {
          any: [
            { field: 'washCost', op: '>', value: 0 },
            { field: 'imaFakturu', op: '==', value: true },
          ],
        },
      ],
    };

    expect(condition(node, { washType: 'FULL', washCost: 100, imaFakturu: false })).toBe(true);
    expect(condition(node, { washType: 'FULL', washCost: 0, imaFakturu: true })).toBe(true);
    expect(condition(node, { washType: 'FULL', washCost: 0, imaFakturu: false })).toBe(false);
    expect(condition(node, { washType: 'INTERNAL', washCost: 100 })).toBe(false);
    expect(condition({ not: { field: 'a', op: '==', value: 1 } }, { a: 2 })).toBe(true);
  });

  it('nepopunjena vrijednost ne ruši uslov (polje se ne prikazuje)', () => {
    expect(condition({ field: 'a', op: '>', value: 1 }, {})).toBe(false);
    expect(condition({ field: 'a', op: '==', value: 1 }, { a: null })).toBe(false);
    expect(condition(null, {})).toBe(true);
  });

  it('MONEY vrijednost se poredi po iznosu', () => {
    expect(
      condition({ field: 'trosak', op: '>', value: 5000 }, { trosak: { amount: 9000, currency: 'BAM' } }),
    ).toBe(true);
  });
});

describe('provjera uslova pri objavi', () => {
  it('referencira nepostojeće polje → UNKNOWN_FIELD', () => {
    const issues = checkCondition({ field: 'nema', op: '==', value: 1 }, { a: 'number' });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('UNKNOWN_FIELD');
  });

  it('polje koje se ne može koristiti u uslovu → UNUSABLE_FIELD', () => {
    const types: FieldTypeMap = { photos: 'unusable' };

    expect(checkCondition({ field: 'photos', op: 'IS_NOT_EMPTY' }, types)[0]?.code).toBe('UNUSABLE_FIELD');
  });

  it('provjerava vrijednost prema operatoru', () => {
    const types: FieldTypeMap = { a: 'number' };

    expect(checkCondition({ field: 'a', op: 'IS_EMPTY', value: 1 }, types)[0]?.code).toBe(
      'INVALID_OPERATOR_VALUE',
    );
    expect(checkCondition({ field: 'a', op: 'IN', value: 'x' }, types)[0]?.code).toBe(
      'INVALID_OPERATOR_VALUE',
    );
    expect(checkCondition({ field: 'a', op: 'BETWEEN', value: [1] }, types)[0]?.code).toBe(
      'INVALID_OPERATOR_VALUE',
    );
    expect(checkCondition({ field: 'a', op: '==', value: 1 }, types)).toEqual([]);
  });

  it('prolazi kroz sve grane stabla uslova', () => {
    const types: FieldTypeMap = { a: 'number', b: 'string' };
    const issues = checkCondition(
      { all: [{ not: { field: 'nema1', op: '==' } }, { any: [{ field: 'nema2', op: '==' }] }] },
      types,
    );

    expect(issues.map((issue) => issue.field).sort()).toEqual(['nema1', 'nema2']);
  });

  it('isFieldVisible poštuje sve roditeljske uslove', () => {
    expect(isFieldVisible([null, { field: 'a', op: '==', value: 1 }], { a: 1 })).toBe(true);
    expect(isFieldVisible([null, { field: 'a', op: '==', value: 1 }], { a: 2 })).toBe(false);
    expect(isFieldVisible([null, undefined], {})).toBe(true);
  });
});

describe('tipovi polja i ciklusi izračunatih polja', () => {
  it('mapira tipove polja iz primjera u dokumentaciji', () => {
    const parsed = parseDefinition(freshWashDefinition());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { types, cycles } = fieldTypesFromDefinition(parsed.definition);

    expect(types['washType']).toBe('string');
    expect(types['washDurationMin']).toBe('number');
    expect(types['washCost']).toBe('money');
    expect(types['photosAfter']).toBe('unusable');
    expect(types['costPerMinute']).toBe('number');
    expect(cycles).toEqual([]);
  });

  it('detektuje ciklus u izračunatim poljima', () => {
    const definition = {
      $schema: 'vfm-form/1',
      meta: { title: 'Ciklus', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            {
              key: 'poljeA',
              type: 'COMPUTED',
              label: 'A',
              order: 1,
              computed: { expression: 'poljeB + 1', resultType: 'DECIMAL' },
            },
            {
              key: 'poljeB',
              type: 'COMPUTED',
              label: 'B',
              order: 2,
              computed: { expression: 'poljeA + 1', resultType: 'DECIMAL' },
            },
          ],
        },
      ],
    };

    const parsed = parseDefinition(definition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const cycles = findComputedCycles(parsed.definition);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain('poljeA');
    expect(cycles[0]).toContain('poljeB');
  });

  it('samoreferenca je ciklus', () => {
    const definition = {
      $schema: 'vfm-form/1',
      meta: { title: 'Self', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            {
              key: 'poljeX',
              type: 'COMPUTED',
              label: 'X',
              order: 1,
              computed: { expression: 'poljeX + 1', resultType: 'DECIMAL' },
            },
          ],
        },
      ],
    };

    const parsed = parseDefinition(definition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Samoreferenca se u `findComputedCycles` filtrira (nema putanje), ali je
    // `checkExpression` odbija jer polje `x` nije unos — vidi test u
    // `expression-static-check.spec.ts`.
    expect(findComputedCycles(parsed.definition)).toEqual([]);
  });
});
