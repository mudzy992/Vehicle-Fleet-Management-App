/**
 * Provjere pri objavi (docs/04 §8) i strukturni diff verzija (§12).
 *
 * Testovi pokrivaju svaku od 9 provjera pojedinačno — ako neka propusti, forma s
 * greškom bi otišla u `PUBLISHED`, a objavljena verzija je nepromjenjiva.
 */
import { describe, expect, it } from 'vitest';
import {
  CHANGE_NOTE_MIN_LENGTH,
  checkPublishable,
  contentHash,
  diffDefinitions,
  parseDefinition,
  summarizeDiff,
  type FormDefinition,
} from '../src/index.js';
import { freshWashDefinition, minimalDefinition } from './fixtures/wash.definition.js';

function definitionOf(input: unknown): FormDefinition {
  const parsed = parseDefinition(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}

const WASH = definitionOf(freshWashDefinition());
const NOTE = 'Prva objavljena verzija';

function codes(input: Partial<Parameters<typeof checkPublishable>[0]> = {}): string[] {
  return checkPublishable({ definition: WASH, changeNote: NOTE, ...input }).issues.map((issue) => issue.code);
}

describe('checkPublishable — sretan put', () => {
  it('objavljiva forma prolazi i dobija stabilan contentHash', () => {
    const first = checkPublishable({ definition: WASH, changeNote: NOTE });
    const second = checkPublishable({ definition: WASH, changeNote: `  ${NOTE}  ` });

    expect(first.issues).toEqual([]);
    expect(first.ok).toBe(true);
    expect(first.mobileCompatible).toBe(true);
    expect(first.contentHash).toBe(contentHash(WASH));
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('checkPublishable — svaka provjera pojedinačno', () => {
  it('1) changeNote je obavezna i ima najmanje 5 znakova', () => {
    expect(codes({ changeNote: undefined })).toEqual(['CHANGE_NOTE_REQUIRED']);
    expect(codes({ changeNote: '    ' })).toEqual(['CHANGE_NOTE_REQUIRED']);
    expect(codes({ changeNote: 'abc' })).toEqual(['CHANGE_NOTE_REQUIRED']);
    expect(codes({ changeNote: '12345' })).toEqual([]);
    expect(CHANGE_NOTE_MIN_LENGTH).toBe(5);
  });

  it('2) rezervisan ključ pada već u meta-shemi, a provjera ga hvata i bez nje', () => {
    const raw = minimalDefinition({
      sections: [
        {
          key: 'osnovno',
          title: 'Osnovno',
          order: 1,
          fields: [{ key: 'id', type: 'TEXT', label: 'ID', order: 1 }],
        },
      ],
    });

    // Prva linija odbrane: meta-shema odbija rezervisan ključ pri čuvanju drafta.
    expect(parseDefinition(raw).ok).toBe(false);

    // Druga linija: objava odbija i definiciju koja je u bazu došla mimo sheme.
    expect(codes({ definition: raw as unknown as FormDefinition })).toContain('RESERVED_FIELD_KEY');
  });

  it('2) dupli ključ polja', () => {
    // Meta-shema hvata duplikat, pa se ovdje provjerava odbrana pri objavi.
    const duplicate = {
      ...WASH,
      sections: [
        {
          ...WASH.sections[0]!,
          fields: [...WASH.sections[0]!.fields, { ...WASH.sections[0]!.fields[0]! }],
        },
        ...WASH.sections.slice(1),
      ],
    } as FormDefinition;

    expect(codes({ definition: duplicate })).toContain('DUPLICATE_FIELD_KEY');
  });

  it('3) uslov vidljivosti na nepostojeće polje', () => {
    const broken = definitionOf(
      minimalDefinition({
        sections: [
          {
            key: 'osnovno',
            title: 'Osnovno',
            order: 1,
            fields: [
              { key: 'napomena', type: 'TEXT', label: 'Napomena', order: 1 },
              {
                key: 'detalj',
                type: 'TEXT',
                label: 'Detalj',
                order: 2,
                visibleWhen: { field: 'nepostojece', op: 'IS_NOT_EMPTY' },
              },
            ],
          },
        ],
      }),
    );

    const result = checkPublishable({ definition: broken, changeNote: NOTE });
    expect(result.issues.map((issue) => issue.code)).toEqual(['VISIBLE_WHEN_INVALID']);
    expect(result.issues[0]?.message).toContain('UNKNOWN_FIELD');
  });

  it('4) ciklus u izračunatim poljima', () => {
    const cyclic = definitionOf({
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
    });

    expect(codes({ definition: cyclic })).toContain('COMPUTED_CYCLE');
  });

  it('5) neispravan izraz (nepoznato polje)', () => {
    const broken = definitionOf({
      $schema: 'vfm-form/1',
      meta: { title: 'Izraz', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            { key: 'cijena', type: 'MONEY', label: 'Cijena', order: 1, validation: { min: 0 } },
            {
              key: 'kolicnik',
              type: 'COMPUTED',
              label: 'Količnik',
              order: 2,
              computed: { expression: 'cijena / nema', resultType: 'DECIMAL' },
            },
          ],
        },
      ],
    });

    const result = checkPublishable({ definition: broken, changeNote: NOTE });
    const expressionIssues = result.issues.filter((issue) => issue.code === 'EXPRESSION_INVALID');
    expect(expressionIssues.length).toBeGreaterThan(0);
    expect(expressionIssues.map((issue) => issue.message).join(' ')).toContain('UNKNOWN_FIELD');
  });

  it('5) nezaštićeno dijeljenje poljem blokira objavu', () => {
    const broken = definitionOf({
      $schema: 'vfm-form/1',
      meta: { title: 'Dijeljenje', subject: 'TASK' },
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            { key: 'iznos', type: 'MONEY', label: 'Iznos', order: 1 },
            { key: 'broj', type: 'INTEGER', label: 'Broj', order: 2 },
            {
              key: 'prosjek',
              type: 'COMPUTED',
              label: 'Prosjek',
              order: 3,
              computed: { expression: 'iznos / broj', resultType: 'DECIMAL' },
            },
          ],
        },
      ],
    });

    const messages = checkPublishable({ definition: broken, changeNote: NOTE })
      .issues.filter((issue) => issue.code === 'EXPRESSION_INVALID')
      .map((issue) => issue.message);
    expect(messages.join(' ')).toContain('DIVISION_BY_ZERO');
  });

  it('6) transformacija koja ne odgovara tipu polja', () => {
    const broken = definitionOf({
      ...freshWashDefinition(),
      normalizedName: [{ fieldKey: 'washType', column: 'odometerKm', transform: 'TO_INT' }],
    });

    const result = checkPublishable({ definition: broken, changeNote: NOTE });
    expect(result.issues.map((issue) => issue.code)).toEqual(['NORMALIZATION_MISMATCH']);
    expect(result.issues[0]?.message).toContain('washType');
  });

  it('9) uklanjanje mapiranog polja traži potvrdu', () => {
    const previous = definitionOf({
      ...freshWashDefinition(),
      normalizedName: [{ fieldKey: 'washCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' }],
    });
    const next = definitionOf(freshWashDefinition());

    expect(codes({ definition: next, previousPublished: previous })).toEqual(['NORMALIZED_FIELD_REMOVED']);
    expect(codes({ definition: next, previousPublished: previous, confirmNormalizedRemoval: true })).toEqual(
      [],
    );
    // Nepromijenjeno mapiranje ne traži potvrdu.
    expect(codes({ definition: previous, previousPublished: previous })).toEqual([]);
  });
});

describe('diffDefinitions', () => {
  it('ista definicija nema razlika', () => {
    const diff = diffDefinitions(WASH, definitionOf(freshWashDefinition()));

    expect(diff.empty).toBe(true);
    expect(summarizeDiff(diff)).toBe('Bez strukturnih promjena.');
  });

  it('dodavanje, uklanjanje i izmjena polja', () => {
    const changed = JSON.parse(JSON.stringify(freshWashDefinition())) as Record<string, unknown>;
    const sections = changed['sections'] as Array<Record<string, unknown>>;
    const fields = sections[0]!['fields'] as Array<Record<string, unknown>>;

    fields[0]!['required'] = false;
    fields[0]!['label'] = 'Vrsta pranja (novo)';
    fields.splice(1, 1); // ukloni washDurationMin
    fields.push({ key: 'novoPolje', type: 'TEXT', label: 'Novo polje', order: 9 });

    const diff = diffDefinitions(WASH, definitionOf(changed));

    expect(diff.addedFields).toEqual(['novoPolje']);
    expect(diff.removedFields).toEqual(['washDurationMin']);
    expect(diff.changedFields.map((field) => field.key)).toEqual(['washType']);
    expect(diff.changedFields[0]?.changes.map((change) => change.path).sort()).toEqual(['label', 'required']);
    expect(diff.empty).toBe(false);
    expect(summarizeDiff(diff)).toBe('1 dodano, 1 uklonjeno, 1 izmijenjeno polja.');
  });

  it('promjena meta i normalizacije se vidi u diffu', () => {
    const changed = {
      ...freshWashDefinition(),
      meta: { ...(freshWashDefinition()['meta'] as Record<string, unknown>), title: 'Pranje (v2)' },
      normalizedName: [{ fieldKey: 'washCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' }],
    };

    const diff = diffDefinitions(WASH, definitionOf(changed));
    expect(diff.meta).toEqual([{ path: 'meta.title', before: 'Pranje vozila', after: 'Pranje (v2)' }]);
    expect(diff.normalizationChanged).toBe(true);
  });
});
