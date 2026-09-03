import type { Opportunity } from '../domain/opportunity/opportunity.js';
import type { Evaluation } from '../domain/evaluation/evaluation.js';
import type { Observation } from '../domain/listing/observation.js';
import type { Listing } from '../domain/listing/listing.js';
import type { Feedback } from '../domain/opportunity/feedback.js';

/**
 * ReviewItem aggregates all factual entities required to present and decide
 * a reviewable opportunity in the application review flow.
 */
export interface ReviewItem {
  readonly opportunity: Opportunity;
  readonly evaluation: Evaluation;
  readonly observation: Observation;
  readonly listing: Listing;
  readonly feedbackHistory: readonly Feedback[];
}
