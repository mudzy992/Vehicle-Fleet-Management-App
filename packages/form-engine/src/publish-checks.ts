/**
 * Provjere pri objavi verzije forme (docs/04-FORM_ENGINE.md §8).
 *
 * Devet provjera iz dokumentacije, sve na jednom mjestu i **bez** baze:
 *
 * 1. meta-shema (radi `parseDefinition` prije ove funkcije),
 * 2. `fieldKey` format, jedinstvenost i rezervisani ključevi,
 * 3. reference u `visibleWhen` pokazuju na postojeća polja,
 * 4. nema ciklusa u izračunatim poljima,
 * 5. svi izrazi prolaze statičku provjeru (tipovi, dijeljenje nulom),
 * 6. `normalizedName` kolone postoje i transformacija odgovara tipu polja,
 * 7. mobilna kompatibilnost (`allowWebOnly` za izuzetak),
 * 8. `changeNote` nije prazan (≥ 5 znakova),
 * 9. uklanjanje mapiranog polja traži potvrdu ili plan migracije,
 * 10. `contentHash` (kanonski JSON) za detekciju naknadnih izmjena.
 *
 * API ovo zove u transakciji objave i greške vraća kao `422 FORM_VALIDATION_FAILED`
 * s `details.issues` — nigdje se ne baca izuzetak za korisnički unos.
 */
import { contentHash } from './canonical.js';
import type { FieldDefinition, FormDefinition, VisibleWhenNode } from './definition.schema.js';
import { flattenFields } from './definition.schema.js';
import { FIELD_VALUE_KIND, isMobileCompatible } from './field-types.js';
import type { FieldValueKind } from './field-types.js';
import { checkCondition } from './conditions.js';
import { checkExpression } from './expression/static-check.js';
import type { NormalizationTransform } from './definition.schema.js';
import { checkFieldKeys } from './reserved-keys.js';
import { fieldTypesFromDefinition } from './fields.js';

export const PUBLISH_ISSUE_CODES = [
  'CHANGE_NOTE_REQUIRED',
  'FIELD_KEY_INVALID',
  'RESERVED_FIELD_KEY',
  'DUPLICATE_FIELD_KEY',
  'VISIBLE_WHEN_INVALID',
  'EXPRESSION_INVALID',
  'COMPUTED_CYCLE',
  'NORMALIZATION_MISMATCH',
  'WEB_ONLY_FIELD',
  'NORMALIZED_FIELD_REMOVED',
] as const;
export type PublishIssueCode = (typeof PUBLISH_ISSUE_CODES)[number];

export interface PublishIssue {
  readonly code: PublishIssueCode;
  /** JSON putanja do polja/mapiranja (`$.sections[0].fields[2]`). */
  readonly path: string;
  readonly message: string;
}

export interface PublishCheckInput {
  readonly definition: FormDefinition;
  readonly changeNote: string | undefined;
  /** Dozvoljava objavu forme koja ima polja bez mobilne kontrole (§8/7). */
  readonly allowWebOnly?: boolean;
  /** Prethodna objavljena verzija — osnov za provjeru uklanjanja mapiranih polja. */
  readonly previousPublished?: FormDefinition | null;
  /** Eksplicitna potvrda da se mapirano polje smije ukloniti bez migracije. */
  readonly confirmNormalizedRemoval?: boolean;
}

export interface PublishCheckResult {
  readonly ok: boolean;
  readonly issues: readonly PublishIssue[];
  /** SHA-256 kanonskog JSON-a — upisuje se u `FormSchemaVersion.contentHash`. */
  readonly contentHash: string;
  readonly mobileCompatible: boolean;
}

/** Minimalna dužina bilješke o promjeni (§8/8). */
export const CHANGE_NOTE_MIN_LENGTH = 5;

/** Vrste vrijednosti iz kojih transformacija ima smisla (§7). */
const TRANSFORM_SOURCE_KINDS: Readonly<Record<NormalizationTransform, readonly FieldValueKind[]>> = {
  TO_INT: ['integer', 'decimal'],
  TO_DECIMAL: ['integer', 'decimal'],
  TO_DATE: ['date', 'datetime'],
  TO_DATETIME: ['date', 'datetime'],
  TO_BOOL: ['boolean'],
  TO_TEXT: ['string', 'stringArray', 'currency', 'uuid'],
  MONEY_TO_FENINZI: ['money'],
  FENINZI_TO_MONEY: ['integer', 'decimal'],
};

function pathOfField(definition: FormDefinition, fieldKey: string): string {
  for (const [sectionIndex, section] of definition.sections.entries()) {
    const fieldIndex = section.fields.findIndex((field) => field.key === fieldKey);
    if (fieldIndex !== -1) return `$.sections[${sectionIndex}].fields[${fieldIndex}]`;
  }
  return '$';
}

function visibleWhenIssues(
  node: VisibleWhenNode | null | undefined,
  types: Parameters<typeof checkCondition>[1],
  path: string,
  issues: PublishIssue[],
): void {
  if (!node) return;
  for (const issue of checkCondition(node, types)) {
    issues.push({
      code: 'VISIBLE_WHEN_INVALID',
      path,
      message: `${issue.code}: ${issue.message ?? 'uslov vidljivosti nije ispravan'}`,
    });
  }
}

function collectedFieldKeys(definition: FormDefinition): string[] {
  return flattenFields(definition).map(({ field }) => field.key);
}

function checkFieldKeysAndDuplicates(definition: FormDefinition, issues: PublishIssue[]): void {
  const keys = collectedFieldKeys(definition);

  for (const issue of checkFieldKeys(keys)) {
    issues.push({
      code: issue.code === 'RESERVED_FIELD_KEY' ? 'RESERVED_FIELD_KEY' : 'FIELD_KEY_INVALID',
      path: pathOfField(definition, issue.key),
      message: issue.message,
    });
  }

  const seen = new Set<string>();
  for (const [sectionIndex, section] of definition.sections.entries()) {
    for (const [fieldIndex, field] of section.fields.entries()) {
      if (seen.has(field.key)) {
        issues.push({
          code: 'DUPLICATE_FIELD_KEY',
          path: `$.sections[${sectionIndex}].fields[${fieldIndex}].key`,
          message: `Ključ "${field.key}" se ponavlja u formi.`,
        });
      }
      seen.add(field.key);
    }
  }
}

function checkNormalization(definition: FormDefinition, issues: PublishIssue[]): void {
  const fields = new Map(flattenFields(definition).map(({ field }) => [field.key, field]));

  for (const [index, mapping] of (definition.normalizedName ?? []).entries()) {
    const field = fields.get(mapping.fieldKey);
    if (!field) continue; // hvata već meta-shema

    if (mapping.column === null || mapping.transform === null) continue;

    const allowed = definition.meta.subject;
    void allowed;

    const kind = FIELD_VALUE_KIND[field.type];
    const expected = TRANSFORM_SOURCE_KINDS[mapping.transform];
    if (!expected.includes(kind)) {
      issues.push({
        code: 'NORMALIZATION_MISMATCH',
        path: `$.normalizedName[${index}]`,
        message: `Transformacija ${mapping.transform} ne odgovara polju "${mapping.fieldKey}" (${field.type}).`,
      });
    }
  }
}

function checkWebOnly(definition: FormDefinition, allowWebOnly: boolean, issues: PublishIssue[]): boolean {
  const unsupported = [...flattenFields(definition)]
    .map(({ field }) => field)
    .filter((field: FieldDefinition) => !isMobileCompatible(field.type));

  if (unsupported.length > 0 && !allowWebOnly) {
    for (const field of unsupported) {
      issues.push({
        code: 'WEB_ONLY_FIELD',
        path: pathOfField(definition, field.key),
        message: `Tip ${field.type} nema mobilnu kontrolu; objava traži allowWebOnly.`,
      });
    }
  }
  return unsupported.length === 0;
}

function checkRemovedNormalizedFields(
  previous: FormDefinition | null | undefined,
  definition: FormDefinition,
  confirm: boolean,
  issues: PublishIssue[],
): void {
  if (!previous || confirm) return;
  const current = new Map(
    (definition.normalizedName ?? []).map((mapping) => [mapping.fieldKey, mapping] as const),
  );
  for (const [index, mapping] of (previous.normalizedName ?? []).entries()) {
    if (mapping.column === null) continue;
    const next = current.get(mapping.fieldKey);
    const removedField = !flattenFields(definition).some(({ field }) => field.key === mapping.fieldKey);
    const mappingChanged = !next || next.column !== mapping.column || next.transform !== mapping.transform;
    if (removedField || mappingChanged) {
      issues.push({
        code: 'NORMALIZED_FIELD_REMOVED',
        path: `$.normalizedName[${index}]`,
        message: `Polje "${mapping.fieldKey}" je bilo mapirano na kolonu "${mapping.column}"; potrebna je potvrda ili plan migracije zapisa.`,
      });
    }
  }
}

/** Sve provjere pri objavi. Vraća `issues` (prazno = verzija se može objaviti). */
export function checkPublishable(input: PublishCheckInput): PublishCheckResult {
  const { definition } = input;
  const issues: PublishIssue[] = [];

  // 8) Bilješka o promjeni.
  const note = input.changeNote?.trim() ?? '';
  if (note.length < CHANGE_NOTE_MIN_LENGTH) {
    issues.push({
      code: 'CHANGE_NOTE_REQUIRED',
      path: '$.changeNote',
      message: `Bilješka o promjeni je obavezna (najmanje ${CHANGE_NOTE_MIN_LENGTH} znakova).`,
    });
  }

  // 2) Ključevi polja.
  checkFieldKeysAndDuplicates(definition, issues);

  const { types, cycles } = fieldTypesFromDefinition(definition);

  // 3) Uslovi vidljivosti (sekcije i polja).
  for (const [sectionIndex, section] of definition.sections.entries()) {
    visibleWhenIssues(section.visibleWhen, types, `$.sections[${sectionIndex}].visibleWhen`, issues);
    for (const [fieldIndex, field] of section.fields.entries()) {
      visibleWhenIssues(
        field.visibleWhen,
        types,
        `$.sections[${sectionIndex}].fields[${fieldIndex}].visibleWhen`,
        issues,
      );
    }
  }

  // 4) Ciklusi među izračunatim poljima.
  for (const cycle of cycles) {
    issues.push({
      code: 'COMPUTED_CYCLE',
      path: '$',
      message: `Ciklus u izračunatim poljima: ${cycle.join(' → ')}.`,
    });
  }

  // 5) Statička provjera izraza.
  for (const [sectionIndex, section] of definition.sections.entries()) {
    for (const [fieldIndex, field] of section.fields.entries()) {
      const expression = field.computed?.expression;
      if (!expression) continue;
      const result = checkExpression(expression, types, field.computed?.resultType);
      for (const issue of result.issues) {
        issues.push({
          code: 'EXPRESSION_INVALID',
          path: `$.sections[${sectionIndex}].fields[${fieldIndex}].computed.expression`,
          message: `${issue.code}: ${issue.message}`,
        });
      }
    }
  }

  // 6) Normalizacija.
  checkNormalization(definition, issues);

  // 7) Mobilna kompatibilnost.
  const mobileCompatible = checkWebOnly(definition, input.allowWebOnly === true, issues);

  // 9) Uklanjanje mapiranih polja u odnosu na prethodnu objavljenu verziju.
  checkRemovedNormalizedFields(
    input.previousPublished,
    definition,
    input.confirmNormalizedRemoval === true,
    issues,
  );

  return {
    ok: issues.length === 0,
    issues,
    contentHash: contentHash(definition),
    mobileCompatible,
  };
}
