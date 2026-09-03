import { describe, it, expect } from 'vitest';
import {
  createDefaultMenuActions,
  createCliApplication,
  ReviewListingsActionHandler,
  CreateSearchActionHandler,
  EditSearchActionHandler,
  ConfigurationActionHandler,
  NotImplementedActionHandler,
  ExitActionHandler,
} from '@busca-ofertas-ai/cli';
import {
  type OpportunityRepository,
  type EvaluationRepository,
  type ObservationRepository,
  type ListingRepository,
  type FeedbackRepository,
  type ExternalUrlOpenerPort,
  ReviewQueueService,
  RecordReviewFeedbackUseCase,
  SystemClock,
  UuidIdGenerator,
} from '@busca-ofertas-ai/core';

describe('CLI Review Composition Root & Seams (BOAI-015)', () => {
  it('wires Option 5 as ReviewListingsActionHandler and keeps options 1, 4, 6 as NotImplementedActionHandler', () => {
    const actions = createDefaultMenuActions();
    expect(actions).toHaveLength(8);

    const action1 = actions.find((a) => a.optionNumber === 1);
    expect(action1).toBeInstanceOf(NotImplementedActionHandler);
    expect(action1?.id).toBe('run-search');

    const action2 = actions.find((a) => a.optionNumber === 2);
    expect(action2).toBeInstanceOf(CreateSearchActionHandler);

    const action3 = actions.find((a) => a.optionNumber === 3);
    expect(action3).toBeInstanceOf(EditSearchActionHandler);

    const action4 = actions.find((a) => a.optionNumber === 4);
    expect(action4).toBeInstanceOf(NotImplementedActionHandler);
    expect(action4?.id).toBe('view-history');

    const action5 = actions.find((a) => a.optionNumber === 5);
    expect(action5).toBeInstanceOf(ReviewListingsActionHandler);
    expect(action5?.id).toBe('review-listings');
    expect(action5?.title).toBe('Revisar publicaciones dudosas');

    const action6 = actions.find((a) => a.optionNumber === 6);
    expect(action6).toBeInstanceOf(NotImplementedActionHandler);
    expect(action6?.id).toBe('source-errors');

    const action7 = actions.find((a) => a.optionNumber === 7);
    expect(action7).toBeInstanceOf(ConfigurationActionHandler);

    const action8 = actions.find((a) => a.optionNumber === 8);
    expect(action8).toBeInstanceOf(ExitActionHandler);
  });

  it('injects custom review services into composition root via createCliApplication', () => {
    const dummyOpportunityRepo: OpportunityRepository = {
      getById: () => Promise.resolve(null),
      listBySavedSearchId: () => Promise.resolve([]),
      listByRunId: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    };
    const dummyEvalRepo: EvaluationRepository = {
      getById: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    };
    const dummyObsRepo: ObservationRepository = {
      getById: () => Promise.resolve(null),
      listByListingId: () => Promise.resolve([]),
      listBySourceRunId: () => Promise.resolve([]),
      recordObservation: () => Promise.reject(new Error('not implemented')),
      save: () => Promise.resolve(),
    };
    const dummyListingRepo: ListingRepository = {
      getById: () => Promise.resolve(null),
      getBySourceAndExternalId: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    };
    const dummyFeedbackRepo: FeedbackRepository = {
      getById: () => Promise.resolve(null),
      listByOpportunityId: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    };

    const customQueueService = new ReviewQueueService({
      opportunityRepo: dummyOpportunityRepo,
      evaluationRepo: dummyEvalRepo,
      observationRepo: dummyObsRepo,
      listingRepo: dummyListingRepo,
      feedbackRepo: dummyFeedbackRepo,
    });

    const customRecordUseCase = new RecordReviewFeedbackUseCase({
      opportunityRepo: dummyOpportunityRepo,
      evaluationRepo: dummyEvalRepo,
      feedbackRepo: dummyFeedbackRepo,
      clock: new SystemClock(),
      idGenerator: new UuidIdGenerator(),
    });

    let openedUrl = '';
    const customUrlOpener: ExternalUrlOpenerPort = {
      open: (url: string) => {
        openedUrl = url;
        return Promise.resolve();
      },
    };

    const app = createCliApplication({
      reviewQueueService: customQueueService,
      recordFeedbackUseCase: customRecordUseCase,
      externalUrlOpener: customUrlOpener,
    });

    expect(app.shell).toBeDefined();
    expect(openedUrl).toBe('');
  });
});
