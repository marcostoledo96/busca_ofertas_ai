import { describe, it, expect } from 'vitest';
import { createOpportunity } from '@busca-ofertas-ai/core';
import {
  type SqliteDatabase,
  SqliteOpportunityRepository,
  OpportunityIdentityCollisionError,
  StorageCorruptionError,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteOpportunityRepository (BOAI-015)', () => {
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
      `INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, availability, image_urls, raw_fingerprint)
       VALUES ('obs-2', 'list-1', 'sr-1', '2026-09-03T12:01:00.000Z', 'Switch OLED', 'AVAILABLE', '[]', 'fp-2');`,
    ).run();

    db.prepare(
      `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
       VALUES ('eval-1', 'REVIEW', 65.0, '[{"code":"PRICE_AMBIGUOUS","message":"m","severity":"SOFT","impact":-35}]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
       VALUES ('eval-2', 'REVIEW', 70.0, '[{"code":"TITLE_AMBIGUOUS","message":"m","severity":"SOFT","impact":-30}]', '["RULES"]', 'v1', '2026-09-03T12:01:00.000Z');`,
    ).run();
  }

  it('saves and retrieves an opportunity by ID', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteOpportunityRepository(db);

      const opp = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(opp);

      const retrieved = await repo.getById('opp-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('opp-1');
      expect(retrieved?.savedSearchId).toBe('search-1');
      expect(retrieved?.observationId).toBe('obs-1');
      expect(retrieved?.evaluationId).toBe('eval-1');
      expect(retrieved?.novelty).toBe('NEW');
      expect(retrieved?.createdAt.toISOString()).toBe('2026-09-03T12:00:00.000Z');
    });
  });

  it('lists opportunities by savedSearchId ordered by created_at ASC, id ASC', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteOpportunityRepository(db);

      const opp2 = createOpportunity({
        id: 'opp-2',
        savedSearchId: 'search-1',
        observationId: 'obs-2',
        evaluationId: 'eval-2',
        novelty: 'PRICE_CHANGED',
        createdAt: new Date('2026-09-03T12:01:00.000Z'),
      });

      const opp1 = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(opp2);
      await repo.save(opp1);

      const list = await repo.listBySavedSearchId('search-1');
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe('opp-1');
      expect(list[1]?.id).toBe('opp-2');
    });
  });

  it('lists opportunities by runId joining observation and source_runs', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteOpportunityRepository(db);

      const opp1 = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(opp1);

      const runItems = await repo.listByRunId('run-1');
      expect(runItems.length).toBe(1);
      expect(runItems[0]?.id).toBe('opp-1');

      const nonExistentRunItems = await repo.listByRunId('run-nonexistent');
      expect(nonExistentRunItems).toEqual([]);
    });
  });

  it('performs idempotent save with identical content and detects collisions with different content', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteOpportunityRepository(db);

      const opp1 = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(opp1);
      await expect(repo.save(opp1)).resolves.toBeUndefined();

      const conflicting = createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-2', // different observation!
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await expect(repo.save(conflicting)).rejects.toThrow(OpportunityIdentityCollisionError);
    });
  });

  it('throws StorageCorruptionError on non-canonical UTC timestamp during rehydration', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      seedPrerequisites(db);
      const repo = new SqliteOpportunityRepository(db);

      db.prepare(
        `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
         VALUES ('opp-bad-time', 'search-1', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00Z');`,
      ).run();

      await expect(repo.getById('opp-bad-time')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
