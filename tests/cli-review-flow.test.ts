import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createResolvedPrice,
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  createFeedback,
  ReviewQueueService,
  RecordReviewFeedbackUseCase,
  SystemClock,
  UuidIdGenerator,
} from '@busca-ofertas-ai/core';
import {
  FakeTerminal,
  InMemoryProgressReporter,
  InMemoryDiagnosticLogger,
  ReviewListingsActionHandler,
  type ActionExecutionContext,
} from '@busca-ofertas-ai/cli';
import {
  type SqliteDatabase,
  SqliteObservationRepository,
  SqliteOpportunityRepository,
  SqliteEvaluationRepository,
  SqliteFeedbackRepository,
  SqliteListingRepository,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('CLI Review Flow (BOAI-015)', () => {
  function seedHierarchy(db: SqliteDatabase) {
    db.prepare(
      `INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
       VALUES ('search-1', 1, 'Switch', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');`,
    ).run();

    db.prepare(
      `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
       VALUES ('run-1', 'search-1', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
       VALUES ('sr-1', 'run-1', 'synth-source', '1.0.0', 'SUCCESS', 1, 1, 1, 1, 1, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-1', 'synth-source', 'ext-1', 'https://example.com/1', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-2', 'synth-source', 'ext-2', 'https://example.com/2', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
    ).run();
  }

  function makeObs(id: string, listingId: string, srId: string, title: string) {
    return createObservation({
      id,
      listingId,
      sourceRunId: srId,
      observedAt: new Date('2026-09-03T12:00:00.000Z'),
      title,
      price: createResolvedPrice({
        rawText: '$200.000',
        amount: 200000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 1.0,
        evidence: ['$200.000'],
        kind: 'TOTAL',
      }),
      location: {
        rawText: 'Palermo',
        city: 'Palermo',
        region: 'CABA',
      },
      condition: 'GOOD',
      availability: 'AVAILABLE',
      imageUrls: [],
      rawFingerprint: `fp-${id}`,
    });
  }

  function makeContext(terminal: FakeTerminal, signal: AbortSignal): ActionExecutionContext {
    return {
      terminal,
      signal,
      progress: new InMemoryProgressReporter(),
      diagnostics: new InMemoryDiagnosticLogger(),
    };
  }

  it('reviews pending items by run and records confirmed match feedback with notes', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await obsRepo.save(makeObs('obs-1', 'list-1', 'sr-1', 'Nintendo Switch Lite'));
      await evalRepo.save(
        createEvaluation({
          id: 'eval-1',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({
              code: 'PRICE_AMBIGUOUS',
              message: 'Price is low',
              severity: 'SOFT',
              impact: -35,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-1',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-1',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const queueService = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      const recordUseCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

      const terminal = new FakeTerminal();
      // Flow:
      // 1: Option 1 (Pendientes por ejecución)
      // run-1: Run ID
      // 1: Option 1 (CONFIRMED_MATCH)
      // Buen precio y caja completa: Notes
      // 0: Exit submenu
      terminal.enqueueInput('1', 'run-1', '1', 'Buen precio y caja completa', '0');

      const handler = new ReviewListingsActionHandler({
        reviewQueueService: queueService,
        recordFeedbackUseCase: recordUseCase,
      });

      const result = await handler.execute(makeContext(terminal, new AbortController().signal));
      expect(result.kind).toBe('continue');

      // Verify feedback was persisted
      const feedbackList = await fbRepo.listByOpportunityId('opp-1');
      expect(feedbackList.length).toBe(1);
      expect(feedbackList[0]?.decision).toBe('CONFIRMED_MATCH');
      expect(feedbackList[0]?.notes).toBe('Buen precio y caja completa');

      // Verify item is no longer in pending queue
      const pendingAfter = await queueService.getPendingReviewQueueByRunId('run-1');
      expect(pendingAfter.length).toBe(0);
    });
  });

  it('omits an item leaving it in pending queue with 0 feedback writes', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await obsRepo.save(makeObs('obs-1', 'list-1', 'sr-1', 'Nintendo Switch Lite'));
      await evalRepo.save(
        createEvaluation({
          id: 'eval-1',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({
              code: 'PRICE_AMBIGUOUS',
              message: 'Price is low',
              severity: 'SOFT',
              impact: -35,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-1',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-1',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const queueService = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      const recordUseCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

      const terminal = new FakeTerminal();
      // Flow:
      // 1: Option 1 (Pendientes por ejecución)
      // run-1: Run ID
      // 5: Option 5 (Omitir)
      // 0: Exit submenu
      terminal.enqueueInput('1', 'run-1', '5', '0');

      const handler = new ReviewListingsActionHandler({
        reviewQueueService: queueService,
        recordFeedbackUseCase: recordUseCase,
      });

      await handler.execute(makeContext(terminal, new AbortController().signal));

      // Invariant: 0 feedback writes
      const feedbackList = await fbRepo.listByOpportunityId('opp-1');
      expect(feedbackList.length).toBe(0);

      // Invariant: item remains pending
      const pendingAfter = await queueService.getPendingReviewQueueByRunId('run-1');
      expect(pendingAfter.length).toBe(1);
    });
  });

  it('allows re-review from recent history preserving contradictory decisions append-only', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await obsRepo.save(makeObs('obs-1', 'list-1', 'sr-1', 'Nintendo Switch Lite'));
      await evalRepo.save(
        createEvaluation({
          id: 'eval-1',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({
              code: 'PRICE_AMBIGUOUS',
              message: 'Price is low',
              severity: 'SOFT',
              impact: -35,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-1',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-1',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      // Seed initial feedback
      await fbRepo.save(
        createFeedback({
          id: 'fb-1',
          opportunityId: 'opp-1',
          previousEvaluationId: 'eval-1',
          actor: 'LOCAL_USER',
          decision: 'CONFIRMED_MATCH',
          notes: 'Initial evaluation',
          createdAt: new Date('2026-09-03T12:05:00.000Z'),
        }),
      );

      const queueService = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      const recordUseCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

      const terminal = new FakeTerminal();
      // Flow:
      // 3: Option 3 (Ver historial reciente)
      // search-1: Search ID
      // 1: Select item 1
      // 1: Action 1 (Registrar nueva decisión / re-evaluar)
      // 3: Select 3 (FALSE_POSITIVE)
      // Cambié de opinión luego de consultar al vendedor: Note
      // 0: Back to history list
      // 0: Back to main review menu
      // 0: Exit to main menu
      terminal.enqueueInput(
        '3',
        'search-1',
        '1',
        '1',
        '3',
        'Cambié de opinión luego de consultar al vendedor',
        '0',
        '0',
        '0',
      );

      const handler = new ReviewListingsActionHandler({
        reviewQueueService: queueService,
        recordFeedbackUseCase: recordUseCase,
      });

      await handler.execute(makeContext(terminal, new AbortController().signal));

      // Verify both feedback records exist in chronological order
      const history = await fbRepo.listByOpportunityId('opp-1');
      expect(history.length).toBe(2);
      expect(history[0]?.decision).toBe('CONFIRMED_MATCH');
      expect(history[0]?.notes).toBe('Initial evaluation');
      expect(history[1]?.decision).toBe('FALSE_POSITIVE');
      expect(history[1]?.notes).toBe('Cambié de opinión luego de consultar al vendedor');
    });
  });

  it('strips ANSI sequences from observation title and notes in presentation', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      // Title with ANSI colors
      const ansiTitle = '\x1b[31mNintendo\x1b[0m \x1b[1mSwitch\x1b[0m Lite';
      await obsRepo.save(makeObs('obs-ansi', 'list-1', 'sr-1', ansiTitle));

      await evalRepo.save(
        createEvaluation({
          id: 'eval-1',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({
              code: 'PRICE_AMBIGUOUS',
              message: 'm',
              severity: 'SOFT',
              impact: -35,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-ansi',
          savedSearchId: 'search-1',
          observationId: 'obs-ansi',
          evaluationId: 'eval-1',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const queueService = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      const recordUseCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

      const terminal = new FakeTerminal();
      terminal.enqueueInput('1', 'run-1', '5', '0');

      const handler = new ReviewListingsActionHandler({
        reviewQueueService: queueService,
        recordFeedbackUseCase: recordUseCase,
      });

      await handler.execute(makeContext(terminal, new AbortController().signal));

      // Check output does NOT contain raw escape sequence '\x1b['
      const allOutput = terminal.getRawOutput();
      expect(allOutput).toContain('Nintendo Switch Lite');
      expect(allOutput).not.toContain('\x1b[31m');
      expect(allOutput).not.toContain('\x1b[0m');
    });
  });
});
