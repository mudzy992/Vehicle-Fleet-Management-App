/**
 * `@vfm/form-engine` — javni API paketa.
 *
 * Faza 2 donosi: meta-shemu definicije (docs/04 §2–§5, §7), rezervisane
 * ključeve, kanonski hash/ETag, sigurne izraze (§6) i validaciju zapisa (§9).
 * Paket **nikad** ne izvršava proizvoljan JavaScript iz definicije.
 */
export {
  FIELD_KEY_ISSUE_CODES,
  FIELD_KEY_MAX_LENGTH,
  FIELD_KEY_MIN_LENGTH,
  FIELD_KEY_PATTERN,
  RESERVED_FIELD_KEYS,
  checkFieldKey,
  checkFieldKeys,
  isReservedFieldKey,
  isValidFieldKeyFormat,
} from './reserved-keys.js';
export type { FieldKeyIssue, FieldKeyIssueCode, ReservedFieldKey } from './reserved-keys.js';

export {
  ALLOWED_OPTION_QUERY_IDS,
  ALLOWED_VALIDATION_KEYS,
  ATTACHMENT_STAGES,
  COMPUTED_RESULT_TYPES,
  DEFAULT_IMAGE_MIME_TYPES,
  FIELD_TYPES,
  FIELD_TYPES_WITH_OPTIONS,
  FIELD_VALUE_KINDS,
  FIELD_VALUE_KIND,
  FORM_CURRENCIES,
  INPUT_FIELD_TYPES,
  KNOWN_COMPUTED_UNITS,
  MOBILE_COMPATIBLE_FIELD_TYPES,
  REFERENCE_ENTITY_TYPES,
  allowedValidationKeysFor,
  isKnownFieldType,
  isMobileCompatible,
} from './field-types.js';
export type {
  AllowedOptionQueryId,
  AttachmentStage,
  ComputedResultType,
  FieldType,
  FieldValueKind,
  FormCurrency,
  ReferenceEntityType,
} from './field-types.js';

export {
  CanonicalizationError,
  canonicalJson,
  contentHash,
  definitionETag,
  sameCanonicalJson,
} from './canonical.js';

export {
  COMPUTED_STATIC_TYPE,
  FIELD_STATIC_TYPE,
  fieldTypesFromDefinition,
  findComputedCycles,
} from './fields.js';
export type { FieldTypesResult } from './fields.js';

export { checkCondition, evaluateCondition, isFieldVisible } from './conditions.js';
export type { ConditionIssue, ConditionValues } from './conditions.js';

export {
  EXPRESSION_ERROR_CODES,
  EXPRESSION_LIMITS,
  ExpressionError,
  FUNCTION_REGISTRY,
  FUNCTION_SPECS,
  RESULT_TYPE_COMPATIBILITY,
  STATIC_TYPES,
  arityIssue,
  assertExpression,
  astDepth,
  checkExpression,
  evaluateExpression,
  evaluateParsed,
  formatIsoDate,
  isKnownFunction,
  nonZeroProofs,
  parseExpression,
  parseIsoDate,
  printAst,
  roundTo,
  tokenize,
} from './expression/index.js';
export type {
  AstNode,
  BinaryOperator,
  EvaluationContext,
  EvaluationResult,
  ExpressionCheckResult,
  ExpressionErrorCode,
  ExpressionIssue,
  ExpressionValue,
  FieldTypeMap,
  FunctionSpec,
  ParsedExpression,
  StaticType,
} from './expression/index.js';

export {
  DEFINITION_LIMITS,
  FORBIDDEN_PATTERN_FRAGMENTS,
  FORM_DEFINITION_SCHEMA_ID,
  FORM_LANGUAGES,
  LIST_OPERATORS,
  NILADIC_OPERATORS,
  NORMALIZATION_COLUMNS,
  NORMALIZATION_TRANSFORMS,
  VISIBLE_WHEN_OPERATORS,
  checkPatternSafe,
  collectVisibleWhenFields,
  computedFields,
  computedSchema,
  fieldDefinitionSchema,
  findField,
  findUnknownValidationKeys,
  flattenFields,
  formDefinitionSchema,
  formLayoutSchema,
  formMetaSchema,
  inputFields,
  isLeaf,
  normalizationMappingSchema,
  optionsSourceSchema,
  parseDefinition,
  sectionDefinitionSchema,
  validationSchema,
  visibleWhenDepth,
  visibleWhenSchema,
} from './definition.schema.js';
export type {
  ComputedDefinition,
  DefinitionIssue,
  FieldDefinition,
  FlatField,
  FormDefinition,
  FormLayout,
  FormMeta,
  NormalizationMapping,
  NormalizationTransform,
  OptionsSource,
  ParseDefinitionResult,
  SectionDefinition,
  VisibleWhenLeaf,
  VisibleWhenNode,
  VisibleWhenOperator,
} from './definition.schema.js';
