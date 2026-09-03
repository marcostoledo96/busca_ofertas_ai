import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createResolvedPrice,
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  createFeedback,
  ReviewQueueService,
} from '@busca-ofertas-ai/core';
import {
  type SqliteDatabase,
  SqliteObservationRepository,
  SqliteOpportunityRepository,
  SqliteEvaluationRepository,
  SqliteFeedbackRepository,
  SqliteListingRepository,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('ReviewQueueService (BOAI-015)', () => {
  function seedHierarchy(db: SqliteDatabase) {
    db.prepare(
      `INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
       VALUES ('search-1', 1, 'Switch', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');`,
    ).run();

    db.prepare(
      `INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
       VALUES ('search-2', 1, 'PS5', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');`,
    ).run();

    db.prepare(
      `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
       VALUES ('run-1', 'search-1', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
       VALUES ('run-2', 'search-1', 'SUCCESS', '2026-09-03T12:10:00.000Z', '2026-09-03T12:15:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
       VALUES ('run-other-search', 'search-2', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
       VALUES ('sr-1', 'run-1', 'synth-source', '1.0.0', 'SUCCESS', 1, 1, 1, 1, 1, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
       VALUES ('sr-2', 'run-2', 'synth-source', '1.0.0', 'SUCCESS', 1, 1, 1, 1, 1, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:10:00.000Z', '2026-09-03T12:15:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
       VALUES ('sr-other', 'run-other-search', 'synth-source', '1.0.0', 'SUCCESS', 1, 1, 1, 1, 1, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-1', 'synth-source', 'ext-1', 'https://example.com/1', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-2', 'synth-source', 'ext-2', 'https://example.com/2', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-3', 'synth-source', 'ext-3', 'https://example.com/3', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
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

  it('filters strictly by decision === REVIEW and excludes MATCH and REJECT', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await obsRepo.save(makeObs('obs-1', 'list-1', 'sr-1', 'Review Item'));
      await obsRepo.save(makeObs('obs-2', 'list-2', 'sr-1', 'Match Item'));
      await obsRepo.save(makeObs('obs-3', 'list-3', 'sr-1', 'Reject Item'));

      const evalReview = createEvaluation({
        id: 'eval-rev',
        decision: 'REVIEW',
        score: 60,
        reasons: [
          createEvaluationReason({ code: 'P_AMB', message: 'm', severity: 'SOFT', impact: -40 }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      const evalMatch = createEvaluation({
        id: 'eval-mat',
        decision: 'MATCH',
        score: 95,
        reasons: [
          createEvaluationReason({ code: 'T_MAT', message: 'm', severity: 'INFO', impact: 0 }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      const evalReject = createEvaluation({
        id: 'eval-rej',
        decision: 'REJECT',
        score: 10,
        reasons: [
          createEvaluationReason({ code: 'T_MIS', message: 'm', severity: 'HARD', impact: -100 }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await evalRepo.save(evalReview);
      await evalRepo.save(evalMatch);
      await evalRepo.save(evalReject);

      await oppRepo.save(
        createOpportunity({
          id: 'opp-rev',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-rev',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-mat',
          savedSearchId: 'search-1',
          observationId: 'obs-2',
          evaluationId: 'eval-mat',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );
      await oppRepo.save(
        createOpportunity({
          id: 'opp-rej',
          savedSearchId: 'search-1',
          observationId: 'obs-3',
          evaluationId: 'eval-rej',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const service = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      const pending = await service.getPendingReviewQueueByRunId('run-1');
      expect(pending.length).toBe(1);
      expect(pending[0]?.opportunity.id).toBe('opp-rev');
      expect(pending[0]?.evaluation.decision).toBe('REVIEW');
    });
  });

  it('excludes opportunities with prior feedback from pending queue and includes them in history', async () => {
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

      const eval1 = createEvaluation({
        id: 'eval-1',
        decision: 'REVIEW',
        score: 65,
        reasons: [
          createEvaluationReason({ code: 'P_AMB', message: 'm', severity: 'SOFT', impact: -35 }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      const eval2 = createEvaluation({
        id: 'eval-2',
        decision: 'REVIEW',
        score: 65,
        reasons: [
          createEvaluationReason({ code: 'P_AMB', message: 'm', severity: 'SOFT', impact: -35 }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      await evalRepo.save(eval1);
      await evalRepo.save(eval2);

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

      const service = new ReviewQueueService({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        observationRepo: obsRepo,
        listingRepo: listingRepo,
        feedbackRepo: fbRepo,
      });

      // Before feedback: both are pending
      const pendingBefore = await service.getPendingReviewQueueBySavedSearchId('search-1');
      expect(pendingBefore.length).toBe(2);

      // Record feedback for opp-1
      await fbRepo.save(
        createFeedback({
          id: 'fb-1',
          opportunityId: 'opp-1',
          previousEvaluationId: 'eval-1',
          actor: 'LOCAL_USER',
          decision: 'CONFIRMED_MATCH',
          createdAt: new Date('2026-09-03T12:05:00.000Z'),
        }),
      );

      // After feedback: only opp-2 is pending
      const pendingAfter = await service.getPendingReviewQueueBySavedSearchId('search-1');
      expect(pendingAfter.length).toBe(1);
      expect(pendingAfter[0]?.opportunity.id).toBe('opp-2');

      // History contains opp-1
      const history = await service.getRecentHistoryBySavedSearchId('search-1');
      expect(history.length).toBe(1);
      expect(history[0]?.opportunity.id).toBe('opp-1');
      expect(history[0]?.feedbackHistory.length).toBe(1);
      expect(history[0]?.feedbackHistory[0]?.decision).toBe('CONFIRMED_MATCH');
    });
  });

  it('aborts cooperatively via AbortSignal without performing queries', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const service = new ReviewQueueService({
        opportunityRepo: new SqliteOpportunityRepository(db),
        evaluationRepo: new SqliteEvaluationRepository(db),
        observationRepo: new SqliteObservationRepository(db),
        listingRepo: new SqliteListingRepository(db),
        feedbackRepo: new SqliteFeedbackRepository(db),
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        service.getPendingReviewQueueByRunId('run-1', controller.signal),
      ).rejects.toThrow(/aborted/i);
    });
  });
});
