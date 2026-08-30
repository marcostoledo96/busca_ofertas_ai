import { InvariantViolationError } from '../common/index.js';

export type OpportunityNovelty = 'NEW' | 'UNCHANGED' | 'PRICE_CHANGED' | 'REAPPEARED';

export interface Opportunity {
  readonly id: string;
  readonly savedSearchId: string;
  readonly observationId: string;
  readonly evaluationId: string;
  readonly novelty: OpportunityNovelty;
  readonly createdAt: Date;
}

export interface CreateOpportunityParams {
  readonly id: string;
  readonly savedSearchId: string;
  readonly observationId: string;
  readonly evaluationId: string;
  readonly novelty: OpportunityNovelty;
  readonly createdAt: Date;
}

export const createOpportunity = (params: CreateOpportunityParams): Opportunity => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Opportunity id cannot be empty');
  }
  if (typeof params.savedSearchId !== 'string' || params.savedSearchId.trim().length === 0) {
    throw new InvariantViolationError('Opportunity savedSearchId cannot be empty');
  }
  if (typeof params.observationId !== 'string' || params.observationId.trim().length === 0) {
    throw new InvariantViolationError('Opportunity observationId cannot be empty');
  }
  if (typeof params.evaluationId !== 'string' || params.evaluationId.trim().length === 0) {
    throw new InvariantViolationError('Opportunity evaluationId cannot be empty');
  }
  if (!['NEW', 'UNCHANGED', 'PRICE_CHANGED', 'REAPPEARED'].includes(params.novelty)) {
    throw new InvariantViolationError(`Invalid OpportunityNovelty: ${String(params.novelty)}`);
  }
  if (!(params.createdAt instanceof Date) || Number.isNaN(params.createdAt.getTime())) {
    throw new InvariantViolationError('Opportunity createdAt must be a valid Date');
  }

  return {
    id: params.id.trim(),
    savedSearchId: params.savedSearchId.trim(),
    observationId: params.observationId.trim(),
    evaluationId: params.evaluationId.trim(),
    novelty: params.novelty,
    createdAt: params.createdAt,
  };
};
