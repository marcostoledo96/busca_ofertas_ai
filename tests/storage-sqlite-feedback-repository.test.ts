import { describe, it, expect } from 'vitest';
import { createFeedback } from '@busca-ofertas-ai/core';
import {
  type SqliteDatabase,
  SqliteFeedbackRepository,
  FeedbackIdentityCollisionError,
  StorageCorruptionError,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteFeedbackRepository (BOAI-015)', () => {
  function seedPrerequisites(db: SqliteDatabase) {
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

    db.prepare(
      `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
       VALUES ('eval-1', 'REVIEW', 65.0, '[{"code":"PRICE_AMBIGUOUS","message":"m","severity":"SOFT","impact":-35}]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
       VALUES ('opp-1', 'search-1', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00.000Z');`,
    ).run();
  }

  it('saves and retrieves a feedback record by ID', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteFeedbackRepository(db);

      const fb = createFeedback({
        id: 'fb-1',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'CONFIRMED_MATCH',
        notes: 'Looks like a great deal',
        createdAt: new Date('2026-09-03T12:10:00.000Z'),
      });

      await repo.save(fb);

      const retrieved = await repo.getById('fb-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('fb-1');
      expect(retrieved?.opportunityId).toBe('opp-1');
      expect(retrieved?.previousEvaluationId).toBe('eval-1');
      expect(retrieved?.actor).toBe('LOCAL_USER');
      expect(retrieved?.decision).toBe('CONFIRMED_MATCH');
      expect(retrieved?.notes).toBe('Looks like a great deal');
      expect(retrieved?.createdAt.toISOString()).toBe('2026-09-03T12:10:00.000Z');
    });
  });

  it('preserves contradictory decisions in append-only chronological history', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteFeedbackRepository(db);

      const fb1 = createFeedback({
        id: 'fb-1',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'CONFIRMED_MATCH',
        notes: 'First decision: relevant',
        createdAt: new Date('2026-09-03T12:10:00.000Z'),
      });

      const fb2 = createFeedback({
        id: 'fb-2',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'FALSE_POSITIVE',
        notes: 'Second decision: changed mind after checking accessories',
        createdAt: new Date('2026-09-03T12:20:00.000Z'),
      });

      const fb3 = createFeedback({
        id: 'fb-3',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'CONFIRMED_MATCH',
        notes: 'Third decision: actually confirmed with seller',
        createdAt: new Date('2026-09-03T12:30:00.000Z'),
      });

      await repo.save(fb1);
      await repo.save(fb2);
      await repo.save(fb3);

      const history = await repo.listByOpportunityId('opp-1');
      expect(history.length).toBe(3);
      expect(history[0]?.id).toBe('fb-1');
      expect(history[0]?.decision).toBe('CONFIRMED_MATCH');
      expect(history[1]?.id).toBe('fb-2');
      expect(history[1]?.decision).toBe('FALSE_POSITIVE');
      expect(history[2]?.id).toBe('fb-3');
      expect(history[2]?.decision).toBe('CONFIRMED_MATCH');
    });
  });

  it('performs idempotent save with identical content and detects collisions with different content', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteFeedbackRepository(db);

      const fb1 = createFeedback({
        id: 'fb-1',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'CONFIRMED_MATCH',
        createdAt: new Date('2026-09-03T12:10:00.000Z'),
      });

      await repo.save(fb1);
      await expect(repo.save(fb1)).resolves.toBeUndefined();

      const conflicting = createFeedback({
        id: 'fb-1',
        opportunityId: 'opp-1',
        previousEvaluationId: 'eval-1',
        actor: 'LOCAL_USER',
        decision: 'NOT_INTERESTED', // different decision!
        createdAt: new Date('2026-09-03T12:10:00.000Z'),
      });

      await expect(repo.save(conflicting)).rejects.toThrow(FeedbackIdentityCollisionError);
    });
  });

  it('throws StorageCorruptionError on non-canonical UTC timestamp during rehydration', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteFeedbackRepository(db);

      db.prepare(
        `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, created_at)
         VALUES ('fb-bad-time', 'opp-1', 'eval-1', 'LOCAL_USER', 'CONFIRMED_MATCH', '2026-09-03T12:00:00Z');`,
      ).run();

      await expect(repo.getById('fb-bad-time')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
