import type {
  FeedbackRepository,
  OpportunityRepository,
  EvaluationRepository,
} from '../ports/repositories.js';
import type { Clock, IdGenerator } from '../domain/common/index.js';
import {
  type Feedback,
  type FeedbackDecision,
  createFeedback,
} from '../domain/opportunity/feedback.js';
import {
  ReviewItemNotFoundError,
  EvaluationNotFoundError,
  ReviewCoherenceError,
} from './review-errors.js';

export interface RecordReviewFeedbackDependencies {
  readonly feedbackRepo: FeedbackRepository;
  readonly opportunityRepo: OpportunityRepository;
  readonly evaluationRepo: EvaluationRepository;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface RecordReviewFeedbackParams {
  readonly opportunityId: string;
  readonly previousEvaluationId: string;
  readonly decision: FeedbackDecision;
  readonly notes?: string;
}

/**
 * Use case: Records a user review decision as an immutable, append-only Feedback record.
 * Guarantees relational coherence between the opportunity and its evaluation,
 * leaving the original Observation, Listing, and Evaluation completely untouched.
 */
export class RecordReviewFeedbackUseCase {
  private readonly feedbackRepo: FeedbackRepository;
  private readonly opportunityRepo: OpportunityRepository;
  private readonly evaluationRepo: EvaluationRepository;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;

  constructor(dependencies: RecordReviewFeedbackDependencies) {
    this.feedbackRepo = dependencies.feedbackRepo;
    this.opportunityRepo = dependencies.opportunityRepo;
    this.evaluationRepo = dependencies.evaluationRepo;
    this.clock = dependencies.clock;
    this.idGenerator = dependencies.idGenerator;
  }

  public async execute(params: RecordReviewFeedbackParams): Promise<Feedback> {
    const opportunity = await this.opportunityRepo.getById(params.opportunityId);
    if (!opportunity) {
      throw new ReviewItemNotFoundError(params.opportunityId);
    }

    if (opportunity.evaluationId !== params.previousEvaluationId) {
      throw new ReviewCoherenceError(
        `Previous evaluation mismatch for opportunity '${params.opportunityId}': expected '${opportunity.evaluationId}', got '${params.previousEvaluationId}'.`,
      );
    }

    const evaluation = await this.evaluationRepo.getById(params.previousEvaluationId);
    if (!evaluation) {
      throw new EvaluationNotFoundError(params.previousEvaluationId);
    }

    const feedback = createFeedback({
      id: this.idGenerator.generate(),
      opportunityId: opportunity.id,
      previousEvaluationId: opportunity.evaluationId,
      actor: 'LOCAL_USER',
      decision: params.decision,
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      createdAt: this.clock.now(),
    });

    await this.feedbackRepo.save(feedback);

    return feedback;
  }
}
