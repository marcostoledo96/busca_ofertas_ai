import { describe, it, expect } from 'vitest';
import {
  createRun,
  createSourceRun,
  createSavedSearch,
  type Run,
  type SourceRun,
} from '@busca-ofertas-ai/core';
import {
  SqliteRunRepository,
  SqliteSavedSearchRepository,
  StorageCorruptionError,
  REDACTED_PLACEHOLDER,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteRunRepository (BOAI-011)', () => {
  const testSavedSearch = createSavedSearch({
    id: 'search-for-runs',
    schemaVersion: 1,
    name: 'Search for runs',
    enabled: true,
    category: 'PRODUCT',
    sourceConfigs: [{ id: 'fb-marketplace', enabled: true, queries: ['switch'] }],
    query: { terms: ['switch'] },
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

  const setupBaseSearch = async (db: Parameters<Parameters<typeof withTempDatabase>[0]>[0]) => {
    db.migrate();
    const searchRepo = new SqliteSavedSearchRepository(db);
    await searchRepo.save(testSavedSearch);
  };

  it('persists and retrieves all 6 Run statuses with exact semantic fidelity', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const runCreated = createRun({
        id: 'run-created',
        savedSearchId: testSavedSearch.id,
        status: 'CREATED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });

      const runRunning = createRun({
        id: 'run-running',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });

      const runSuccess = createRun({
        id: 'run-success',
        savedSearchId: testSavedSearch.id,
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:02:00.000Z'),
      });

      const runPartial = createRun({
        id: 'run-partial',
        savedSearchId: testSavedSearch.id,
        status: 'PARTIAL_SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:03:00.000Z'),
      });

      const runFailed = createRun({
        id: 'run-failed',
        savedSearchId: testSavedSearch.id,
        status: 'FAILED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        error: 'Network timeout connecting to adapter',
      });

      const runCancelled = createRun({
        id: 'run-cancelled',
        savedSearchId: testSavedSearch.id,
        status: 'CANCELLED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:30.000Z'),
        error: 'User pressed Ctrl+C',
      });

      const runs: Run[] = [runCreated, runRunning, runSuccess, runPartial, runFailed, runCancelled];

      for (const r of runs) {
        await repo.save(r);
        const retrieved = await repo.getById(r.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved).toEqual(r);
      }
    });
  });

  it('persists and retrieves all 14 SourceRun statuses and verifies SUCCESS != ZERO_RESULTS != ERROR', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const parentRun = createRun({
        id: 'parent-run-1',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(parentRun);

      const sourceRuns: SourceRun[] = [
        createSourceRun({
          id: 'sr-pending',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          collectorId: 'graphql',
          status: 'PENDING',
          startedAt: new Date('2026-08-30T12:00:00.000Z'),
        }),
        createSourceRun({
          id: 'sr-running',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          collectorId: 'graphql',
          status: 'RUNNING',
          startedAt: new Date('2026-08-30T12:00:05.000Z'),
        }),
        createSourceRun({
          id: 'sr-success',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          collectorId: 'graphql',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:00:10.000Z'),
          finishedAt: new Date('2026-08-30T12:00:20.000Z'),
          itemsCount: 42,
        }),
        createSourceRun({
          id: 'sr-zero-results',
          runId: parentRun.id,
          sourceId: 'mercadolibre',
          collectorId: 'search-api',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: new Date('2026-08-30T12:00:25.000Z'),
          finishedAt: new Date('2026-08-30T12:00:30.000Z'),
          itemsCount: 0,
        }),
        createSourceRun({
          id: 'sr-auth-req',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'AUTHENTICATION_REQUIRED',
          startedAt: new Date('2026-08-30T12:00:35.000Z'),
          finishedAt: new Date('2026-08-30T12:00:40.000Z'),
          error: 'Session cookie expired',
        }),
        createSourceRun({
          id: 'sr-manual-int',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'MANUAL_INTERVENTION_REQUIRED',
          startedAt: new Date('2026-08-30T12:00:45.000Z'),
          finishedAt: new Date('2026-08-30T12:00:50.000Z'),
          error: 'CAPTCHA detected',
        }),
        createSourceRun({
          id: 'sr-rate-limit',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'RATE_LIMITED',
          startedAt: new Date('2026-08-30T12:00:55.000Z'),
          finishedAt: new Date('2026-08-30T12:01:00.000Z'),
          error: 'HTTP 429 Too Many Requests',
        }),
        createSourceRun({
          id: 'sr-net-err',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-30T12:01:05.000Z'),
          finishedAt: new Date('2026-08-30T12:01:10.000Z'),
          error: 'ECONNRESET',
        }),
        createSourceRun({
          id: 'sr-src-unavail',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'SOURCE_UNAVAILABLE',
          startedAt: new Date('2026-08-30T12:01:15.000Z'),
          finishedAt: new Date('2026-08-30T12:01:20.000Z'),
          error: 'HTTP 503 Service Unavailable',
        }),
        createSourceRun({
          id: 'sr-contract-chg',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'CONTRACT_CHANGED',
          startedAt: new Date('2026-08-30T12:01:25.000Z'),
          finishedAt: new Date('2026-08-30T12:01:30.000Z'),
          error: 'GraphQL response structure altered',
        }),
        createSourceRun({
          id: 'sr-parser-fail',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'PARSER_FAILED',
          startedAt: new Date('2026-08-30T12:01:35.000Z'),
          finishedAt: new Date('2026-08-30T12:01:40.000Z'),
          error: 'Failed to extract price field',
        }),
        createSourceRun({
          id: 'sr-timeout',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'TIMEOUT',
          startedAt: new Date('2026-08-30T12:01:45.000Z'),
          finishedAt: new Date('2026-08-30T12:01:50.000Z'),
          error: 'Request deadline exceeded (30000ms)',
        }),
        createSourceRun({
          id: 'sr-cfg-unsupp',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'CONFIGURATION_UNSUPPORTED',
          startedAt: new Date('2026-08-30T12:01:55.000Z'),
          finishedAt: new Date('2026-08-30T12:02:00.000Z'),
          error: 'Negative radius is not supported by source',
        }),
        createSourceRun({
          id: 'sr-cancelled',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'CANCELLED',
          startedAt: new Date('2026-08-30T12:02:05.000Z'),
          finishedAt: new Date('2026-08-30T12:02:10.000Z'),
          error: 'Source run cancelled',
        }),
      ];

      for (const sr of sourceRuns) {
        await repo.saveSourceRun(sr);
      }

      const list = await repo.listSourceRunsByRunId(parentRun.id);
      expect(list.length).toBe(14);

      // Verify strict distinctions
      const successSr = list.find((s) => s.status === 'SUCCESS');
      expect(successSr).toBeDefined();
      expect('itemsCount' in successSr! && successSr.itemsCount).toBe(42);

      const zeroResultsSr = list.find((s) => s.status === 'ZERO_RESULTS_CONFIRMED');
      expect(zeroResultsSr).toBeDefined();
      expect('itemsCount' in zeroResultsSr! && zeroResultsSr.itemsCount).toBe(0);

      const rateLimitedSr = list.find((s) => s.status === 'RATE_LIMITED');
      expect(rateLimitedSr).toBeDefined();
      expect('error' in rateLimitedSr! && rateLimitedSr.error).toBe('HTTP 429 Too Many Requests');
      expect('itemsCount' in rateLimitedSr!).toBe(false);
    });
  });

  it('persists and retrieves SourceRun execution metadata and metrics', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const parentRun = createRun({
        id: 'parent-run-meta',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(parentRun);

      const sourceRun = createSourceRun({
        id: 'sr-with-meta',
        runId: parentRun.id,
        sourceId: 'fb-marketplace',
        collectorId: 'graphql',
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:00:15.000Z'),
        itemsCount: 15,
      });

      await repo.saveSourceRun(sourceRun, {
        adapterVersion: '1.2.0',
        metrics: {
          pagesRequested: 3,
          pagesCompleted: 3,
          rawItemsCount: 30,
          parsedItemsCount: 15,
          rejectedItemsCount: 15,
          stopReason: 'NO_MORE_RESULTS',
        },
      });

      const metadata = await repo.getSourceRunMetadata('sr-with-meta');
      expect(metadata).not.toBeNull();
      expect(metadata!.adapterVersion).toBe('1.2.0');
      expect(metadata!.metrics).toEqual({
        pagesRequested: 3,
        pagesCompleted: 3,
        rawItemsCount: 30,
        parsedItemsCount: 15,
        rejectedItemsCount: 15,
        stopReason: 'NO_MORE_RESULTS',
      });
    });
  });

  it('sanitizes secrets in error messages before persisting Run and SourceRun errors', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const runWithSecretError = createRun({
        id: 'run-secret-err',
        savedSearchId: testSavedSearch.id,
        status: 'FAILED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        error:
          'Failed request with Authorization: Bearer secret-auth-token-12345 and Cookie: session_id=abcdef',
      });
      await repo.save(runWithSecretError);

      const sourceRunWithSecretError = createSourceRun({
        id: 'sr-secret-err',
        runId: runWithSecretError.id,
        sourceId: 'fb-marketplace',
        status: 'AUTHENTICATION_REQUIRED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:00:10.000Z'),
        error: 'Login failed with password="mySuperPassword123" and api_key=topsecret999',
      });
      await repo.saveSourceRun(sourceRunWithSecretError);

      // Verify Run error was sanitized
      const retrievedRun = await repo.getById('run-secret-err');
      expect(retrievedRun).not.toBeNull();
      expect(retrievedRun!.status).toBe('FAILED');
      if (retrievedRun!.status === 'FAILED') {
        expect(retrievedRun!.error).not.toContain('secret-auth-token-12345');
        expect(retrievedRun!.error).not.toContain('session_id=abcdef');
        expect(retrievedRun!.error).toContain(REDACTED_PLACEHOLDER);
      }

      // Verify SourceRun error was sanitized
      const retrievedSourceRuns = await repo.listSourceRunsByRunId('run-secret-err');
      expect(retrievedSourceRuns.length).toBe(1);
      const retrievedSr = retrievedSourceRuns[0]!;
      if ('error' in retrievedSr) {
        expect(retrievedSr.error).not.toContain('mySuperPassword123');
        expect(retrievedSr.error).not.toContain('topsecret999');
        expect(retrievedSr.error).toContain(REDACTED_PLACEHOLDER);
      }
    });
  });

  it('calculates deterministic RunSummary via SQL aggregation', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const run = createRun({
        id: 'run-for-summary',
        savedSearchId: testSavedSearch.id,
        status: 'PARTIAL_SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:05:00.000Z'),
      });
      await repo.save(run);

      // Add 2 SUCCESS, 1 ZERO_RESULTS_CONFIRMED, 2 FAILED source runs
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-sum-1',
          runId: run.id,
          sourceId: 'fb-marketplace',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:00:00.000Z'),
          finishedAt: new Date('2026-08-30T12:01:00.000Z'),
          itemsCount: 20,
        }),
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-sum-2',
          runId: run.id,
          sourceId: 'mercadolibre',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:01:00.000Z'),
          finishedAt: new Date('2026-08-30T12:02:00.000Z'),
          itemsCount: 15,
        }),
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-sum-3',
          runId: run.id,
          sourceId: 'olx',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: new Date('2026-08-30T12:02:00.000Z'),
          finishedAt: new Date('2026-08-30T12:03:00.000Z'),
          itemsCount: 0,
        }),
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-sum-4',
          runId: run.id,
          sourceId: 'custom-store',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-30T12:03:00.000Z'),
          finishedAt: new Date('2026-08-30T12:04:00.000Z'),
          error: 'Connection timeout',
        }),
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-sum-5',
          runId: run.id,
          sourceId: 'another-store',
          status: 'RATE_LIMITED',
          startedAt: new Date('2026-08-30T12:04:00.000Z'),
          finishedAt: new Date('2026-08-30T12:05:00.000Z'),
          error: '429 Rate limit',
        }),
      );

      const summary = await repo.getSummaryByRunId(run.id);
      expect(summary).not.toBeNull();
      expect(summary!).toEqual({
        runId: run.id,
        totalSourceRuns: 5,
        successCount: 2,
        zeroResultsCount: 1,
        failedCount: 2,
        totalItemsCount: 35,
      });

      // Querying nonexistent run returns null
      const nonexistentSummary = await repo.getSummaryByRunId('nonexistent-run');
      expect(nonexistentSummary).toBeNull();
    });
  });

  it('enforces SQL CHECK constraints on Run table status and consistency', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);

      // Attempt to insert invalid status into SQLite directly
      expect(() => {
        db.exec(`
          INSERT INTO runs (id, saved_search_id, status, started_at, finished_at, error)
          VALUES ('invalid-status-run', 'search-for-runs', 'INVALID_STATUS', '2026-08-30T12:00:00.000Z', NULL, NULL);
        `);
      }).toThrow();

      // Attempt to insert CREATED status with non-null finished_at
      expect(() => {
        db.exec(`
          INSERT INTO runs (id, saved_search_id, status, started_at, finished_at, error)
          VALUES ('inconsistent-run', 'search-for-runs', 'CREATED', '2026-08-30T12:00:00.000Z', '2026-08-30T12:05:00.000Z', NULL);
        `);
      }).toThrow();
    });
  });

  it('fails closed when persisted Run row contains corrupted date', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);

      // Insert Run with invalid date format
      db.exec(`
        INSERT INTO runs (id, saved_search_id, status, started_at, finished_at, error)
        VALUES ('corrupt-run', 'search-for-runs', 'CREATED', 'NOT_AN_ISO_DATE', NULL, NULL);
      `);

      const repo = new SqliteRunRepository(db);
      await expect(repo.getById('corrupt-run')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
