import { DomainError } from '../domain/common/index.js';

export type ReviewErrorCode =
  | 'REVIEW_ITEM_NOT_FOUND'
  | 'EVALUATION_NOT_FOUND'
  | 'OBSERVATION_NOT_FOUND'
  | 'LISTING_NOT_FOUND'
  | 'REVIEW_COHERENCE_ERROR'
  | 'UNSAFE_EXTERNAL_URL'
  | 'INELIGIBLE_REVIEW_EVALUATION';

export class ReviewError extends DomainError {
  readonly code: ReviewErrorCode;

  constructor(message: string, code: ReviewErrorCode) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ReviewItemNotFoundError extends ReviewError {
  constructor(opportunityId: string) {
    super(`Review item for opportunity '${opportunityId}' not found.`, 'REVIEW_ITEM_NOT_FOUND');
    this.name = 'ReviewItemNotFoundError';
  }
}

export class EvaluationNotFoundError extends ReviewError {
  constructor(evaluationId: string) {
    super(`Evaluation '${evaluationId}' not found.`, 'EVALUATION_NOT_FOUND');
    this.name = 'EvaluationNotFoundError';
  }
}

export class ReviewCoherenceError extends ReviewError {
  constructor(message: string) {
    super(message, 'REVIEW_COHERENCE_ERROR');
    this.name = 'ReviewCoherenceError';
  }
}

export class UnsafeExternalUrlError extends ReviewError {
  constructor(message: string) {
    super(message, 'UNSAFE_EXTERNAL_URL');
    this.name = 'UnsafeExternalUrlError';
  }
}

export class IneligibleReviewEvaluationError extends ReviewError {
  constructor(evaluationId: string, decision: string) {
    super(
      `Evaluation '${evaluationId}' with decision '${decision}' is not eligible for manual review feedback. Only 'REVIEW' evaluations are eligible.`,
      'INELIGIBLE_REVIEW_EVALUATION',
    );
    this.name = 'IneligibleReviewEvaluationError';
  }
}
