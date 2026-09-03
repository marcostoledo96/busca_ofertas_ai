import { describe, it, expect } from 'vitest';
import {
  openSqliteDatabase,
  MigrationFailedError,
  MigrationManifestInvalidError,
  SchemaVersionUnsupportedError,
  SCHEMA_MIGRATIONS_TABLE_NAME,
  PRODUCTION_MIGRATIONS,
  type Migration,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SQLite Migrations Framework & Contracts (BOAI-010 & BOAI-011)', () => {
  it('migrates empty database to latest production version (v4) idempotently', () => {
    withTempDatabase((db) => {
      expect(db.getCurrentSchemaVersion()).toBe(0);
      expect(db.getAppliedMigrations()).toEqual([]);

      // First run: applies migration 1, 2, 3, and 4
      const result1 = db.migrate();
      expect(result1.previousVersion).toBe(0);
      expect(result1.currentVersion).toBe(4);
      expect(result1.newlyAppliedCount).toBe(4);
      expect(result1.appliedMigrations.length).toBe(4);
      expect(result1.appliedMigrations[0]!.version).toBe(1);
      expect(result1.appliedMigrations[0]!.name).toBe('001_create_schema_migrations');
      expect(result1.appliedMigrations[1]!.version).toBe(2);
      expect(result1.appliedMigrations[1]!.name).toBe('002_create_operational_persistence');
      expect(result1.appliedMigrations[2]!.version).toBe(3);
      expect(result1.appliedMigrations[2]!.name).toBe('003_create_observation_history');
      expect(result1.appliedMigrations[3]!.version).toBe(4);
      expect(result1.appliedMigrations[3]!.name).toBe('004_create_review_feedback_persistence');
      expect(Date.parse(result1.appliedMigrations[0]!.appliedAt)).toBeGreaterThan(0);
      expect(Date.parse(result1.appliedMigrations[1]!.appliedAt)).toBeGreaterThan(0);
      expect(Date.parse(result1.appliedMigrations[2]!.appliedAt)).toBeGreaterThan(0);
      expect(Date.parse(result1.appliedMigrations[3]!.appliedAt)).toBeGreaterThan(0);

      expect(db.getCurrentSchemaVersion()).toBe(4);

      // Second run: idempotent no-op
      const result2 = db.migrate();
      expect(result2.previousVersion).toBe(4);
      expect(result2.currentVersion).toBe(4);
      expect(result2.newlyAppliedCount).toBe(0);
      expect(result2.appliedMigrations.length).toBe(4);

      // Third run: still idempotent
      const result3 = db.migrate();
      expect(result3.currentVersion).toBe(4);
      expect(result3.newlyAppliedCount).toBe(0);
    });
  });

  it('migrates v1 database to latest v4 version seamlessly and retains schema_migrations history', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Step 1: Migrate only v1
      const v1OnlyMigrations: readonly Migration[] = [PRODUCTION_MIGRATIONS[0]!];
      const dbV1 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: v1OnlyMigrations,
      });
      const v1Result = dbV1.migrate();
      expect(v1Result.currentVersion).toBe(1);
      expect(v1Result.newlyAppliedCount).toBe(1);
      expect(dbV1.getCurrentSchemaVersion()).toBe(1);
      dbV1.close();

      // Step 2: Open with full production runner (v1, v2, v3, v4)
      const dbLatest = openSqliteDatabase({
        databasePath: ctx.databasePath,
      });
      expect(dbLatest.getCurrentSchemaVersion()).toBe(1);

      const v4Result = dbLatest.migrate();
      expect(v4Result.previousVersion).toBe(1);
      expect(v4Result.currentVersion).toBe(4);
      expect(v4Result.newlyAppliedCount).toBe(3);
      expect(v4Result.appliedMigrations.length).toBe(4);
      expect(v4Result.appliedMigrations[1]!.version).toBe(2);
      expect(v4Result.appliedMigrations[1]!.name).toBe('002_create_operational_persistence');
      expect(v4Result.appliedMigrations[2]!.version).toBe(3);
      expect(v4Result.appliedMigrations[2]!.name).toBe('003_create_observation_history');
      expect(v4Result.appliedMigrations[3]!.version).toBe(4);
      expect(v4Result.appliedMigrations[3]!.name).toBe('004_create_review_feedback_persistence');

      expect(dbLatest.getCurrentSchemaVersion()).toBe(4);

      // Verify all operational tables exist
      const tables = dbLatest
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
        )
        .all();

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('saved_searches');
      expect(tableNames).toContain('saved_search_revisions');
      expect(tableNames).toContain('runs');
      expect(tableNames).toContain('source_runs');
      expect(tableNames).toContain('listings');
      expect(tableNames).toContain('observations');
      expect(tableNames).toContain('evaluations');
      expect(tableNames).toContain('opportunities');
      expect(tableNames).toContain('feedback');
      expect(tableNames).toContain('execution_lock');

      dbLatest.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('migrates v2 database to latest v4 version seamlessly (incremental migrations 003 and 004)', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Step 1: Migrate v1 and v2
      const v2Migrations: readonly Migration[] = [
        PRODUCTION_MIGRATIONS[0]!,
        PRODUCTION_MIGRATIONS[1]!,
      ];
      const dbV2 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: v2Migrations,
      });
      const v2Result = dbV2.migrate();
      expect(v2Result.currentVersion).toBe(2);
      expect(v2Result.newlyAppliedCount).toBe(2);
      expect(dbV2.getCurrentSchemaVersion()).toBe(2);
      dbV2.close();

      // Step 2: Open with full production runner (applies v3 and v4)
      const dbLatest = openSqliteDatabase({
        databasePath: ctx.databasePath,
      });
      expect(dbLatest.getCurrentSchemaVersion()).toBe(2);

      const v4Result = dbLatest.migrate();
      expect(v4Result.previousVersion).toBe(2);
      expect(v4Result.currentVersion).toBe(4);
      expect(v4Result.newlyAppliedCount).toBe(2);
      expect(v4Result.appliedMigrations.length).toBe(4);
      expect(v4Result.appliedMigrations[2]!.version).toBe(3);
      expect(v4Result.appliedMigrations[2]!.name).toBe('003_create_observation_history');
      expect(v4Result.appliedMigrations[3]!.version).toBe(4);
      expect(v4Result.appliedMigrations[3]!.name).toBe('004_create_review_feedback_persistence');

      expect(dbLatest.getCurrentSchemaVersion()).toBe(4);

      dbLatest.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects unsupported future schema version (>4) with fail-closed error', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Create DB with future schema version 5
      const customFutureMigrations: readonly Migration[] = [
        ...PRODUCTION_MIGRATIONS,
        {
          version: 5,
          name: '005_future_feature_table',
          up: (tx) => {
            tx.exec('CREATE TABLE future_table (id INT PRIMARY KEY);');
          },
        },
      ];

      const dbWithFuture = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: customFutureMigrations,
      });
      dbWithFuture.migrate();
      expect(dbWithFuture.getCurrentSchemaVersion()).toBe(5);
      dbWithFuture.close();

      // Now open with standard production runner (which only knows up to version 4)
      const standardDb = openSqliteDatabase({
        databasePath: ctx.databasePath,
      });

      expect(() => standardDb.migrate()).toThrow(SchemaVersionUnsupportedError);
      try {
        standardDb.migrate();
      } catch (err) {
        expect(err).toBeInstanceOf(SchemaVersionUnsupportedError);
        if (err instanceof SchemaVersionUnsupportedError) {
          expect(err.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
          expect(err.foundVersion).toBe(5);
          expect(err.maxSupportedVersion).toBe(4);
          expect(err.message).toContain('exceeds maximum version 4');
          expect(err.message).toContain('Please upgrade');
        }
      }

      standardDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rolls back completely when a migration fails halfway and leaves schema version at previous level', () => {
    const ctx = createTempDatabaseContext();
    try {
      const failingMigrations: readonly Migration[] = [
        PRODUCTION_MIGRATIONS[0]!,
        {
          version: 2,
          name: '002_failing_migration',
          up: (tx) => {
            tx.exec('CREATE TABLE partial_table_uncommitted (id INT PRIMARY KEY);');
            tx.exec('INVALID SQL SYNTAX THAT THROWS');
          },
        },
      ];

      const db = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: failingMigrations,
      });

      expect(() => db.migrate()).toThrow(MigrationFailedError);
      expect(db.getCurrentSchemaVersion()).toBe(1);

      const tableCheck = db
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('partial_table_uncommitted');
      expect(tableCheck).toBeUndefined();

      db.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects async migration up callbacks and does not record them in schema_migrations', () => {
    const ctx = createTempDatabaseContext();
    try {
      const asyncMigrations: readonly Migration[] = [
        PRODUCTION_MIGRATIONS[0]!,
        {
          version: 2,
          name: '002_async_invalid_migration',
          up: (tx) => {
            tx.exec('CREATE TABLE async_table_uncommitted (id INT PRIMARY KEY);');
            return Promise.resolve() as unknown as void;
          },
        },
      ];

      const db = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: asyncMigrations,
      });

      expect(() => db.migrate()).toThrow(MigrationFailedError);
      try {
        db.migrate();
      } catch (err) {
        expect(err).toBeInstanceOf(MigrationFailedError);
        if (err instanceof MigrationFailedError) {
          expect(err.version).toBe(2);
          expect(err.migrationName).toBe('002_async_invalid_migration');
        }
      }

      // Assert DB state: version remains 1, schema_migrations has only 1 row, async_table not created
      expect(db.getCurrentSchemaVersion()).toBe(1);
      const applied = db.getAppliedMigrations();
      expect(applied.map((a) => a.version)).toEqual([1]);

      const tableCheck = db
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('async_table_uncommitted');
      expect(tableCheck).toBeUndefined();

      db.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects invalid migration manifests before modifying database', () => {
    withTempDatabase((db) => {
      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [{ version: 0, name: 'invalid_zero', up: () => {} }],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [{ version: -1, name: 'invalid_negative', up: () => {} }],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [
            { version: 1, name: 'first', up: () => {} },
            { version: 1, name: 'duplicate_first', up: () => {} },
          ],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [
            { version: 1, name: 'same_name', up: () => {} },
            { version: 2, name: 'same_name', up: () => {} },
          ],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [{ version: 1, name: '   ', up: () => {} }],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);
    });
  });

  it('sorts and applies pending migrations deterministically in ascending order', () => {
    const ctx = createTempDatabaseContext();
    try {
      const appliedOrder: number[] = [];

      const unorderedMigrations: readonly Migration[] = [
        {
          version: 3,
          name: '003_third',
          up: (tx) => {
            appliedOrder.push(3);
            tx.exec('CREATE TABLE test_three (id INT PRIMARY KEY);');
          },
        },
        {
          version: 1,
          name: '001_create_schema_migrations',
          up: (tx) => {
            appliedOrder.push(1);
            tx.exec(`
              CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE_NAME} (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
              );
            `);
          },
        },
        {
          version: 2,
          name: '002_second',
          up: (tx) => {
            appliedOrder.push(2);
            tx.exec('CREATE TABLE test_two (id INT PRIMARY KEY);');
          },
        },
      ];

      const db = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: unorderedMigrations,
      });

      const res = db.migrate();
      expect(res.currentVersion).toBe(3);
      expect(res.newlyAppliedCount).toBe(3);
      expect(appliedOrder).toEqual([1, 2, 3]);

      db.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('detects and rejects altered migration history (manifest divergence)', () => {
    const ctx = createTempDatabaseContext();
    try {
      const db1 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: [PRODUCTION_MIGRATIONS[0]!],
      });
      db1.migrate();
      db1.close();

      const dbAltered = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: [
          {
            version: 1,
            name: '001_ALTERED_NAME_MUTATED',
            up: () => {},
          },
        ],
      });

      expect(() => dbAltered.migrate()).toThrow(MigrationManifestInvalidError);
      dbAltered.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('creates operational tables and confirms out-of-scope tables are strictly absent (BOAI-012)', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Introspect all tables in the database
      const tables = db
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
        )
        .all();

      const tableNames = tables.map((t) => t.name).sort();
      expect(tableNames).toEqual([
        'evaluations',
        'execution_lock',
        'feedback',
        'listings',
        'observations',
        'opportunities',
        'runs',
        'saved_search_revisions',
        'saved_searches',
        'schema_migrations',
        'source_runs',
      ]);

      // Introspect table columns on observations
      const obsCols = db
        .prepare<{ name: string; notnull: number; pk: number }, []>(
          "PRAGMA table_info('observations');",
        )
        .all();
      const obsColNames = obsCols.map((c) => c.name);
      expect(obsColNames).toEqual([
        'id',
        'listing_id',
        'source_run_id',
        'observed_at',
        'title',
        'description',
        'price',
        'location',
        'condition',
        'availability',
        'image_urls',
        'published_at',
        'raw_fingerprint',
      ]);

      // Verify primary key on id
      const idCol = obsCols.find((c) => c.name === 'id');
      expect(idCol?.pk).toBe(1);

      // Verify notnull constraints on observations
      const mandatoryCols = [
        'listing_id',
        'source_run_id',
        'observed_at',
        'title',
        'availability',
        'image_urls',
        'raw_fingerprint',
      ];
      for (const col of mandatoryCols) {
        const found = obsCols.find((c) => c.name === col);
        expect(found?.notnull).toBe(1);
      }

      // Introspect table columns on execution_lock
      const lockCols = db
        .prepare<{ name: string; notnull: number }, []>("PRAGMA table_info('execution_lock');")
        .all();
      const lockColNames = lockCols.map((c) => c.name);
      expect(lockColNames).toContain('lock_key');
      expect(lockColNames).toContain('holder_id');
      expect(lockColNames).toContain('lock_token');
      expect(lockColNames).toContain('acquired_at');
      expect(lockColNames).toContain('metadata');

      // Verify lock_token is NOT NULL
      const tokenCol = lockCols.find((c) => c.name === 'lock_token');
      expect(tokenCol?.notnull).toBe(1);

      // Verify adapter_version in source_runs is NOT NULL
      const srCols = db
        .prepare<{ name: string; notnull: number }, []>("PRAGMA table_info('source_runs');")
        .all();
      const adapterVerCol = srCols.find((c) => c.name === 'adapter_version');
      expect(adapterVerCol?.notnull).toBe(1);

      // Explicit assertions that out-of-scope tables do NOT exist
      const outOfScopeTables = ['raw_artifacts', 'reports', 'raw_payloads'];

      for (const table of outOfScopeTables) {
        const check = db
          .prepare<{ name: string }, [string]>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
          )
          .get(table);
        expect(check).toBeUndefined();
      }
    });
  });
});
