import {
  type Evaluation,
  type CreateEvaluationParams,
  type EvaluationPolicy,
  applySubsequentEvaluation,
  hasHardRejection,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { type EvaluateRulesOptions, evaluateRules } from './rules-evaluator.js';

/**
 * Pre-AI pipeline execution:
 * Applies purely deterministic rules to the candidate listing observation.
 * Returns an explainable Evaluation with evaluatedBy: ['RULES'].
 */
export const evaluatePreAi = (
  rules: readonly Rule[],
  context: RuleEvaluationContext,
  policy: EvaluationPolicy,
  options?: EvaluateRulesOptions,
): Evaluation => {
  return evaluateRules(rules, context, policy, options);
};

export interface PostAiReconciliationParams {
  readonly id: string;
  readonly decision: 'MATCH' | 'REVIEW' | 'REJECT';
  readonly score: number;
  readonly reasons: CreateEvaluationParams['reasons'];
  readonly policyVersion?: string;
  readonly createdAt: Date;
}

/**
 * Post-AI pipeline reconciliation:
 * Reconciles an AI evaluation outcome with the pre-existing deterministic rules evaluation.
 *
 * Enforces:
 * - Deterministic HARD rejection is absolute and terminal: cannot be promoted to MATCH or REVIEW.
 * - If rules rejected with HARD, any promotion attempt throws InvariantViolationError fail-closed.
 * - On valid promotion (e.g. from REVIEW to MATCH), preserves evaluatedBy as ['RULES', 'AI'].
 */
export const reconcilePostAiEvaluation = (
  deterministicEvaluation: Evaluation,
  aiParams: PostAiReconciliationParams,
): Evaluation => {
  if (
    hasHardRejection(deterministicEvaluation.reasons) &&
    (aiParams.decision === 'MATCH' || aiParams.decision === 'REVIEW')
  ) {
    throw new InvariantViolationError(
      `Deterministic HARD rejection is terminal and cannot be promoted to ${aiParams.decision} by subsequent AI evaluation`,
    );
  }

  const nextParams: CreateEvaluationParams = {
    id: aiParams.id,
    decision: aiParams.decision,
    score: aiParams.score,
    reasons: aiParams.reasons,
    evaluatedBy: ['RULES', 'AI'],
    policyVersion: aiParams.policyVersion ?? deterministicEvaluation.policyVersion,
    createdAt: aiParams.createdAt,
  };

  return applySubsequentEvaluation(deterministicEvaluation, nextParams);
};
