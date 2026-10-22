/**
 * Meta-shema definicije forme (docs/04-FORM_ENGINE.md §2–§5, §7).
 *
 * Svaki `definition` se pri snimanju drafta validira ovom shemom; bez prolaska
 * nema ni snimanja ni objave. Shema je **zatvorena** (`.strict()`): nepoznat
 * ključ se odbija, jer bi tiho ignorisanje značilo da pravilo ne važi ni na
 * serveru ni na klijentu.
 *
 * Ovdje nema izvršavanja JavaScript-a: definicija je podatak (§1/1).
 */
import { FIELD_TYPES, FORM_SUBJECTS } from '@vfm/shared';
import safeRegex from 'safe-regex2';
import { z } from 'zod';
import {
  ALLOWED_OPTION_QUERY_IDS,
  ALLOWED_VALIDATION_KEYS,
  COMPUTED_RESULT_TYPES,
  FIELD_TYPES_WITH_OPTIONS,
  FORM_CURRENCIES,
  REFERENCE_ENTITY_TYPES,
} from './field-types.js';
import { checkFieldKey, FIELD_KEY_PATTERN } from './reserved-keys.js';

/** Verzija ugovora definicije (`FormDefinition.$schema`). */
export const FORM_DEFINITION_SCHEMA_ID = 'vfm-form/1' as const;

/** Jezici definicije (UI tekstovi forme). */
export const FORM_LANGUAGES = ['bs'] as const;

/** Limite definicije — sve što premaši odbija se pri snimanju (§6.3, §13). */
export const DEFINITION_LIMITS = {
  /** Maksimalan broj sekcija u formi. */
  maxSections: 40,
  /** Maksimalan broj polja po sekciji. */
  maxFieldsPerSection: 60,
  /** Maksimalan broj polja ukupno. */
  maxFieldsTotal: 300,
  /** Maksimalan broj opcija u `STATIC` izvoru. */
  maxStaticOptions: 200,
  /** Maksimalna dubina `visibleWhen` (all/any/not) — §4. */
  maxVisibleWhenDepth: 3,
  /** Maksimalna dužina izraza u znakovima — §6.3. */
  maxExpressionLength: 500,
  /** Maksimalna dužina regex uzorka u `validation.pattern`. */
  maxPatternLength: 200,
  /** Maksimalan broj `normalizedName` mapiranja. */
  maxNormalizationMappings: 40,
} as const;

// ---------------------------------------------------------------------------
// Uslovna vidljivost (§4)
// ---------------------------------------------------------------------------

/** Operatori uslova (`==`, `IN`, `BETWEEN`, …). */
export const VISIBLE_WHEN_OPERATORS = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  'BETWEEN',
] as const;
export type VisibleWhenOperator = (typeof VISIBLE_WHEN_OPERATORS)[number];

/** Operatori koji ne nose vrijednost. */
export const NILADIC_OPERATORS: readonly VisibleWhenOperator[] = ['IS_EMPTY', 'IS_NOT_EMPTY'];

/** Operatori kojima je `value` lista. */
export const LIST_OPERATORS: readonly VisibleWhenOperator[] = ['IN', 'NOT_IN'];

export interface VisibleWhenLeaf {
  readonly field: string;
  readonly op: VisibleWhenOperator;
  readonly value?: unknown;
}

export type VisibleWhenNode =
  | VisibleWhenLeaf
  | { readonly all: readonly VisibleWhenNode[] }
  | { readonly any: readonly VisibleWhenNode[] }
  | { readonly not: VisibleWhenNode };

/** Primitivne vrijednosti koje uslov smije porediti (bez objekata i nizova-osim-listi). */
const conditionValueSchema: z.ZodType<unknown> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const visibleWhenLeafSchema = z
  .object({
    field: z.string().min(1).max(64),
    op: z.enum(VISIBLE_WHEN_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    const niladic = NILADIC_OPERATORS.includes(node.op);
    if (niladic && node.value !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Operator ${node.op} ne prima vrijednost.`,
      });
    }
    if (!niladic && node.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Operator ${node.op} zahtijeva vrijednost.`,
      });
    }
    if (node.op === 'BETWEEN' && (!Array.isArray(node.value) || node.value.length !== 2)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'BETWEEN zahtijeva tačno dvije vrijednosti [od, do].',
      });
    }
    if (LIST_OPERATORS.includes(node.op) && !Array.isArray(node.value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Operator ${node.op} zahtijeva listu vrijednosti.`,
      });
    }
  });

/** Rekurzivni čvor: `all` / `any` / `not` ili list. */
export const visibleWhenSchema: z.ZodType<VisibleWhenNode> = z.lazy(() =>
  z.union([
    visibleWhenLeafSchema as z.ZodType<VisibleWhenNode>,
    z.object({ all: z.array(visibleWhenSchema).min(1).max(10) }).strict() as z.ZodType<VisibleWhenNode>,
    z.object({ any: z.array(visibleWhenSchema).min(1).max(10) }).strict() as z.ZodType<VisibleWhenNode>,
    z.object({ not: visibleWhenSchema }).strict() as z.ZodType<VisibleWhenNode>,
  ]),
);

export function isLeaf(node: VisibleWhenNode): node is VisibleWhenLeaf {
  return 'field' in node && 'op' in node;
}

/** Dubina stabla uslova (list = 1). */
export function visibleWhenDepth(node: VisibleWhenNode): number {
  if (isLeaf(node)) return 1;
  if ('not' in node) return 1 + visibleWhenDepth(node.not);
  const children = 'all' in node ? node.all : node.any;
  return 1 + Math.max(...children.map((child) => visibleWhenDepth(child)));
}

/** Sva polja na koja uslov referencira (za provjeru referenci i ciklusa). */
export function collectVisibleWhenFields(node: VisibleWhenNode): string[] {
  if (isLeaf(node)) return [node.field];
  if ('not' in node) return collectVisibleWhenFields(node.not);
  const children = 'all' in node ? node.all : node.any;
  return children.flatMap((child) => collectVisibleWhenFields(child));
}

const nullableVisibleWhenSchema = z
  .union([visibleWhenSchema, z.null()])
  .optional()
  .transform((value) => value ?? null);

// ---------------------------------------------------------------------------
// Izvor opcija (§3)
// ---------------------------------------------------------------------------

const staticOptionSchema = z
  .object({
    value: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u, 'colorHex mora biti #RRGGBB.')
      .optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

export const optionsSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('STATIC'),
      items: z.array(staticOptionSchema).min(1).max(DEFINITION_LIMITS.maxStaticOptions),
    })
    .strict()
    .superRefine((source, ctx) => {
      const seen = new Set<string>();
      source.items.forEach((item, index) => {
        if (seen.has(item.value)) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'value'],
            message: `Dupla vrijednost opcije "${item.value}".`,
          });
        }
        seen.add(item.value);
      });
    }),
  z
    .object({
      kind: z.literal('LIST'),
      /** Kod šifarnika (`List.code`), npr. `WORKSHOP`. */
      listCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/u, 'listCode mora biti ^[A-Z][A-Z0-9_]{1,30}$.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('QUERY'),
      queryId: z.enum(ALLOWED_OPTION_QUERY_IDS),
      /** Fiksni parametri upita (primitivi) — nikad SQL. */
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .strict(),
]);

export type OptionsSource = z.infer<typeof optionsSourceSchema>;

// ---------------------------------------------------------------------------
// Validacijska pravila po tipu (§3)
// ---------------------------------------------------------------------------

/**
 * `pattern` je regex **whitelist**: kompajlira se, ali se odbijaju lookaround i
 * backreference (ReDoS rizik) te predugački uzorci.
 */
export const FORBIDDEN_PATTERN_FRAGMENTS = ['(?=', '(?!', '(?<=', '(?<!'] as const;

export interface PatternCheckResult {
  readonly ok: boolean;
  readonly reason?:
    | 'TOO_LONG'
    | 'INVALID_REGEX'
    | 'LOOKAROUND'
    | 'BACKREFERENCE'
    | 'UNSAFE_COMPLEXITY'
    | 'AMBIGUOUS_REPETITION';
  readonly message?: string;
}

export function checkPatternSafe(pattern: string): PatternCheckResult {
  if (pattern.length > DEFINITION_LIMITS.maxPatternLength) {
    return { ok: false, reason: 'TOO_LONG', message: 'Uzorak je predug.' };
  }
  if (FORBIDDEN_PATTERN_FRAGMENTS.some((fragment) => pattern.includes(fragment))) {
    return { ok: false, reason: 'LOOKAROUND', message: 'Lookaround nije dozvoljen u uzorku.' };
  }
  if (/\\[1-9]/u.test(pattern)) {
    return { ok: false, reason: 'BACKREFERENCE', message: 'Backreference nije dozvoljena.' };
  }
  // Ponavljana alternacija i više neograničenih wildcard-a daju ambivalentne
  // putanje u JavaScript regex engine-u iako su uzorci sintaksno ispravni.
  if (/\((?:\?:)?(?:\\.|[^()])*?\|(?:\\.|[^()])*?\)(?:[+*]|\{\d+(?:,\d*)?\})/u.test(pattern)) {
    return {
      ok: false,
      reason: 'AMBIGUOUS_REPETITION',
      message: 'Alternacija unutar ponavljane grupe nije dozvoljena.',
    };
  }
  const wildcardRepeats = pattern.match(/(?<!\\)\.(?:\*|\+)/gu) ?? [];
  if (wildcardRepeats.length > 1) {
    return {
      ok: false,
      reason: 'AMBIGUOUS_REPETITION',
      message: 'Više ponavljanih wildcard segmenata nije dozvoljeno.',
    };
  }
  try {
    const compiled = new RegExp(pattern, 'u');
    if (!safeRegex(compiled, { limit: 12 })) {
      return {
        ok: false,
        reason: 'UNSAFE_COMPLEXITY',
        message: 'Složenost uzorka nije sigurna za regularni izraz.',
      };
    }
  } catch {
    return { ok: false, reason: 'INVALID_REGEX', message: 'Uzorak nije ispravan regex.' };
  }
  return { ok: true };
}

const validationValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.enum(FORM_CURRENCIES),
]);

export const validationSchema = z
  .record(z.string(), validationValueSchema)
  .refine((rules) => Object.keys(rules).length <= 12, {
    message: 'Najviše 12 validacijskih pravila po polju.',
  });

/** Provjera da `validation` sadrži samo ključeve dozvoljene za tip polja. */
export function findUnknownValidationKeys(
  type: (typeof FIELD_TYPES)[number],
  validation: Record<string, unknown> | undefined,
): string[] {
  if (!validation) return [];
  const allowed = ALLOWED_VALIDATION_KEYS[type];
  return Object.keys(validation).filter((key) => !allowed.includes(key));
}

// ---------------------------------------------------------------------------
// Izračunato polje (§6)
// ---------------------------------------------------------------------------

export const computedSchema = z
  .object({
    expression: z.string().min(1).max(DEFINITION_LIMITS.maxExpressionLength),
    resultType: z.enum(COMPUTED_RESULT_TYPES),
    precision: z.number().int().min(0).max(4).optional(),
    unit: z.string().min(1).max(16).optional(),
  })
  .strict();

export type ComputedDefinition = z.infer<typeof computedSchema>;

// ---------------------------------------------------------------------------
// Polje i sekcija (§2, §3)
// ---------------------------------------------------------------------------

const fieldKeySchema = z
  .string()
  .min(2)
  .max(49)
  .superRefine((key, ctx) => {
    if (!FIELD_KEY_PATTERN.test(key)) {
      ctx.addIssue({
        code: 'custom',
        message: 'fieldKey mora zadovoljiti ^[a-z][a-zA-Z0-9_]{1,48}$.',
      });
      return;
    }
    const issue = checkFieldKey(key);
    if (issue) {
      ctx.addIssue({ code: 'custom', message: issue.message });
    }
  });

const sectionKeySchema = fieldKeySchema;

export const fieldDefinitionSchema = z
  .object({
    key: fieldKeySchema,
    type: z.enum(FIELD_TYPES),
    label: z.string().min(1).max(120),
    helpText: z.string().max(300).nullable().optional(),
    placeholder: z.string().max(120).nullable().optional(),
    required: z.boolean().default(false),
    order: z.number().int().min(1).max(9999),
    visibleWhen: nullableVisibleWhenSchema,
    disabled: z.boolean().default(false),
    /** Prikaz polja na formi (za COMPUTED: read-only). */
    visibleOnForm: z.boolean().default(true),
    /** Da li se vrijednost upisuje u `formData`. */
    storeInFormData: z.boolean().default(true),
    optionsSource: optionsSourceSchema.optional(),
    validation: validationSchema.optional(),
    computed: computedSchema.optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    const needsOptions = FIELD_TYPES_WITH_OPTIONS.includes(field.type);
    if (needsOptions && !field.optionsSource) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSource'],
        message: `Tip ${field.type} zahtijeva optionsSource.`,
      });
    }
    if (!needsOptions && field.optionsSource) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSource'],
        message: `Tip ${field.type} ne podržava optionsSource.`,
      });
    }

    if (field.type === 'COMPUTED') {
      if (!field.computed) {
        ctx.addIssue({
          code: 'custom',
          path: ['computed'],
          message: 'COMPUTED polje zahtijeva `computed.expression`.',
        });
      }
      if (field.required) {
        ctx.addIssue({
          code: 'custom',
          path: ['required'],
          message: 'COMPUTED polje se računa na serveru i ne može biti `required`.',
        });
      }
    } else if (field.computed) {
      ctx.addIssue({
        code: 'custom',
        path: ['computed'],
        message: `Tip ${field.type} ne podržava \`computed\`.`,
      });
    }

    if (field.type === 'SECTION') {
      if (field.required || field.optionsSource || field.validation) {
        ctx.addIssue({
          code: 'custom',
          path: ['type'],
          message: 'SECTION je grupa: bez `required`, `optionsSource` i `validation`.',
        });
      }
      if (field.visibleWhen && visibleWhenDepth(field.visibleWhen) > DEFINITION_LIMITS.maxVisibleWhenDepth) {
        ctx.addIssue({
          code: 'custom',
          path: ['visibleWhen'],
          message: `Maksimalna dubina uslova je ${DEFINITION_LIMITS.maxVisibleWhenDepth}.`,
        });
      }
      return;
    }

    if (field.visibleWhen && visibleWhenDepth(field.visibleWhen) > DEFINITION_LIMITS.maxVisibleWhenDepth) {
      ctx.addIssue({
        code: 'custom',
        path: ['visibleWhen'],
        message: `Maksimalna dubina uslova je ${DEFINITION_LIMITS.maxVisibleWhenDepth}.`,
      });
    }

    const unknownKeys = findUnknownValidationKeys(field.type, field.validation);
    if (unknownKeys.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['validation'],
        message: `Nedozvoljeni validacijski ključevi za ${field.type}: ${unknownKeys.join(', ')}.`,
      });
    }

    if (field.type === 'REFERENCE_RECORD') {
      const entityType = field.validation?.['entityType'];
      if (
        typeof entityType !== 'string' ||
        !REFERENCE_ENTITY_TYPES.some((allowedType) => allowedType === entityType)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['validation', 'entityType'],
          message: 'REFERENCE_RECORD zahtijeva entityType iz dozvoljene liste.',
        });
      }
    }

    if (field.type === 'MONEY') {
      const currency = field.validation?.['currency'];
      if (
        typeof currency === 'string' &&
        !FORM_CURRENCIES.some((allowedCurrency) => allowedCurrency === currency)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['validation', 'currency'],
          message: `Valuta mora biti jedna od: ${FORM_CURRENCIES.join(', ')}.`,
        });
      }
    }

    if (field.type === 'CURRENCY') {
      const allowedCurrencies = field.validation?.['allowedCurrencies'];
      if (
        Array.isArray(allowedCurrencies) &&
        allowedCurrencies.some(
          (currency) =>
            typeof currency !== 'string' ||
            !FORM_CURRENCIES.some((allowedCurrency) => allowedCurrency === currency),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['validation', 'allowedCurrencies'],
          message: `Valute moraju biti iz liste: ${FORM_CURRENCIES.join(', ')}.`,
        });
      }
    }

    const pattern = field.validation?.['pattern'];
    if (typeof pattern === 'string') {
      const result = checkPatternSafe(pattern);
      if (!result.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['validation', 'pattern'],
          message: result.message ?? 'Neispravan uzorak.',
        });
      }
    }

    if (field.type === 'DECIMAL' || field.type === 'MONEY') {
      const precision = field.validation?.['precision'];
      if (
        precision !== undefined &&
        (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 4)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['validation', 'precision'],
          message: 'precision mora biti cijeli broj 0–4.',
        });
      }
    }

    const min = field.validation?.['min'];
    const max = field.validation?.['max'];
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      ctx.addIssue({ code: 'custom', path: ['validation', 'max'], message: 'max mora biti ≥ min.' });
    }
  });

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const sectionDefinitionSchema = z
  .object({
    key: sectionKeySchema,
    title: z.string().min(1).max(120),
    description: z.string().max(300).nullable().optional(),
    order: z.number().int().min(1).max(9999),
    visibleWhen: nullableVisibleWhenSchema,
    fields: z.array(fieldDefinitionSchema).min(1).max(DEFINITION_LIMITS.maxFieldsPerSection),
  })
  .strict()
  .superRefine((section, ctx) => {
    if (
      section.visibleWhen &&
      visibleWhenDepth(section.visibleWhen) > DEFINITION_LIMITS.maxVisibleWhenDepth
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['visibleWhen'],
        message: `Maksimalna dubina uslova je ${DEFINITION_LIMITS.maxVisibleWhenDepth}.`,
      });
    }
    const seen = new Set<string>();
    section.fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: `Dupli fieldKey "${field.key}" u sekciji "${section.key}".`,
        });
      }
      seen.add(field.key);
    });
  });

export type SectionDefinition = z.infer<typeof sectionDefinitionSchema>;

// ---------------------------------------------------------------------------
// Normalizacija na kolone (§7)
// ---------------------------------------------------------------------------

/** Transformacije vrijednosti iz `formData` u normalizovanu kolonu. */
export const NORMALIZATION_TRANSFORMS = [
  'TO_INT',
  'TO_DECIMAL',
  'TO_DATE',
  'TO_DATETIME',
  'TO_BOOL',
  'TO_TEXT',
  'MONEY_TO_FENINZI',
  'FENINZI_TO_MONEY',
] as const;
export type NormalizationTransform = (typeof NORMALIZATION_TRANSFORMS)[number];

/**
 * Dozvoljene kolone po entitetu (whitelist — ne može se mapirati na proizvoljnu
 * kolonu). Provjera tipa kolone radi se pri objavi uz Prisma šemu.
 */
export const NORMALIZATION_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  TASK: [
    'odometerKm',
    'totalCost',
    'fuelLiters',
    'fuelAmount',
    'dueDate',
    'dueAt',
    'priority',
    'title',
    'description',
  ],
  VEHICLE: [
    'odometerKm',
    'status',
    'plateNumber',
    'registrationExpiresAt',
    'insuranceExpiresAt',
    'nextServiceDueDate',
    'nextServiceDueKm',
  ],
  SERVICE: [
    'serviceDate',
    'odometerKm',
    'totalCost',
    'nextServiceDueDate',
    'nextServiceDueKm',
    'workshopName',
  ],
  REGISTRATION: ['validFrom', 'validUntil', 'costAmount', 'registrationNumber'],
  INSURANCE: ['validFrom', 'validUntil', 'costAmount', 'policyNumber', 'insuranceCompany'],
  TIRE_INSTALLATION: [
    'mountedAt',
    'mountedOdometerKm',
    'dismountedAt',
    'dismountedOdometerKm',
    'kmDriven',
    'daysInUse',
  ],
};

export const normalizationMappingSchema = z
  .object({
    fieldKey: fieldKeySchema,
    /** `null` = vrijednost ostaje samo u JSONB. */
    column: z.string().min(1).max(64).nullable(),
    transform: z.enum(NORMALIZATION_TRANSFORMS).nullable(),
  })
  .strict()
  .superRefine((mapping, ctx) => {
    if ((mapping.column === null) !== (mapping.transform === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['transform'],
        message: 'column i transform moraju biti oba postavljena ili oba null.',
      });
    }
  });

export type NormalizationMapping = z.infer<typeof normalizationMappingSchema>;

// ---------------------------------------------------------------------------
// Definicija (§2)
// ---------------------------------------------------------------------------

export const formMetaSchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(500).nullable().optional(),
    subject: z.enum(FORM_SUBJECTS),
    language: z.enum(FORM_LANGUAGES).default('bs'),
    estimatedMinutes: z.number().int().min(1).max(600).optional(),
  })
  .strict();

export const formLayoutSchema = z
  .object({
    /** Web: 1 ili 2 kolone; mobilna je uvijek 1. */
    columns: z.union([z.literal(1), z.literal(2)]).default(1),
    sectionsCollapsible: z.boolean().default(true),
    stickySubmit: z.boolean().default(true),
  })
  .strict();

export const formDefinitionSchema = z
  .object({
    $schema: z.literal(FORM_DEFINITION_SCHEMA_ID),
    meta: formMetaSchema,
    layout: formLayoutSchema.optional(),
    sections: z.array(sectionDefinitionSchema).min(1).max(DEFINITION_LIMITS.maxSections),
    normalizedName: z
      .array(normalizationMappingSchema)
      .max(DEFINITION_LIMITS.maxNormalizationMappings)
      .optional(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const sectionKeys = new Set<string>();
    definition.sections.forEach((section, index) => {
      if (sectionKeys.has(section.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', index, 'key'],
          message: `Dupli ključ sekcije "${section.key}".`,
        });
      }
      sectionKeys.add(section.key);
    });

    const totalFields = definition.sections.reduce((sum, section) => sum + section.fields.length, 0);
    if (totalFields > DEFINITION_LIMITS.maxFieldsTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `Forma ima ${totalFields} polja, a maksimum je ${DEFINITION_LIMITS.maxFieldsTotal}.`,
      });
    }

    // `fieldKey` je jedinstven na nivou **forme** (ne samo sekcije) jer se
    // vrijednosti drže u jednom JSONB objektu (§8/2).
    const fieldKeys = new Set<string>();
    definition.sections.forEach((section, sectionIndex) => {
      section.fields.forEach((field, fieldIndex) => {
        if (fieldKeys.has(field.key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', sectionIndex, 'fields', fieldIndex, 'key'],
            message: `fieldKey "${field.key}" se ponavlja u formi.`,
          });
        }
        fieldKeys.add(field.key);
      });
    });

    const mappings = definition.normalizedName ?? [];
    const mappedKeys = new Set<string>();
    mappings.forEach((mapping, index) => {
      if (mappedKeys.has(mapping.fieldKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['normalizedName', index, 'fieldKey'],
          message: `Polje "${mapping.fieldKey}" je mapirano dva puta.`,
        });
      }
      mappedKeys.add(mapping.fieldKey);

      if (!fieldKeys.has(mapping.fieldKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['normalizedName', index, 'fieldKey'],
          message: `normalizedName referencira nepostojeće polje "${mapping.fieldKey}".`,
        });
      }

      const allowed = NORMALIZATION_COLUMNS[definition.meta.subject];
      if (mapping.column !== null && allowed && !allowed.includes(mapping.column)) {
        ctx.addIssue({
          code: 'custom',
          path: ['normalizedName', index, 'column'],
          message: `Kolona "${mapping.column}" nije dozvoljena za entitet ${definition.meta.subject}.`,
        });
      }
    });
  });

export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormMeta = z.infer<typeof formMetaSchema>;
export type FormLayout = z.infer<typeof formLayoutSchema>;

// ---------------------------------------------------------------------------
// Pomoćne funkcije nad definicijom
// ---------------------------------------------------------------------------

/** Sva polja forme (ravna lista, s `sectionKey`). */
export interface FlatField {
  readonly sectionKey: string;
  readonly field: FieldDefinition;
}

export function flattenFields(definition: FormDefinition): FlatField[] {
  return definition.sections.flatMap((section) =>
    section.fields.map((field) => ({ sectionKey: section.key, field })),
  );
}

/** Polja koja unose vrijednost (bez SECTION i COMPUTED). */
export function inputFields(definition: FormDefinition): FlatField[] {
  return flattenFields(definition).filter(
    ({ field }) => field.type !== 'SECTION' && field.type !== 'COMPUTED',
  );
}

/** COMPUTED polja (redoslijed iz definicije). */
export function computedFields(definition: FormDefinition): FlatField[] {
  return flattenFields(definition).filter(({ field }) => field.type === 'COMPUTED');
}

export function findField(definition: FormDefinition, key: string): FlatField | undefined {
  return flattenFields(definition).find(({ field }) => field.key === key);
}

/** Rezultat parsiranja definicije iz JSON-a (npr. iz baze). */
export type ParseDefinitionResult =
  | { readonly ok: true; readonly definition: FormDefinition }
  | { readonly ok: false; readonly issues: readonly DefinitionIssue[] };

export interface DefinitionIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function joinPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    if (typeof part === 'symbol') return `${acc}.${part.toString()}`;
    return `${acc}.${part}`;
  }, '$');
}

/**
 * Parsira i validira `definition` (draft gate). Greške se vraćaju kao lista —
 * API ih mapira na `422 FORM_VALIDATION_FAILED` s `details.issues`.
 */
export function parseDefinition(input: unknown): ParseDefinitionResult {
  const result = formDefinitionSchema.safeParse(input);
  if (result.success) {
    return { ok: true, definition: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      path: joinPath(issue.path),
      message: issue.message,
    })),
  };
}
