/** Javni API sigurnih izraza (docs/04 §6). */
export {
  EXPRESSION_ERROR_CODES,
  EXPRESSION_LIMITS,
  ExpressionError,
  astDepth,
  parseExpression,
  tokenize,
} from './parser.js';
export type {
  AstNode,
  BinaryOperator,
  BinaryNode,
  CallNode,
  ExpressionErrorCode,
  FieldNode,
  LiteralNode,
  ParsedExpression,
  Token,
  TokenType,
  UnaryNode,
  ValueType,
} from './parser.js';

export {
  FUNCTION_REGISTRY,
  FUNCTION_SPECS,
  arityIssue,
  formatIsoDate,
  functionSpec,
  isContextualFunction,
  isKnownFunction,
  parseIsoDate,
  roundTo,
} from './functions.js';
export type { ExpressionValue, FunctionSpec, ParameterSpec } from './functions.js';

export { evaluateExpression, evaluateParsed, toFormDataValue } from './evaluator.js';
export type { EvaluationContext, EvaluationResult } from './evaluator.js';

export {
  RESULT_TYPE_COMPATIBILITY,
  STATIC_TYPES,
  assertExpression,
  checkExpression,
  nonZeroProofs,
  printAst,
} from './static-check.js';
export type { ExpressionCheckResult, ExpressionIssue, FieldTypeMap, StaticType } from './static-check.js';
