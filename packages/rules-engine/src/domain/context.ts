import {
  type Listing,
  type Observation,
  type SavedSearch,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';

/**
 * Pure evaluation context provided to all rules.
 * Does not mutate listings, observations, or search definitions.
 */
export interface RuleEvaluationContext {
  readonly listing: Listing;
  readonly observation: Observation;
  readonly savedSearch: SavedSearch;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateRuleEvaluationContextParams {
  readonly listing: Listing;
  readonly observation: Observation;
  readonly savedSearch: SavedSearch;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const createRuleEvaluationContext = (
  params: CreateRuleEvaluationContextParams,
): RuleEvaluationContext => {
  if (!params.listing || typeof params.listing !== 'object') {
    throw new InvariantViolationError('RuleEvaluationContext requires a valid listing');
  }
  if (!params.observation || typeof params.observation !== 'object') {
    throw new InvariantViolationError('RuleEvaluationContext requires a valid observation');
  }
  if (!params.savedSearch || typeof params.savedSearch !== 'object') {
    throw new InvariantViolationError('RuleEvaluationContext requires a valid savedSearch');
  }

  // Verify relational coherence if listingId exists on observation
  if (params.observation.listingId !== params.listing.id) {
    throw new InvariantViolationError(
      `Observation listingId (${params.observation.listingId}) does not match Listing id (${params.listing.id})`,
    );
  }

  return {
    listing: params.listing,
    observation: params.observation,
    savedSearch: params.savedSearch,
    ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
  };
};
