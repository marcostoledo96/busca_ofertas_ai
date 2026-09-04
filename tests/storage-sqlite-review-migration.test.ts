import { describe, it, expect } from 'vitest';
import {
  openSqliteDatabase,
  PRODUCTION_MIGRATIONS,
  MigrationFailedError,
  type Migration,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  withTempDatabase,
  createTempDatabaseContext,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('Storage SQLite Review & Feedback Migration 004 (BOAI-015)', () => {
  it('migrates clean database through all 4 migrations and creates all tables, triggers, and indices', () => {
    withTempDatabase(
      (db) => {
        const result = db.migrate();
        expect(result.currentVersion).toBe(4);
        expect(result.newlyAppliedCount).toBe(4);

        // Check tables exist
        const tables = db
          .prepare<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('evaluations', 'opportunities', 'feedback') ORDER BY name ASC;",
          )
          .all();
        expect(tables.map((t) => t.name)).toEqual(['evaluations', 'feedback', 'opportunities']);

        // Check triggers exist
        const triggers = db
          .prepare<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = 'feedback' ORDER BY name ASC;",
          )
          .all();
        expect(triggers.map((t) => t.name)).toEqual([
          'trg_feedback_no_delete',
          'trg_feedback_no_update',
        ]);

        // Check indices exist
        const indices = db
          .prepare<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('evaluations', 'opportunities', 'feedback') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
          )
          .all();
        const indexNames = indices.map((i) => i.name);
        expect(indexNames).toContain('idx_evaluations_decision');
        expect(indexNames).toContain('idx_opportunities_saved_search_id');
        expect(indexNames).toContain('idx_opportunities_observation_id');
        expect(indexNames).toContain('idx_opportunities_evaluation_id');
        expect(indexNames).toContain('idx_feedback_opportunity_created');
        expect(indexNames).toContain('idx_feedback_decision');
      },
      { customMigrations: PRODUCTION_MIGRATIONS.slice(0, 4) },
    );
  });

  it('enforces table check constraints on evaluations, opportunities, and feedback', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Seed valid saved_search, run, source_run, listing, observation
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

      // Evaluations: invalid decision rejected
      expect(() => {
        db.prepare(
          `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
           VALUES ('ev-bad-dec', 'MAYBE', 50.0, '[]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Evaluations: score < 0 or > 100 rejected
      expect(() => {
        db.prepare(
          `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
           VALUES ('ev-bad-score', 'MATCH', 105.0, '[]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Evaluations: invalid JSON reasons rejected
      expect(() => {
        db.prepare(
          `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
           VALUES ('ev-bad-json', 'MATCH', 50.0, 'not-json', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Seed valid evaluation
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-1', 'REVIEW', 65.0, '[{"code":"PRICE_AMBIGUOUS","message":"Price suspicious","severity":"SOFT","impact":-35}]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();

      // Opportunities: invalid novelty rejected
      expect(() => {
        db.prepare(
          `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
           VALUES ('opp-bad', 'search-1', 'obs-1', 'eval-1', 'INVALID_NOVELTY', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Opportunities: foreign key violation rejected
      expect(() => {
        db.prepare(
          `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
           VALUES ('opp-bad-fk', 'search-nonexistent', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Seed valid opportunity
      db.prepare(
        `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
         VALUES ('opp-1', 'search-1', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00.000Z');`,
      ).run();

      // Feedback: invalid actor rejected
      expect(() => {
        db.prepare(
          `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, created_at)
           VALUES ('fb-bad-actor', 'opp-1', 'eval-1', 'REMOTE_BOT', 'CONFIRMED_MATCH', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Feedback: invalid decision rejected
      expect(() => {
        db.prepare(
          `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, created_at)
           VALUES ('fb-bad-dec', 'opp-1', 'eval-1', 'LOCAL_USER', 'INVALID_DECISION', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();

      // Feedback: notes length > 2000 rejected
      expect(() => {
        const longNotes = 'a'.repeat(2001);
        db.prepare(
          `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at)
           VALUES ('fb-long-notes', 'opp-1', 'eval-1', 'LOCAL_USER', 'CONFIRMED_MATCH', ?, '2026-09-03T12:00:00.000Z');`,
        ).run(longNotes);
      }).toThrow();

      // Feedback: FK mismatch (previous_evaluation_id does not match opportunity's evaluation) rejected
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-other', 'MATCH', 90.0, '[]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();

      expect(() => {
        db.prepare(
          `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, created_at)
           VALUES ('fb-mismatch-eval', 'opp-1', 'eval-other', 'LOCAL_USER', 'CONFIRMED_MATCH', '2026-09-03T12:00:00.000Z');`,
        ).run();
      }).toThrow();
    });
  });

  it('enforces append-only immutability via SQLite triggers aborting UPDATE and DELETE on feedback', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Seed valid hierarchy
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
         VALUES ('eval-1', 'REVIEW', 65.0, '[]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();
      db.prepare(
        `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
         VALUES ('opp-1', 'search-1', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00.000Z');`,
      ).run();

      db.prepare(
        `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at)
         VALUES ('fb-1', 'opp-1', 'eval-1', 'LOCAL_USER', 'CONFIRMED_MATCH', 'Initial deal', '2026-09-03T12:00:00.000Z');`,
      ).run();

      // Trigger test: UPDATE raises ABORT
      expect(() => {
        db.prepare(`UPDATE feedback SET decision = 'FALSE_POSITIVE' WHERE id = 'fb-1';`).run();
      }).toThrow(/Feedback records are append-only and cannot be updated/);

      // Trigger test: DELETE raises ABORT
      expect(() => {
        db.prepare(`DELETE FROM feedback WHERE id = 'fb-1';`).run();
      }).toThrow(/Feedback records are append-only and cannot be deleted/);

      // Verify row is still intact
      const row = db
        .prepare<{ decision: string; notes: string }, [string]>(
          'SELECT decision, notes FROM feedback WHERE id = ?',
        )
        .get('fb-1');
      expect(row?.decision).toBe('CONFIRMED_MATCH');
      expect(row?.notes).toBe('Initial deal');
    });
  });

  it('rolls back completely when migration 004 fails midway, leaving database clean at version 3', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Step 1: Apply migrations 1, 2, 3
      const v3Migrations = PRODUCTION_MIGRATIONS.slice(0, 3);
      const dbV3 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: v3Migrations,
      });
      dbV3.migrate();
      expect(dbV3.getCurrentSchemaVersion()).toBe(3);
      dbV3.close();

      // Step 2: Attempt to apply faulty migration 4
      const faultyMigration004: Migration = {
        version: 4,
        name: '004_faulty_migration',
        up(migCtx) {
          migCtx.exec('CREATE TABLE evaluations (id TEXT PRIMARY KEY);');
          // Syntax error causing failure halfway through
          migCtx.exec('THIS IS INVALID SQL STATEMENT AND WILL FAIL;');
        },
      };

      const dbFaulty = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: [...v3Migrations, faultyMigration004],
      });

      expect(() => dbFaulty.migrate()).toThrow(MigrationFailedError);
      expect(dbFaulty.getCurrentSchemaVersion()).toBe(3);

      // Verify partial evaluations table was rolled back and does not exist
      const evalCheck = dbFaulty
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
        )
        .get('evaluations');
      expect(evalCheck).toBeUndefined();

      dbFaulty.close();
    } finally {
      ctx.cleanup();
    }
  });
});
