import { describe, it, expect } from 'vitest';
import {
  openSqliteDatabase,
  PRODUCTION_MIGRATIONS,
  SqliteRawArtifactRepository,
  RawArtifactIdentityCollisionError,
  MigrationFailedError,
  type Migration,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  withTempDatabase,
  createTempDatabaseContext,
} from '@busca-ofertas-ai/storage-sqlite/testing';
import { createRawArtifact } from '@busca-ofertas-ai/core';

describe('Storage SQLite Raw Artifacts Migration 005 & Repository (BOAI-016)', () => {
  it('migrates clean database through all 5 migrations and creates raw_artifacts table and indices', () => {
    withTempDatabase((db) => {
      const result = db.migrate();
      expect(result.currentVersion).toBe(5);
      expect(result.newlyAppliedCount).toBe(5);

      // Verify table exists
      const tableCheck = db
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('raw_artifacts');
      expect(tableCheck?.name).toBe('raw_artifacts');

      // Verify composite index on source_runs(id, run_id)
      const srIndex = db
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_source_runs_id_run_id';",
        )
        .get();
      expect(srIndex?.name).toBe('idx_source_runs_id_run_id');

      // Verify indices on raw_artifacts
      const indices = db
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'raw_artifacts' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
        )
        .all();
      const indexNames = indices.map((i) => i.name);
      expect(indexNames).toContain('idx_raw_artifacts_expires_at');
      expect(indexNames).toContain('idx_raw_artifacts_fingerprint');
      expect(indexNames).toContain('idx_raw_artifacts_reason');
      expect(indexNames).toContain('idx_raw_artifacts_run_id');
      expect(indexNames).toContain('idx_raw_artifacts_source_run_id');
    });
  });

  it('enforces composite foreign key coherence on (source_run_id, run_id) and rejects cross-association', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Seed valid saved_search
      db.prepare(
        `
        INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
        VALUES ('search-1', 1, 'Switch', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');
      `,
      ).run();

      // Seed 2 distinct runs
      db.prepare(
        `
        INSERT INTO runs (id, saved_search_id, status, started_at)
        VALUES ('run-alpha', 'search-1', 'RUNNING', '2026-09-03T12:00:00.000Z');
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO runs (id, saved_search_id, status, started_at)
        VALUES ('run-beta', 'search-1', 'RUNNING', '2026-09-03T12:05:00.000Z');
      `,
      ).run();

      // Seed source_run associated with run-alpha
      db.prepare(
        `
        INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, started_at)
        VALUES ('sr-alpha-1', 'run-alpha', 'synthetic', '1.0.0', 'RUNNING', '2026-09-03T12:00:00.000Z');
      `,
      ).run();

      // 1. Positive case: valid matching pair (sr-alpha-1, run-alpha) succeeds
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-valid', '2026-09/art_valid.txt', 'HTTP_PAYLOAD', 100, 'fp-1', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', 'run-alpha', 'sr-alpha-1', 'text/plain'
          );
        `,
        ).run();
      }).not.toThrow();

      // 2. Negative case: cross-association mismatch (sr-alpha-1 with run-beta) FAILS with FOREIGN KEY constraint failed
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-mismatch', '2026-09/art_mismatch.txt', 'HTTP_PAYLOAD', 100, 'fp-2', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', 'run-beta', 'sr-alpha-1', 'text/plain'
          );
        `,
        ).run();
      }).toThrow(/FOREIGN KEY/i);

      // 3. Negative case: existing source_run_id with NULL run_id FAILS CHECK constraint chk_raw_artifacts_source_run_has_run
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-null-run-1', '2026-09/art_null_run_1.txt', 'HTTP_PAYLOAD', 100, 'fp-3', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', NULL, 'sr-alpha-1', 'text/plain'
          );
        `,
        ).run();
      }).toThrow(/CHECK constraint failed.*chk_raw_artifacts_source_run_has_run/i);

      // 4. Negative case: nonexistent source_run_id with NULL run_id FAILS CHECK constraint chk_raw_artifacts_source_run_has_run
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-null-run-2', '2026-09/art_null_run_2.txt', 'HTTP_PAYLOAD', 100, 'fp-4', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', NULL, 'sr-nonexistent', 'text/plain'
          );
        `,
        ).run();
      }).toThrow(/CHECK constraint failed.*chk_raw_artifacts_source_run_has_run/i);

      // 5. Positive case: NULL source_run_id with valid run_id succeeds
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-null-source', '2026-09/art_null_source.txt', 'HTTP_PAYLOAD', 100, 'fp-5', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', 'run-alpha', NULL, 'text/plain'
          );
        `,
        ).run();
      }).not.toThrow();

      // 6. Positive case: NULL source_run_id with NULL run_id succeeds
      expect(() => {
        db.prepare(
          `
          INSERT INTO raw_artifacts (
            id, relative_path, kind, size_bytes, fingerprint, reason,
            created_at, expires_at, run_id, source_run_id, content_type
          ) VALUES (
            'art-orphan-valid', '2026-09/art_orphan_valid.txt', 'HTTP_PAYLOAD', 100, 'fp-6', 'ERROR',
            '2026-09-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z', NULL, NULL, 'text/plain'
          );
        `,
        ).run();
      }).not.toThrow();
    });
  });

  it('preserves migrations 001-004 metadata and sequence immutably', () => {
    expect(PRODUCTION_MIGRATIONS).toHaveLength(5);
    expect(PRODUCTION_MIGRATIONS[0]?.version).toBe(1);
    expect(PRODUCTION_MIGRATIONS[0]?.name).toBe('001_create_schema_migrations');
    expect(PRODUCTION_MIGRATIONS[1]?.version).toBe(2);
    expect(PRODUCTION_MIGRATIONS[1]?.name).toBe('002_create_operational_persistence');
    expect(PRODUCTION_MIGRATIONS[2]?.version).toBe(3);
    expect(PRODUCTION_MIGRATIONS[2]?.name).toBe('003_create_observation_history');
    expect(PRODUCTION_MIGRATIONS[3]?.version).toBe(4);
    expect(PRODUCTION_MIGRATIONS[3]?.name).toBe('004_create_review_feedback_persistence');
    expect(PRODUCTION_MIGRATIONS[4]?.version).toBe(5);
    expect(PRODUCTION_MIGRATIONS[4]?.name).toBe('005_create_raw_artifacts_persistence');
  });

  it('migrates incrementally from v4 to v5 seamlessly retaining existing operational data', async () => {
    const ctx = createTempDatabaseContext();
    try {
      // Step 1: Migrate up to v4
      const v4Migrations: readonly Migration[] = PRODUCTION_MIGRATIONS.slice(0, 4);
      const dbV4 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: v4Migrations,
      });
      const v4Result = dbV4.migrate();
      expect(v4Result.currentVersion).toBe(4);

      // Insert operational records at v4
      dbV4
        .prepare(
          `
        INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
        VALUES ('search-1', 1, 'Search V4', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');
      `,
        )
        .run();
      dbV4
        .prepare(
          `
        INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
        VALUES ('run-1', 'search-1', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');
      `,
        )
        .run();
      dbV4.close();

      // Step 2: Open with full production migrations (applies v5)
      const dbV5 = openSqliteDatabase({
        databasePath: ctx.databasePath,
      });
      const v5Result = dbV5.migrate();
      expect(v5Result.previousVersion).toBe(4);
      expect(v5Result.currentVersion).toBe(5);
      expect(v5Result.newlyAppliedCount).toBe(1);

      // Verify v4 data is intact
      const runRow = dbV5
        .prepare<{ id: string }, [string]>('SELECT id FROM runs WHERE id = ?')
        .get('run-1');
      expect(runRow?.id).toBe('run-1');

      // Verify raw_artifacts table is usable
      const repo = new SqliteRawArtifactRepository(dbV5);
      const art = createRawArtifact({
        id: 'art-after-migrate',
        relativePath: '2026-09/art_post_migrate.txt',
        kind: 'DIAGNOSTIC',
        sizeBytes: 50,
        fingerprint: 'fp-pm',
        reason: 'DIAGNOSTIC',
        contentType: 'text/plain',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
        expiresAt: new Date('2026-10-03T12:00:00.000Z'),
        runId: 'run-1',
      });
      await expect(repo.save(art)).resolves.toBeUndefined();

      dbV5.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rolls back completely when migration 005 fails midway, leaving database clean at version 4', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Step 1: Migrate up to v4
      const v4Migrations: readonly Migration[] = PRODUCTION_MIGRATIONS.slice(0, 4);
      const dbV4 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: v4Migrations,
      });
      dbV4.migrate();
      expect(dbV4.getCurrentSchemaVersion()).toBe(4);
      dbV4.close();

      // Step 2: Attempt faulty migration 005 that crashes after executing some SQL
      const faultyMigration5: Migration = {
        version: 5,
        name: '005_faulty_migration',
        up(context) {
          context.exec('CREATE TABLE temp_canary_005 (id INT PRIMARY KEY);');
          throw new Error('Simulated crash midway through migration 005');
        },
      };

      const dbFailing = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: [...v4Migrations, faultyMigration5],
      });

      expect(() => dbFailing.migrate()).toThrow(MigrationFailedError);

      // Verify rollback: version stays at 4, canary table does not exist
      expect(dbFailing.getCurrentSchemaVersion()).toBe(4);
      const canaryCheck = dbFailing
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('temp_canary_005');
      expect(canaryCheck).toBeUndefined();

      dbFailing.close();
    } finally {
      ctx.cleanup();
    }
  });

  describe('SqliteRawArtifactRepository CRUD and queries', () => {
    it('persists, queries, lists by runId/sourceRunId/expired, computes totals, and deletes cleanly', async () => {
      await withTempDatabase(async (db) => {
        db.migrate();
        const repo = new SqliteRawArtifactRepository(db);

        // Seed run and source_run
        db.prepare(
          `
          INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
          VALUES ('search-1', 1, 'Search', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');
        `,
        ).run();
        db.prepare(
          `
          INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
          VALUES ('run-1', 'search-1', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');
        `,
        ).run();
        db.prepare(
          `
          INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
          VALUES ('sr-1', 'run-1', 'synthetic', '1.0.0', 'SUCCESS', 0, 0, 0, 0, 0, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');
        `,
        ).run();

        const art1 = createRawArtifact({
          id: 'art-1',
          relativePath: '2026-09/art_1.json',
          kind: 'PAYLOAD',
          sizeBytes: 250,
          fingerprint: 'fp-art-1',
          reason: 'ERROR',
          contentType: 'application/json',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
          expiresAt: new Date('2026-09-10T12:00:00.000Z'),
          runId: 'run-1',
          sourceRunId: 'sr-1',
          metadata: { httpStatus: 500, retryCount: 2 },
        });

        const art2 = createRawArtifact({
          id: 'art-2',
          relativePath: '2026-09/art_2.txt',
          kind: 'LOG',
          sizeBytes: 350,
          fingerprint: 'fp-art-2',
          reason: 'REVIEW',
          contentType: 'text/plain',
          createdAt: new Date('2026-09-03T12:05:00.000Z'),
          expiresAt: new Date('2026-10-03T12:05:00.000Z'),
          runId: 'run-1',
          sourceRunId: null,
        });

        await repo.save(art1);
        await repo.save(art2);

        // Get by ID
        const fetched1 = await repo.getById('art-1');
        expect(fetched1).not.toBeNull();
        expect(fetched1?.id).toBe('art-1');
        expect(fetched1?.relativePath).toBe('2026-09/art_1.json');
        expect(fetched1?.sizeBytes).toBe(250);
        expect(fetched1?.metadata).toEqual({ httpStatus: 500, retryCount: 2 });

        // List by runId
        const runArtifacts = await repo.listByRunId('run-1');
        expect(runArtifacts.length).toBe(2);

        // List by sourceRunId
        const srArtifacts = await repo.listBySourceRunId('sr-1');
        expect(srArtifacts.length).toBe(1);
        expect(srArtifacts[0]?.id).toBe('art-1');

        // Totals by runId
        const totalSize = await repo.getTotalSizeBytesByRunId('run-1');
        expect(totalSize).toBe(600);

        const count = await repo.getCountByRunId('run-1');
        expect(count).toBe(2);

        // List expired
        const expiredOnSept15 = await repo.listExpired(new Date('2026-09-15T00:00:00.000Z'));
        expect(expiredOnSept15.length).toBe(1);
        expect(expiredOnSept15[0]?.id).toBe('art-1');

        // Primary key collision throws RawArtifactIdentityCollisionError
        await expect(repo.save(art1)).rejects.toThrow(RawArtifactIdentityCollisionError);

        // Delete by ID
        const deleted = await repo.deleteById('art-1');
        expect(deleted).toBe(true);
        expect(await repo.getById('art-1')).toBeNull();

        // Second delete returns false
        const deletedAgain = await repo.deleteById('art-1');
        expect(deletedAgain).toBe(false);
      });
    });
  });
});
