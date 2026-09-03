import { describe, it, expect } from 'vitest';
import {
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  RecordReviewFeedbackUseCase,
  ReviewItemNotFoundError,
  EvaluationNotFoundError,
  ReviewCoherenceError,
  IneligibleReviewEvaluationError,
  type Clock,
  type IdGenerator,
} from '@busca-ofertas-ai/core';
import {
  type SqliteDatabase,
  SqliteOpportunityRepository,
  SqliteEvaluationRepository,
  SqliteFeedbackRepository,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('RecordReviewFeedbackUseCase (BOAI-015)', () => {
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
      `INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, availability, image_urls, raw_fingerprint)
       VALUES ('obs-1', 'list-1', 'sr-1', '2026-09-03T12:00:00.000Z', 'Switch Lite', 'AVAILABLE', '[]', 'fp-1');`,
    ).run();
  }

  it('records feedback using injected Clock and IdGenerator', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

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

      const mockClock: Clock = {
        now: () => new Date('2026-09-03T13:45:00.000Z'),
      };
      const mockIdGen: IdGenerator = {
        generate: () => 'fb-custom-uuid',
      };

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: mockClock,
        idGenerator: mockIdGen,
      });

      const result = await useCase.execute({
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        decision: 'CONFIRMED_MATCH',
        notes: 'Verified valid listing',
      });

      expect(result.id).toBe('fb-custom-uuid');
      expect(result.opportunityId).toBe('opp-1');
      expect(result.previousEvaluationId).toBe('eval-1');
      expect(result.actor).toBe('LOCAL_USER');
      expect(result.decision).toBe('CONFIRMED_MATCH');
      expect(result.notes).toBe('Verified valid listing');
      expect(result.createdAt.toISOString()).toBe('2026-09-03T13:45:00.000Z');

      const persisted = await fbRepo.getById('fb-custom-uuid');
      expect(persisted).not.toBeNull();
      expect(persisted?.id).toBe('fb-custom-uuid');
    });
  });

  it('fails with ReviewCoherenceError when previousEvaluationId does not match opportunity', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

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

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: { now: () => new Date() },
        idGenerator: { generate: () => 'fb-id' },
      });

      await expect(
        useCase.execute({
          opportunityId: 'opp-1',
          previousEvaluationId: 'eval-different-id',
          decision: 'FALSE_POSITIVE',
        }),
      ).rejects.toThrow(ReviewCoherenceError);
    });
  });

  it('fails with ReviewItemNotFoundError when opportunity does not exist', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: new SqliteOpportunityRepository(db),
        evaluationRepo: new SqliteEvaluationRepository(db),
        feedbackRepo: new SqliteFeedbackRepository(db),
        clock: { now: () => new Date() },
        idGenerator: { generate: () => 'fb-id' },
      });

      await expect(
        useCase.execute({
          opportunityId: 'opp-nonexistent',
          previousEvaluationId: 'eval-1',
          decision: 'CONFIRMED_MATCH',
        }),
      ).rejects.toThrow(ReviewItemNotFoundError);
    });
  });

  it('fails with EvaluationNotFoundError when evaluation does not exist', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);

      // Foreign keys temporarily disabled for this test to insert an orphan opportunity
      db.exec('PRAGMA foreign_keys = OFF;');
      db.prepare(
        `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
         VALUES ('opp-orphan', 'search-1', 'obs-1', 'eval-missing', 'NEW', '2026-09-03T12:00:00.000Z');`,
      ).run();
      db.exec('PRAGMA foreign_keys = ON;');

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: new SqliteEvaluationRepository(db),
        feedbackRepo: new SqliteFeedbackRepository(db),
        clock: { now: () => new Date() },
        idGenerator: { generate: () => 'fb-id' },
      });

      await expect(
        useCase.execute({
          opportunityId: 'opp-orphan',
          previousEvaluationId: 'eval-missing',
          decision: 'CONFIRMED_MATCH',
        }),
      ).rejects.toThrow(EvaluationNotFoundError);
    });
  });

  it('rejects evaluations with decision MATCH, throwing IneligibleReviewEvaluationError and performing 0 writes', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await evalRepo.save(
        createEvaluation({
          id: 'eval-match',
          decision: 'MATCH',
          score: 95,
          reasons: [
            createEvaluationReason({
              code: 'P_ACC',
              message: 'match',
              severity: 'INFO',
              impact: 0,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      await oppRepo.save(
        createOpportunity({
          id: 'opp-match',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-match',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: { now: () => new Date() },
        idGenerator: { generate: () => 'fb-id' },
      });

      await expect(
        useCase.execute({
          opportunityId: 'opp-match',
          previousEvaluationId: 'eval-match',
          decision: 'CONFIRMED_MATCH',
        }),
      ).rejects.toThrow(IneligibleReviewEvaluationError);

      const savedFeedback = await fbRepo.listByOpportunityId('opp-match');
      expect(savedFeedback).toHaveLength(0);
    });
  });

  it('rejects evaluations with decision REJECT, throwing IneligibleReviewEvaluationError and performing 0 writes', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedHierarchy(db);

      const oppRepo = new SqliteOpportunityRepository(db);
      const evalRepo = new SqliteEvaluationRepository(db);
      const fbRepo = new SqliteFeedbackRepository(db);

      await evalRepo.save(
        createEvaluation({
          id: 'eval-reject',
          decision: 'REJECT',
          score: 10,
          reasons: [
            createEvaluationReason({
              code: 'HARD_PRICE',
              message: 'too high',
              severity: 'HARD',
              impact: -90,
            }),
          ],
          evaluatedBy: ['RULES'],
          policyVersion: 'v1',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      await oppRepo.save(
        createOpportunity({
          id: 'opp-reject',
          savedSearchId: 'search-1',
          observationId: 'obs-1',
          evaluationId: 'eval-reject',
          novelty: 'NEW',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      );

      const useCase = new RecordReviewFeedbackUseCase({
        opportunityRepo: oppRepo,
        evaluationRepo: evalRepo,
        feedbackRepo: fbRepo,
        clock: { now: () => new Date() },
        idGenerator: { generate: () => 'fb-id' },
      });

      await expect(
        useCase.execute({
          opportunityId: 'opp-reject',
          previousEvaluationId: 'eval-reject',
          decision: 'NOT_INTERESTED',
        }),
      ).rejects.toThrow(IneligibleReviewEvaluationError);

      const savedFeedback = await fbRepo.listByOpportunityId('opp-reject');
      expect(savedFeedback).toHaveLength(0);
    });
  });
});
