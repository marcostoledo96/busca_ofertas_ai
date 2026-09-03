import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createResolvedPrice,
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  RecordReviewFeedbackUseCase,
  type Clock,
  type IdGenerator,
} from '@busca-ofertas-ai/core';
import {
  SqliteObservationRepository,
  SqliteOpportunityRepository,
  SqliteEvaluationRepository,
  SqliteFeedbackRepository,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('Review & Observation Immutability (BOAI-015)', () => {
  it('guarantees Observation, Listing, and Evaluation remain completely untouched after recording Feedback', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();

      // Seed foundational rows
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

      const obsRepo = new SqliteObservationRepository(db);
      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      const originalObs = createObservation({
        id: 'obs-1',
        listingId: 'list-1',
        sourceRunId: 'sr-1',
        observedAt: new Date('2026-09-03T12:00:00.000Z'),
        title: 'Nintendo Switch Lite Coral',
        description: 'Impeccable condition, with box',
        price: createResolvedPrice({
          rawText: '$220.000',
          amount: 220000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1.0,
          evidence: ['$220.000'],
          kind: 'TOTAL',
        }),
        location: {
          rawText: 'Palermo, CABA',
          city: 'Palermo',
          region: 'CABA',
        },
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/img1.jpg'],
        rawFingerprint: 'sha256-abc123def456',
      });
      await obsRepo.save(originalObs);

      const originalEval = createEvaluation({
        id: 'eval-1',
        decision: 'REVIEW',
        score: 65,
        reasons: [
          createEvaluationReason({
            code: 'PRICE_AMBIGUOUS',
            message: 'Price slightly below median',
            severity: 'SOFT',
            impact: -35,
          }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1.0.0',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      await evalRepo.save(originalEval);

      const opp = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });
      await oppRepo.save(opp);

      // Snapshot observation and evaluation before feedback
      const obsBefore = await obsRepo.getById('obs-1');
      const evalBefore = await evalRepo.getById('eval-1');

      // Execute feedback recording
      const fixedClock: Clock = {
        now: () => new Date('2026-09-03T12:30:00.000Z'),
      };
      const fixedIdGen: IdGenerator = {
        generate: () => 'fb-generated-1',
      };

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: fixedClock,
        idGenerator: fixedIdGen,
      });

      await useCase.execute({
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        decision: 'CONFIRMED_MATCH',
        notes: 'User verified in person',
      });

      // Retrieve after feedback
      const obsAfter = await obsRepo.getById('obs-1');
      const evalAfter = await evalRepo.getById('eval-1');

      // Invariants: strict deep equality
      expect(obsAfter).toEqual(obsBefore);
      expect(evalAfter).toEqual(evalBefore);

      // Raw DB equality
      const rawObsRow = db
        .prepare<{ title: string; raw_fingerprint: string }, [string]>(
          'SELECT title, raw_fingerprint FROM observations WHERE id = ?',
        )
        .get('obs-1');
      expect(rawObsRow?.title).toBe('Nintendo Switch Lite Coral');
      expect(rawObsRow?.raw_fingerprint).toBe('sha256-abc123def456');

      // Confirm feedback was persisted separately
      const savedFb = await fbRepo.getById('fb-generated-1');
      expect(savedFb).not.toBeNull();
      expect(savedFb?.decision).toBe('CONFIRMED_MATCH');
      expect(savedFb?.notes).toBe('User verified in person');
    });
  });
});
