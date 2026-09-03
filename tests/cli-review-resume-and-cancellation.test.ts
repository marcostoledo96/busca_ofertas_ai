import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createResolvedPrice,
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
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

describe('CLI Review Resume & Cancellation (BOAI-015)', () => {
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
       VALUES ('sr-1', 'run-1', 'synth-source', '1.0.0', 'SUCCESS', 2, 1, 1, 2, 2, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
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

  it('handles interruption mid-queue without writing partial feedback and resumes seamlessly', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await obsRepo.save(makeObs('obs-1', 'list-1', 'sr-1', 'Item 1'));
      await obsRepo.save(makeObs('obs-2', 'list-2', 'sr-1', 'Item 2'));

      await evalRepo.save(
        createEvaluation({
          id: 'eval-1',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({ code: 'P_AMB', message: 'm', severity: 'SOFT', impact: -35 }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await evalRepo.save(
        createEvaluation({
          id: 'eval-2',
          decision: 'REVIEW',
          score: 65,
          reasons: [
            createEvaluationReason({ code: 'P_AMB', message: 'm', severity: 'SOFT', impact: -35 }),
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
      await oppRepo.save(
        createOpportunity({
          id: 'opp-2',
          savedSearchId: 'search-1',
          observationId: 'obs-2',
          evaluationId: 'eval-2',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:01:00.000Z'),
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

      const handler = new ReviewListingsActionHandler({
        reviewQueueService: queueService,
        recordFeedbackUseCase: recordUseCase,
      });

      // Session 1: Decide item 1, then abort on item 2
      const controller1 = new AbortController();
      const terminal1 = new FakeTerminal();

      // Enqueue inputs:
      // 1: Option 1
      // run-1: Run ID
      // 1: Decide item 1 (CONFIRMED_MATCH)
      // Note for item 1
      // 0: Exit item 2 prompt
      // 0: Exit submenu
      terminal1.enqueueInput('1', 'run-1', '1', 'Note 1', '0', '0');

      const context1: ActionExecutionContext = {
        terminal: terminal1,
        signal: controller1.signal,
        progress: new InMemoryProgressReporter(),
        diagnostics: new InMemoryDiagnosticLogger(),
      };

      await handler.execute(context1);

      // Verify item 1 has feedback, item 2 has 0 feedback
      expect(await fbRepo.listByOpportunityId('opp-1')).toHaveLength(1);
      expect(await fbRepo.listByOpportunityId('opp-2')).toHaveLength(0);

      // Session 2: Resumes and only item 2 is pending
      const pendingResumed = await queueService.getPendingReviewQueueByRunId('run-1');
      expect(pendingResumed).toHaveLength(1);
      expect(pendingResumed[0]?.opportunity.id).toBe('opp-2');

      // Finish item 2 in session 2
      const terminal2 = new FakeTerminal();
      terminal2.enqueueInput('1', 'run-1', '2', 'Note 2', '0');
      const context2: ActionExecutionContext = {
        terminal: terminal2,
        signal: new AbortController().signal,
        progress: new InMemoryProgressReporter(),
        diagnostics: new InMemoryDiagnosticLogger(),
      };

      await handler.execute(context2);

      // Both are now decided
      expect(await fbRepo.listByOpportunityId('opp-2')).toHaveLength(1);
      const pendingFinal = await queueService.getPendingReviewQueueByRunId('run-1');
      expect(pendingFinal).toHaveLength(0);
    });
  });
});
