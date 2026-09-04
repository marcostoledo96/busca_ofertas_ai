/**
 * @busca-ofertas-ai/rules-engine
 *
 * Deterministic, explainable evaluation engine for Busca Ofertas AI.
 * Completely pure: zero filesystem, network, database, or AI dependencies.
 */

// Domain & Contracts
export {
  type RuleEvaluationContext,
  type CreateRuleEvaluationContextParams,
  createRuleEvaluationContext,
} from './domain/context.js';

export {
  type RuleResult,
  type CreateRuleResultParams,
  createRuleResult,
  createNotTriggeredResult,
} from './domain/rule-result.js';

export { type Rule } from './domain/rule.js';

export {
  EvaluationReasonCodes,
  type EvaluationReasonCode,
  type CreateEngineReasonParams,
  createEngineReason,
} from './domain/reason-codes.js';

export {
  type BooleanExpressionKind,
  type RuleReferenceNode,
  type AndExpressionNode,
  type OrExpressionNode,
  type NotExpressionNode,
  type BooleanExpressionNode,
  type ValidationOptions,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  validateBooleanExpression,
  booleanExpressionToRuleExpression,
  ruleExpressionToBooleanExpression,
} from './domain/expression.js';

export {
  type StandardPrecisionProfile,
  type PrecisionProfileConfig,
  type PrecisionProfileRegistryOptions,
  STANDARD_PROFILES,
  isStandardPrecisionProfile,
  resolveStandardPrecisionProfile,
  PrecisionProfileRegistry,
} from './domain/precision-profile.js';

// Engine
export { computeScore } from './engine/score-calculator.js';
export { sortReasonsCanonically } from './engine/reason-aggregator.js';
export { evaluateBooleanExpression } from './engine/expression-evaluator.js';
export {
  DEFAULT_RULES_POLICY_VERSION,
  type EvaluateRulesOptions,
  evaluateRules,
} from './engine/rules-evaluator.js';

export {
  type PostAiReconciliationParams,
  evaluatePreAi,
  reconcilePostAiEvaluation,
} from './engine/pre-post-ai.js';

// Standard Generic Rules
export { type RequiredTermsRuleOptions, RequiredTermsRule } from './rules/required-terms-rule.js';

export { type ExcludedTermsRuleOptions, ExcludedTermsRule } from './rules/excluded-terms-rule.js';

export { type PriceRangeRuleOptions, PriceRangeRule } from './rules/price-range-rule.js';

export { type PriceCurrencyRuleOptions, PriceCurrencyRule } from './rules/price-currency-rule.js';

export { type ConditionRuleOptions, ConditionRule } from './rules/condition-rule.js';
