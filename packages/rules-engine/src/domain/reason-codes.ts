import {
  type EvaluationSeverity,
  type EvaluationReason,
  createEvaluationReason,
} from '@busca-ofertas-ai/core';

/**
 * Contractual reason code catalog for the deterministic rules engine.
 * These identifiers are stable machine codes, decoupled from human-readable copy.
 */
export const EvaluationReasonCodes = {
  // Baseline / Default
  DEFAULT_BASELINE: 'RULES_DEFAULT_BASELINE',
  NO_RULES_TRIGGERED: 'RULES_NO_RULES_TRIGGERED',

  // Query & Text Matching
  REQUIRED_TERM_MATCH: 'RULES_REQUIRED_TERM_MATCH',
  REQUIRED_TERM_MISSING: 'RULES_REQUIRED_TERM_MISSING',
  EXCLUDED_TERM_MATCH: 'RULES_EXCLUDED_TERM_MATCH',

  // Price & Currency Evaluation
  PRICE_WITHIN_LIMIT: 'RULES_PRICE_WITHIN_LIMIT',
  PRICE_EXCEEDS_MAXIMUM: 'RULES_PRICE_EXCEEDS_MAXIMUM',
  PRICE_BELOW_MINIMUM_PLAUSIBLE: 'RULES_PRICE_BELOW_MINIMUM_PLAUSIBLE',
  PRICE_AMBIGUOUS_CURRENCY: 'RULES_PRICE_AMBIGUOUS_CURRENCY',
  PRICE_MISSING: 'RULES_PRICE_MISSING',

  // Listing Condition
  CONDITION_ACCEPTED: 'RULES_CONDITION_ACCEPTED',
  CONDITION_REJECTED: 'RULES_CONDITION_REJECTED',
  CONDITION_UNKNOWN: 'RULES_CONDITION_UNKNOWN',

  // Boolean Expression Combinators
  BOOLEAN_AND_SATISFIED: 'RULES_BOOLEAN_AND_SATISFIED',
  BOOLEAN_AND_UNSATISFIED: 'RULES_BOOLEAN_AND_UNSATISFIED',
  BOOLEAN_OR_SATISFIED: 'RULES_BOOLEAN_OR_SATISFIED',
  BOOLEAN_OR_UNSATISFIED: 'RULES_BOOLEAN_OR_UNSATISFIED',
  BOOLEAN_NOT_SATISFIED: 'RULES_BOOLEAN_NOT_SATISFIED',
  BOOLEAN_NOT_UNSATISFIED: 'RULES_BOOLEAN_NOT_UNSATISFIED',

  // Hard Rejections
  HARD_EXCLUSION: 'RULES_HARD_EXCLUSION',
} as const;

export type EvaluationReasonCode =
  (typeof EvaluationReasonCodes)[keyof typeof EvaluationReasonCodes] | (string & {});

export interface CreateEngineReasonParams {
  readonly code: EvaluationReasonCode;
  readonly message: string;
  readonly impact: number;
  readonly severity: EvaluationSeverity;
  readonly evidence?: string;
}

/**
 * Helper to produce a canonical EvaluationReason using stable engine codes.
 */
export const createEngineReason = (params: CreateEngineReasonParams): EvaluationReason => {
  return createEvaluationReason({
    code: params.code,
    message: params.message,
    impact: params.impact,
    severity: params.severity,
    ...(params.evidence !== undefined ? { evidence: params.evidence } : {}),
  });
};
