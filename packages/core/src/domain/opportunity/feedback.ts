import { InvariantViolationError } from '../common/index.js';

export type FeedbackDecision =
  'CONFIRMED_MATCH' | 'FALSE_POSITIVE' | 'PRICE_INCORRECT' | 'NOT_INTERESTED' | 'OTHER';

export type FeedbackActor = 'LOCAL_USER';

export interface Feedback {
  readonly id: string;
  readonly opportunityId: string;
  readonly previousEvaluationId: string;
  readonly actor: FeedbackActor;
  readonly decision: FeedbackDecision;
  readonly notes?: string;
  readonly createdAt: Date;
}

export interface CreateFeedbackParams {
  readonly id: string;
  readonly opportunityId: string;
  readonly previousEvaluationId: string;
  readonly actor: FeedbackActor;
  readonly decision: FeedbackDecision;
  readonly notes?: string;
  readonly createdAt: Date;
}

export const createFeedback = (params: CreateFeedbackParams): Feedback => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Feedback id cannot be empty');
  }
  if (typeof params.opportunityId !== 'string' || params.opportunityId.trim().length === 0) {
    throw new InvariantViolationError('Feedback opportunityId cannot be empty');
  }
  if (
    typeof params.previousEvaluationId !== 'string' ||
    params.previousEvaluationId.trim().length === 0
  ) {
    throw new InvariantViolationError('Feedback previousEvaluationId cannot be empty');
  }
  if (params.actor !== 'LOCAL_USER') {
    throw new InvariantViolationError(`Invalid FeedbackActor: ${String(params.actor)}`);
  }
  if (
    !['CONFIRMED_MATCH', 'FALSE_POSITIVE', 'PRICE_INCORRECT', 'NOT_INTERESTED', 'OTHER'].includes(
      params.decision,
    )
  ) {
    throw new InvariantViolationError(`Invalid FeedbackDecision: ${String(params.decision)}`);
  }
  if (params.notes !== undefined) {
    if (typeof params.notes !== 'string') {
      throw new InvariantViolationError('Feedback notes must be a string if provided');
    }
    if (params.notes.length > 2000) {
      throw new InvariantViolationError(
        `Feedback notes cannot exceed 2000 characters, got ${params.notes.length}`,
      );
    }
  }
  if (!(params.createdAt instanceof Date) || Number.isNaN(params.createdAt.getTime())) {
    throw new InvariantViolationError('Feedback createdAt must be a valid Date');
  }

  return {
    id: params.id.trim(),
    opportunityId: params.opportunityId.trim(),
    previousEvaluationId: params.previousEvaluationId.trim(),
    actor: params.actor,
    decision: params.decision,
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
    createdAt: params.createdAt,
  };
};
