import type {
  OpportunityRepository,
  EvaluationRepository,
  ObservationRepository,
  ListingRepository,
  FeedbackRepository,
} from '../ports/repositories.js';
import type { Opportunity } from '../domain/opportunity/opportunity.js';
import type { ReviewItem } from './review-item.js';
import { EvaluationNotFoundError, ReviewCoherenceError } from './review-errors.js';

export interface ReviewQueueServiceDependencies {
  readonly opportunityRepo: OpportunityRepository;
  readonly evaluationRepo: EvaluationRepository;
  readonly observationRepo: ObservationRepository;
  readonly listingRepo: ListingRepository;
  readonly feedbackRepo: FeedbackRepository;
}

export class ReviewQueueService {
  private readonly opportunityRepo: OpportunityRepository;
  private readonly evaluationRepo: EvaluationRepository;
  private readonly observationRepo: ObservationRepository;
  private readonly listingRepo: ListingRepository;
  private readonly feedbackRepo: FeedbackRepository;

  constructor(dependencies: ReviewQueueServiceDependencies) {
    this.opportunityRepo = dependencies.opportunityRepo;
    this.evaluationRepo = dependencies.evaluationRepo;
    this.observationRepo = dependencies.observationRepo;
    this.listingRepo = dependencies.listingRepo;
    this.feedbackRepo = dependencies.feedbackRepo;
  }

  private checkSignal(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
    }
  }

  private async buildReviewItem(
    opportunity: Opportunity,
    signal?: AbortSignal,
  ): Promise<ReviewItem> {
    this.checkSignal(signal);

    const evaluation = await this.evaluationRepo.getById(opportunity.evaluationId);
    if (!evaluation) {
      throw new EvaluationNotFoundError(opportunity.evaluationId);
    }

    this.checkSignal(signal);
    const observation = await this.observationRepo.getById(opportunity.observationId);
    if (!observation) {
      throw new ReviewCoherenceError(
        `Observation '${opportunity.observationId}' not found for opportunity '${opportunity.id}'.`,
      );
    }

    this.checkSignal(signal);
    const listing = await this.listingRepo.getById(observation.listingId);
    if (!listing) {
      throw new ReviewCoherenceError(
        `Listing '${observation.listingId}' not found for observation '${observation.id}'.`,
      );
    }

    this.checkSignal(signal);
    const feedbackHistory = await this.feedbackRepo.listByOpportunityId(opportunity.id);

    return {
      opportunity,
      evaluation,
      observation,
      listing,
      feedbackHistory,
    };
  }

  /**
   * Retrieves all pending review items for a specific execution run.
   * An opportunity is pending if and only if evaluation.decision === 'REVIEW'
   * and no feedback has been recorded yet (feedbackHistory is empty).
   */
  public async getPendingReviewQueueByRunId(
    runId: string,
    signal?: AbortSignal,
  ): Promise<readonly ReviewItem[]> {
    this.checkSignal(signal);
    const opportunities = await this.opportunityRepo.listByRunId(runId);
    const items: ReviewItem[] = [];

    for (const opp of opportunities) {
      this.checkSignal(signal);
      const item = await this.buildReviewItem(opp, signal);
      if (item.evaluation.decision === 'REVIEW' && item.feedbackHistory.length === 0) {
        items.push(item);
      }
    }

    return items.sort((a, b) => {
      const timeDiff = a.opportunity.createdAt.getTime() - b.opportunity.createdAt.getTime();
      return timeDiff !== 0 ? timeDiff : a.opportunity.id.localeCompare(b.opportunity.id);
    });
  }

  /**
   * Retrieves all pending review items for a saved search.
   */
  public async getPendingReviewQueueBySavedSearchId(
    savedSearchId: string,
    signal?: AbortSignal,
  ): Promise<readonly ReviewItem[]> {
    this.checkSignal(signal);
    const opportunities = await this.opportunityRepo.listBySavedSearchId(savedSearchId);
    const items: ReviewItem[] = [];

    for (const opp of opportunities) {
      this.checkSignal(signal);
      const item = await this.buildReviewItem(opp, signal);
      if (item.evaluation.decision === 'REVIEW' && item.feedbackHistory.length === 0) {
        items.push(item);
      }
    }

    return items.sort((a, b) => {
      const timeDiff = a.opportunity.createdAt.getTime() - b.opportunity.createdAt.getTime();
      return timeDiff !== 0 ? timeDiff : a.opportunity.id.localeCompare(b.opportunity.id);
    });
  }

  /**
   * Retrieves reviewed opportunities (items with existing feedback) for inspection and re-review.
   */
  public async getRecentHistoryBySavedSearchId(
    savedSearchId: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<readonly ReviewItem[]> {
    this.checkSignal(signal);
    const opportunities = await this.opportunityRepo.listBySavedSearchId(savedSearchId);
    const items: ReviewItem[] = [];

    for (const opp of opportunities) {
      this.checkSignal(signal);
      const item = await this.buildReviewItem(opp, signal);
      if (item.feedbackHistory.length > 0) {
        items.push(item);
      }
    }

    // Sort by latest feedback timestamp descending, tie-broken by opportunity id
    items.sort((a, b) => {
      const lastA = a.feedbackHistory[a.feedbackHistory.length - 1]!;
      const lastB = b.feedbackHistory[b.feedbackHistory.length - 1]!;
      const diff = lastB.createdAt.getTime() - lastA.createdAt.getTime();
      return diff !== 0 ? diff : b.opportunity.id.localeCompare(a.opportunity.id);
    });

    return items.slice(0, limit);
  }

  /**
   * Retrieves a single review item by opportunity ID.
   */
  public async getReviewItemByOpportunityId(
    opportunityId: string,
    signal?: AbortSignal,
  ): Promise<ReviewItem | null> {
    this.checkSignal(signal);
    const opportunity = await this.opportunityRepo.getById(opportunityId);
    if (!opportunity) {
      return null;
    }
    return this.buildReviewItem(opportunity, signal);
  }
}
