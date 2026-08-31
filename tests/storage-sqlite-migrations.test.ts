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

describe('SQLite Migrations Framework & Contracts (BOAI-010)', () => {
  it('migrates empty database to latest production version idempotently', () => {
    withTempDatabase((db) => {
      expect(db.getCurrentSchemaVersion()).toBe(0);
      expect(db.getAppliedMigrations()).toEqual([]);

      // First run: applies migration 1
      const result1 = db.migrate();
      expect(result1.previousVersion).toBe(0);
      expect(result1.currentVersion).toBe(1);
      expect(result1.newlyAppliedCount).toBe(1);
      expect(result1.appliedMigrations.length).toBe(1);
      expect(result1.appliedMigrations[0]!.version).toBe(1);
      expect(result1.appliedMigrations[0]!.name).toBe('001_create_schema_migrations');
      expect(Date.parse(result1.appliedMigrations[0]!.appliedAt)).toBeGreaterThan(0);

      expect(db.getCurrentSchemaVersion()).toBe(1);

      // Second run: idempotent no-op
      const result2 = db.migrate();
      expect(result2.previousVersion).toBe(1);
      expect(result2.currentVersion).toBe(1);
      expect(result2.newlyAppliedCount).toBe(0);
      expect(result2.appliedMigrations.length).toBe(1);

      // Third run: still idempotent
      const result3 = db.migrate();
      expect(result3.currentVersion).toBe(1);
      expect(result3.newlyAppliedCount).toBe(0);
    });
  });

  it('rejects unsupported future schema version with fail-closed error', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Create DB with future schema version 2
      const customFutureMigrations: readonly Migration[] = [
        ...PRODUCTION_MIGRATIONS,
        {
          version: 2,
          name: '002_future_feature_table',
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
      expect(dbWithFuture.getCurrentSchemaVersion()).toBe(2);
      dbWithFuture.close();

      // Now open with standard production runner (which only knows up to version 1)
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
          expect(err.foundVersion).toBe(2);
          expect(err.maxSupportedVersion).toBe(1);
          expect(err.message).toContain('exceeds maximum version 1');
          expect(err.message).toContain('Please upgrade');
        }
      }

      standardDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects async migration up callbacks and does not record them in schema_migrations', () => {
    const ctx = createTempDatabaseContext();
    try {
      const asyncMigrations: readonly Migration[] = [
        ...PRODUCTION_MIGRATIONS,
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

      // DB remains open, usable and closable
      expect(db.isOpen).toBe(true);
      db.close();
      expect(db.isOpen).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects invalid migration manifests before modifying database', () => {
    withTempDatabase((db) => {
      // 1. Version 0
      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [{ version: 0, name: 'invalid_zero', up: () => {} }],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      // 2. Negative version
      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [{ version: -1, name: 'invalid_negative', up: () => {} }],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      // 3. Duplicate version
      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [
            { version: 1, name: 'first', up: () => {} },
            { version: 1, name: 'duplicate_first', up: () => {} },
          ],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      // 4. Duplicate name
      expect(() =>
        openSqliteDatabase({
          databasePath: db.databasePath,
          customMigrations: [
            { version: 1, name: 'same_name', up: () => {} },
            { version: 2, name: 'same_name', up: () => {} },
          ],
        }).migrate(),
      ).toThrow(MigrationManifestInvalidError);

      // 5. Empty name
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
      // First apply migration 1 as '001_create_schema_migrations'
      const db1 = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: [
          {
            version: 1,
            name: '001_create_schema_migrations',
            up: (tx) => {
              tx.exec(`
                CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE_NAME} (
                  version INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  applied_at TEXT NOT NULL
                );
              `);
            },
          },
        ],
      });
      db1.migrate();
      db1.close();

      // Now attempt to run with an altered manifest for version 1
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

  it('creates ONLY schema_migrations table in production schema (0 business tables)', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Introspect all tables in the database
      const tables = db
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
        )
        .all();

      expect(tables.map((t) => t.name)).toEqual([SCHEMA_MIGRATIONS_TABLE_NAME]);

      // Explicit assertions that NO business tables exist
      const forbiddenTables = [
        'saved_searches',
        'saved_search_revisions',
        'runs',
        'source_runs',
        'listings',
        'observations',
        'opportunities',
        'evaluations',
        'feedback',
        'raw_artifacts',
        'run_lock',
        'locks',
      ];

      for (const table of forbiddenTables) {
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
