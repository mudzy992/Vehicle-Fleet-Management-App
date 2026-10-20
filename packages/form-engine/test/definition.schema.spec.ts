import { describe, expect, it } from 'vitest';
import {
  DEFINITION_LIMITS,
  checkPatternSafe,
  collectVisibleWhenFields,
  computedFields,
  findField,
  findUnknownValidationKeys,
  flattenFields,
  inputFields,
  parseDefinition,
  visibleWhenDepth,
} from '../dist/index.js';
import { freshWashDefinition, minimalDefinition } from './fixtures/wash.definition.js';

function firstIssue(input: unknown): { code: string; path: string; message: string } {
  const result = parseDefinition(input);
  if (result.ok) throw new Error('očekivana greška, a definicija je validna');
  const issue = result.issues[0];
  if (!issue) throw new Error('nema prijavljenih problema');
  return issue;
}

describe('meta-shema definicije (docs/04 §2–§5, §7)', () => {
  it('prihvata primjer iz dokumentacije bez izmjena', () => {
    const result = parseDefinition(freshWashDefinition());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.meta.title).toBe('Pranje vozila');
    expect(result.definition.sections).toHaveLength(2);
    expect(result.definition.layout?.columns).toBe(1);
  });

  it('popunjava defaultove (required/disabled/storeInFormData/visibleWhen)', () => {
    const result = parseDefinition(minimalDefinition());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const field = result.definition.sections[0]?.fields[0];
    expect(field).toMatchObject({
      key: 'napomena',
      required: false,
      disabled: false,
      visibleOnForm: true,
      storeInFormData: true,
      visibleWhen: null,
    });
  });

  it('odbija nepoznat ključ (shema je zatvorena)', () => {
    const issue = firstIssue({ ...minimalDefinition(), extra: true });

    expect(issue.code).toBe('unrecognized_keys');
  });

  it('odbija rezervisan fieldKey s kodom RESERVED_FIELD_KEY u poruci', () => {
    const definition = minimalDefinition();
    (definition['sections'] as { fields: { key: string }[] }[])[0]!.fields[0]!.key = 'status';

    const issue = firstIssue(definition);
    expect(issue.path).toBe('$.sections[0].fields[0].key');
    expect(issue.message).toContain('rezervisan');
  });

  it('odbija neispravan format fieldKey', () => {
    const definition = minimalDefinition();
    (definition['sections'] as { fields: { key: string }[] }[])[0]!.fields[0]!.key = 'Odometer.Km';

    expect(firstIssue(definition).message).toContain('^[a-z]');
  });

  it('odbija dupli fieldKey u istoj formi (jedan JSONB objekat)', () => {
    const definition = {
      $schema: 'vfm-form/1',
      meta: { title: 'Duplo', subject: 'TASK' },
      sections: [
        {
          key: 'prva',
          title: 'Prva',
          order: 1,
          fields: [{ key: 'isti', type: 'TEXT', label: 'A', order: 1 }],
        },
        {
          key: 'druga',
          title: 'Druga',
          order: 2,
          fields: [{ key: 'isti', type: 'TEXT', label: 'B', order: 1 }],
        },
      ],
    };

    expect(firstIssue(definition).message).toContain('se ponavlja u formi');
  });

  it('zahtijeva optionsSource za izborna polja i zabranjuje ga drugima', () => {
    const bezOpcija = {
      $schema: 'vfm-form/1',
      meta: { title: 'Bez opcija', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [{ key: 'vrsta', type: 'DROPDOWN', label: 'Vrsta', order: 1 }],
        },
      ],
    };
    expect(firstIssue(bezOpcija).message).toContain('zahtijeva optionsSource');

    const visak = minimalDefinition();
    (visak['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['optionsSource'] = {
      kind: 'STATIC',
      items: [{ value: 'A', label: 'A' }],
    };
    expect(firstIssue(visak).message).toContain('ne podržava optionsSource');
  });

  it('odbija duple vrijednosti u STATIC opcijama', () => {
    const definition = {
      $schema: 'vfm-form/1',
      meta: { title: 'Opcije', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            {
              key: 'vrsta',
              type: 'SINGLE_CHOICE',
              label: 'Vrsta',
              order: 1,
              optionsSource: {
                kind: 'STATIC',
                items: [
                  { value: 'A', label: 'Prva' },
                  { value: 'A', label: 'Druga' },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(firstIssue(definition).message).toContain('Dupla vrijednost');
  });

  it('QUERY izvor prima samo whitelist queryId (nikad slobodan SQL)', () => {
    const valid = {
      $schema: 'vfm-form/1',
      meta: { title: 'Upit', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            {
              key: 'vozilo',
              type: 'DROPDOWN',
              label: 'Vozilo',
              order: 1,
              optionsSource: { kind: 'QUERY', queryId: 'ACTIVE_VEHICLES' },
            },
          ],
        },
      ],
    };
    expect(parseDefinition(valid).ok).toBe(true);

    (
      valid['sections'] as { fields: { optionsSource: Record<string, unknown> }[] }[]
    )[0]!.fields[0]!.optionsSource = { kind: 'QUERY', queryId: 'SELECT * FROM User' };
    expect(parseDefinition(valid).ok).toBe(false);
  });

  it('COMPUTED zahtijeva izraz i ne može biti required', () => {
    const bezIzraza = {
      $schema: 'vfm-form/1',
      meta: { title: 'Bez izraza', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [{ key: 'zbir', type: 'COMPUTED', label: 'Zbir', order: 1 }],
        },
      ],
    };
    expect(firstIssue(bezIzraza).message).toContain('computed.expression');

    const required = {
      ...bezIzraza,
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            {
              key: 'zbir',
              type: 'COMPUTED',
              label: 'Zbir',
              order: 1,
              required: true,
              computed: { expression: '1 + 1', resultType: 'INTEGER' },
            },
          ],
        },
      ],
    };
    expect(firstIssue(required).message).toContain('ne može biti `required`');
  });

  it('odbija validacijski ključ koji ne pripada tipu polja', () => {
    const definition = minimalDefinition();
    (definition['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['validation'] = {
      minFiles: 2,
    };

    expect(firstIssue(definition).message).toContain('Nedozvoljeni validacijski ključevi');
    expect(findUnknownValidationKeys('TEXT', { minFiles: 2 })).toEqual(['minFiles']);
    expect(findUnknownValidationKeys('PHOTO', { minFiles: 2 })).toEqual([]);
  });

  it('odbija min > max i neispravan precision', () => {
    const minMax = minimalDefinition();
    (minMax['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['type'] = 'INTEGER';
    (minMax['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['validation'] = {
      min: 10,
      max: 1,
    };
    expect(firstIssue(minMax).message).toContain('max mora biti');

    const precision = minimalDefinition();
    (precision['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['type'] = 'DECIMAL';
    (precision['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['validation'] = {
      precision: 9,
    };
    expect(firstIssue(precision).message).toContain('0–4');
  });

  it('odbija `pattern` s lookaroundom i backreference (ReDoS)', () => {
    const definition = minimalDefinition();
    (definition['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['validation'] = {
      pattern: '^(?=.*\\d).+$',
    };

    expect(firstIssue(definition).message).toContain('Lookaround');
    expect(checkPatternSafe('^\\d+$').ok).toBe(true);
    expect(checkPatternSafe('(a)\\1').reason).toBe('BACKREFERENCE');
    expect(checkPatternSafe('[').reason).toBe('INVALID_REGEX');
    expect(checkPatternSafe('a'.repeat(DEFINITION_LIMITS.maxPatternLength + 1)).reason).toBe('TOO_LONG');
  });

  it('ograničava dubinu visibleWhen na 3', () => {
    const deep = minimalDefinition();
    (deep['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['visibleWhen'] = {
      all: [
        {
          any: [{ not: { all: [{ field: 'x', op: '==', value: 1 }] } }],
        },
      ],
    };

    expect(firstIssue(deep).message).toContain('dubina uslova');
  });

  it('validira vrijednost po operatoru (IS_EMPTY bez vrijednosti, IN s listom, BETWEEN s dvije)', () => {
    const build = (node: Record<string, unknown>) => {
      const definition = minimalDefinition();
      (definition['sections'] as { fields: Record<string, unknown>[] }[])[0]!.fields[0]!['visibleWhen'] =
        node;
      return parseDefinition(definition);
    };

    expect(build({ field: 'a', op: 'IS_EMPTY' }).ok).toBe(true);
    expect(build({ field: 'a', op: 'IS_EMPTY', value: 1 }).ok).toBe(false);
    expect(build({ field: 'a', op: '==', value: 1 }).ok).toBe(true);
    expect(build({ field: 'a', op: '==' }).ok).toBe(false);
    expect(build({ field: 'a', op: 'IN', value: ['X'] }).ok).toBe(true);
    expect(build({ field: 'a', op: 'IN', value: 'X' }).ok).toBe(false);
    expect(build({ field: 'a', op: 'BETWEEN', value: [1, 2] }).ok).toBe(true);
    expect(build({ field: 'a', op: 'BETWEEN', value: [1] }).ok).toBe(false);
  });

  it('odbija normalizedName na kolonu koja nije dozvoljena za entitet', () => {
    const definition = freshWashDefinition();
    definition['normalizedName'] = [
      { fieldKey: 'washCost', column: 'passwordHash', transform: 'MONEY_TO_FENINZI' },
    ];

    expect(firstIssue(definition).message).toContain('nije dozvoljena za entitet TASK');
  });

  it('prihvata dozvoljeno mapiranje i odbija nepostojeće polje', () => {
    const ok = freshWashDefinition();
    ok['normalizedName'] = [{ fieldKey: 'washCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' }];
    expect(parseDefinition(ok).ok).toBe(true);

    const nepoznato = freshWashDefinition();
    nepoznato['normalizedName'] = [{ fieldKey: 'nemaPolja', column: 'totalCost', transform: 'TO_INT' }];
    expect(firstIssue(nepoznato).message).toContain('nepostojeće polje');
  });

  it('column i transform idu zajedno ili oba null', () => {
    const definition = freshWashDefinition();
    definition['normalizedName'] = [{ fieldKey: 'washCost', column: 'totalCost', transform: null }];

    expect(firstIssue(definition).message).toContain('oba postavljena ili oba null');
  });

  it('odbija formu bez ijedne sekcije', () => {
    expect(
      parseDefinition({ $schema: 'vfm-form/1', meta: { title: 'Prazno', subject: 'TASK' }, sections: [] }).ok,
    ).toBe(false);
  });

  it('odbija nepoznat subject i pogrešnu $schema verziju', () => {
    expect(parseDefinition({ ...minimalDefinition(), meta: { title: 'X', subject: 'SPACESHIP' } }).ok).toBe(
      false,
    );
    expect(parseDefinition({ ...minimalDefinition(), $schema: 'vfm-form/2' }).ok).toBe(false);
  });

  it('ograničava broj polja u sekciji', () => {
    const fields = Array.from({ length: DEFINITION_LIMITS.maxFieldsPerSection + 1 }, (_, index) => ({
      key: `polje${index}`,
      type: 'TEXT',
      label: `Polje ${index}`,
      order: index + 1,
    }));
    const definition = {
      $schema: 'vfm-form/1',
      meta: { title: 'Velika', subject: 'TASK' },
      sections: [{ key: 'sekcija', title: 'Sekcija', order: 1, fields }],
    };

    expect(parseDefinition(definition).ok).toBe(false);
  });

  it('pomoćne funkcije: flatten/input/computed/find', () => {
    const result = parseDefinition(freshWashDefinition());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const definition = result.definition;

    expect(flattenFields(definition)).toHaveLength(5);
    expect(inputFields(definition).map(({ field }) => field.key)).toEqual([
      'washType',
      'washDurationMin',
      'washCost',
      'photosAfter',
    ]);
    expect(computedFields(definition).map(({ field }) => field.key)).toEqual(['costPerMinute']);
    expect(findField(definition, 'photosAfter')?.sectionKey).toBe('osnovno');
    expect(findField(definition, 'nema')).toBeUndefined();
  });

  it('pomoćne funkcije za uslove: dubina i polja', () => {
    const node = {
      all: [
        { field: 'washType', op: 'IN' as const, value: ['FULL'] },
        { any: [{ field: 'washCost', op: '>' as const, value: 0 }] },
      ],
    };

    expect(visibleWhenDepth(node)).toBe(3);
    expect(visibleWhenDepth({ field: 'a', op: '==' })).toBe(1);
    expect(collectVisibleWhenFields(node)).toEqual(['washType', 'washCost']);
    expect(collectVisibleWhenFields({ not: { field: 'x', op: '==' } })).toEqual(['x']);
  });
});
