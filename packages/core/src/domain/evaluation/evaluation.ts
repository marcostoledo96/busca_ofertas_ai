import { InvariantViolationError } from '../common/index.js';
import { EvaluationReason } from './evaluation-reason.js';

export type EvaluationDecision = 'MATCH' | 'REVIEW' | 'REJECT';
export type EvaluatorType = 'RULES' | 'AI' | 'USER';

export interface Evaluation {
  readonly id: string;
  readonly decision: EvaluationDecision;
  readonly score: number;
  readonly reasons: readonly EvaluationReason[];
  readonly evaluatedBy: readonly EvaluatorType[];
  readonly policyVersion: string;
  readonly createdAt: Date;
}

export interface CreateEvaluationParams {
  readonly id: string;
  readonly decision: EvaluationDecision;
  readonly score: number;
  readonly reasons: readonly EvaluationReason[];
  readonly evaluatedBy: readonly EvaluatorType[];
  readonly policyVersion: string;
  readonly createdAt: Date;
}

export const hasHardRejection = (reasons: readonly EvaluationReason[]): boolean => {
  return reasons.some((reason) => reason.severity === 'HARD');
};

export const canPromoteToMatch = (evaluation: Evaluation): boolean => {
  if (evaluation.decision === 'REJECT' && hasHardRejection(evaluation.reasons)) {
    return false;
  }
  return true;
};

export const canPromoteToReview = (evaluation: Evaluation): boolean => {
  if (evaluation.decision === 'REJECT' && hasHardRejection(evaluation.reasons)) {
    return false;
  }
  return true;
};

export const createEvaluation = (params: CreateEvaluationParams): Evaluation => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Evaluation id cannot be empty');
  }

  if (!['MATCH', 'REVIEW', 'REJECT'].includes(params.decision)) {
    throw new InvariantViolationError(`Invalid EvaluationDecision: ${String(params.decision)}`);
  }

  if (
    typeof params.score !== 'number' ||
    !Number.isFinite(params.score) ||
    params.score < 0 ||
    params.score > 100
  ) {
    throw new InvariantViolationError(
      `Evaluation score must be a finite number between 0 and 100, got ${String(params.score)}`,
    );
  }

  if (
    !Array.isArray(params.reasons) ||
    (params.reasons as readonly EvaluationReason[]).length === 0
  ) {
    throw new InvariantViolationError('Evaluation must contain at least one EvaluationReason');
  }

  if (
    !Array.isArray(params.evaluatedBy) ||
    (params.evaluatedBy as readonly EvaluatorType[]).length === 0
  ) {
    throw new InvariantViolationError('Evaluation must declare at least one EvaluatorType');
  }

  if (typeof params.policyVersion !== 'string' || params.policyVersion.trim().length === 0) {
    throw new InvariantViolationError('Evaluation policyVersion cannot be empty');
  }

  if (!(params.createdAt instanceof Date) || Number.isNaN(params.createdAt.getTime())) {
    throw new InvariantViolationError('Evaluation createdAt must be a valid Date');
  }

  const reasons: readonly EvaluationReason[] = (
    params.reasons as readonly EvaluationReason[]
  ).slice();
  const evaluatedBy: readonly EvaluatorType[] = (
    params.evaluatedBy as readonly EvaluatorType[]
  ).slice();

  // Enforce decision coherence with reason severity
  if (hasHardRejection(reasons) && params.decision !== 'REJECT') {
    throw new InvariantViolationError(
      `Evaluation containing a HARD severity reason must have REJECT decision, got ${params.decision}`,
    );
  }

  return {
    id: params.id.trim(),
    decision: params.decision,
    score: params.score,
    reasons,
    evaluatedBy,
    policyVersion: params.policyVersion.trim(),
    createdAt: params.createdAt,
  };
};

/**
 * Applies a subsequent evaluation update onto a previous Evaluation,
 * strictly upholding the invariant that a deterministic HARD rejection is terminal
 * and cannot be overridden to MATCH or REVIEW.
 */
export const applySubsequentEvaluation = (
  previousEvaluation: Evaluation,
  nextEvaluationParams: CreateEvaluationParams,
): Evaluation => {
  if (
    previousEvaluation.decision === 'REJECT' &&
    hasHardRejection(previousEvaluation.reasons) &&
    (nextEvaluationParams.decision === 'MATCH' || nextEvaluationParams.decision === 'REVIEW')
  ) {
    throw new InvariantViolationError(
      `Deterministic HARD rejection is terminal and cannot be promoted to ${nextEvaluationParams.decision} by subsequent evaluation`,
    );
  }

  return createEvaluation(nextEvaluationParams);
};
