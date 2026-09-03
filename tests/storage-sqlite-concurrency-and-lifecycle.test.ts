import { describe, it, expect } from 'vitest';
import { createSavedSearch, createRun } from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  createSqliteRepositories,
  DatabaseClosedError,
} from '@busca-ofertas-ai/storage-sqlite';
import { createTempDatabaseContext } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SQLite Concurrency, Lifecycle & Multi-Connection Behavior (BOAI-011)', () => {
  const search = createSavedSearch({
    id: 'search-lifecycle-1',
    schemaVersion: 1,
    name: 'Lifecycle Search',
    enabled: true,
    category: 'PRODUCT',
    sourceConfigs: [{ id: 'src-1', enabled: true, queries: ['test'] }],
    query: { terms: ['test'] },
    evaluation: { matchThreshold: 80, reviewThreshold: 40 },
    ai: {
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 10,
    },
    retention: { rawArtifacts: 'NONE', rawDataDays: 30 },
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
    updatedAt: new Date('2026-08-30T10:00:00.000Z'),
  });

  it('guarantees foreign_keys = ON across all independent connections to the same database', () => {
    const ctx = createTempDatabaseContext();
    try {
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();

      // Check pragma on connection 1
      const fk1 = db1.prepare<{ foreign_keys: number }, []>('PRAGMA foreign_keys;').get();
      expect(Number(fk1?.foreign_keys)).toBe(1);

      // Open connection 2
      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const fk2 = db2.prepare<{ foreign_keys: number }, []>('PRAGMA foreign_keys;').get();
      expect(Number(fk2?.foreign_keys)).toBe(1);

      // Attempting to insert a run with nonexistent saved_search_id must violate foreign key constraint
      expect(() => {
        db2.exec(`
          INSERT INTO runs (id, saved_search_id, status, started_at, finished_at, error)
          VALUES ('run-orphan', 'nonexistent-search-id', 'RUNNING', '2026-08-30T12:00:00.000Z', NULL, NULL);
        `);
      }).toThrow();

      db1.close();
      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('allows connection 2 to immediately read data committed by connection 1 without JS cache leakage', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const repos1 = createSqliteRepositories(db1);

      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const repos2 = createSqliteRepositories(db2);

      // Save via connection 1
      await repos1.savedSearches.save(search);

      // Read immediately via connection 2
      const fromConn2 = await repos2.savedSearches.getById(search.id);
      expect(fromConn2).not.toBeNull();
      expect(fromConn2).toEqual(search);

      // Save run via connection 1
      const run = createRun({
        id: 'run-cross-conn-1',
        savedSearchId: search.id,
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
      });
      await repos1.runs.save(run);

      // Read run via connection 2
      const runFromConn2 = await repos2.runs.getById(run.id);
      expect(runFromConn2).not.toBeNull();
      expect(runFromConn2).toEqual(run);

      db1.close();
      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('throws DatabaseClosedError when invoking repository operations on a closed database handle', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();
      const repos = createSqliteRepositories(db);

      db.close();

      await expect(repos.savedSearches.getById('any')).rejects.toThrow(DatabaseClosedError);
      await expect(repos.savedSearches.listEnabled()).rejects.toThrow(DatabaseClosedError);
      await expect(repos.savedSearches.save(search)).rejects.toThrow(DatabaseClosedError);

      await expect(repos.runs.getById('any')).rejects.toThrow(DatabaseClosedError);
      await expect(repos.runs.getSummaryByRunId('any')).rejects.toThrow(DatabaseClosedError);

      await expect(repos.listings.getById('any')).rejects.toThrow(DatabaseClosedError);
      await expect(repos.listings.getBySourceAndExternalId('fb', '1')).rejects.toThrow(
        DatabaseClosedError,
      );

      await expect(repos.executionLock.acquire('holder')).rejects.toThrow(DatabaseClosedError);
      await expect(repos.executionLock.isHeld()).rejects.toThrow(DatabaseClosedError);
    } finally {
      ctx.cleanup();
    }
  });
});
