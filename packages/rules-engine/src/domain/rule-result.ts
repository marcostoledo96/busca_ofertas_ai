import {
  type EvaluationReason,
  type EvaluationSeverity,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';

export interface RuleResult {
  readonly ruleId: string;
  readonly triggered: boolean;
  readonly impact: number;
  readonly severity: EvaluationSeverity;
  readonly reasons: readonly EvaluationReason[];
}

export interface CreateRuleResultParams {
  readonly ruleId: string;
  readonly triggered: boolean;
  readonly impact: number;
  readonly severity: EvaluationSeverity;
  readonly reasons?: readonly EvaluationReason[];
}

export const createRuleResult = (params: CreateRuleResultParams): RuleResult => {
  if (typeof params.ruleId !== 'string' || params.ruleId.trim().length === 0) {
    throw new InvariantViolationError('RuleResult ruleId cannot be empty');
  }

  if (typeof params.triggered !== 'boolean') {
    throw new InvariantViolationError('RuleResult triggered must be a boolean');
  }

  if (typeof params.impact !== 'number' || !Number.isFinite(params.impact)) {
    throw new InvariantViolationError(
      `RuleResult impact must be a finite number, got ${String(params.impact)}`,
    );
  }

  if (!['INFO', 'SOFT', 'HARD'].includes(params.severity)) {
    throw new InvariantViolationError(`Invalid RuleResult severity: ${String(params.severity)}`);
  }

  const reasons = params.reasons ? [...params.reasons] : [];

  // Enforce severity coherence with reason severity:
  // If any reason is HARD, the rule result severity must be HARD
  if (reasons.some((r) => r.severity === 'HARD') && params.severity !== 'HARD') {
    throw new InvariantViolationError(
      'RuleResult severity must be HARD when any contained reason has HARD severity',
    );
  }

  return {
    ruleId: params.ruleId.trim(),
    triggered: params.triggered,
    impact: params.impact,
    severity: params.severity,
    reasons,
  };
};

/**
 * Creates a standard non-triggered result with zero impact and no reasons.
 */
export const createNotTriggeredResult = (ruleId: string): RuleResult => {
  return createRuleResult({
    ruleId,
    triggered: false,
    impact: 0,
    severity: 'INFO',
    reasons: [],
  });
};
