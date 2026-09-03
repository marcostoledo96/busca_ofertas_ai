import type { ReviewQueueService } from './review-queue-service.js';

export type PostRunReviewChoice = 'NOW' | 'LATER' | 'REPORT_ONLY';

export interface PostRunReviewAction {
  readonly action: 'START_REVIEW' | 'CONTINUE_TO_MENU' | 'REPORT_ONLY';
  readonly writesPerformed: 0;
}

/**
 * PostRunReviewCoordinator coordinates the user prompt after an execution run.
 * Checks whether any opportunities in REVIEW status remain pending for the run.
 * If pending reviews exist, determines the appropriate action without performing any mutations.
 */
export class PostRunReviewCoordinator {
  constructor(private readonly reviewQueueService: ReviewQueueService) {}

  public async getPendingReviewCount(runId: string, signal?: AbortSignal): Promise<number> {
    const pending = await this.reviewQueueService.getPendingReviewQueueByRunId(runId, signal);
    return pending.length;
  }

  public resolveChoiceAction(choice: PostRunReviewChoice): PostRunReviewAction {
    switch (choice) {
      case 'NOW':
        return { action: 'START_REVIEW', writesPerformed: 0 };
      case 'LATER':
        return { action: 'CONTINUE_TO_MENU', writesPerformed: 0 };
      case 'REPORT_ONLY':
        return { action: 'REPORT_ONLY', writesPerformed: 0 };
    }
  }
}
