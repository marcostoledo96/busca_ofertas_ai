import { InvariantViolationError } from '../common/index.js';

export type EvaluationSeverity = 'INFO' | 'SOFT' | 'HARD';

export interface EvaluationReason {
  readonly code: string;
  readonly message: string;
  readonly impact: number;
  readonly severity: EvaluationSeverity;
  readonly evidence?: string;
}

export interface CreateEvaluationReasonParams {
  readonly code: string;
  readonly message: string;
  readonly impact: number;
  readonly severity: EvaluationSeverity;
  readonly evidence?: string;
}

export const createEvaluationReason = (params: CreateEvaluationReasonParams): EvaluationReason => {
  if (typeof params.code !== 'string' || params.code.trim().length === 0) {
    throw new InvariantViolationError('EvaluationReason code cannot be empty');
  }
  if (typeof params.message !== 'string' || params.message.trim().length === 0) {
    throw new InvariantViolationError('EvaluationReason message cannot be empty');
  }
  if (typeof params.impact !== 'number' || !Number.isFinite(params.impact)) {
    throw new InvariantViolationError('EvaluationReason impact must be a finite number');
  }
  if (!['INFO', 'SOFT', 'HARD'].includes(params.severity)) {
    throw new InvariantViolationError(`Invalid EvaluationSeverity: ${String(params.severity)}`);
  }

  return {
    code: params.code.trim(),
    message: params.message.trim(),
    impact: params.impact,
    severity: params.severity,
    ...(params.evidence !== undefined ? { evidence: params.evidence } : {}),
  };
};
