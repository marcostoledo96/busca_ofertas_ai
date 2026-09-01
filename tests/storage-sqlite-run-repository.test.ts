import { describe, it, expect } from 'vitest';
import {
  createRun,
  createSourceRun,
  createSavedSearch,
  type Run,
  type SourceRun,
  type SourceRunStopReason,
} from '@busca-ofertas-ai/core';
import {
  SqliteRunRepository,
  SqliteSavedSearchRepository,
  StorageCorruptionError,
  RunIdentityCollisionError,
  SourceRunIdentityCollisionError,
  REDACTED_PLACEHOLDER,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteRunRepository (BOAI-011 / Findings A & C)', () => {
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
      }

      for (const expected of runs) {
        const actual = await repo.getById(expected.id);
        expect(actual).not.toBeNull();
        expect(actual!.id).toBe(expected.id);
        expect(actual!.status).toBe(expected.status);
        if ('finishedAt' in expected && expected.finishedAt && actual && 'finishedAt' in actual) {
          expect(actual.finishedAt).toEqual(expected.finishedAt);
        }
        if ('error' in expected && expected.error && actual && 'error' in actual) {
          expect(actual.error).toBe(expected.error);
        }
      }
    });
  });

  it('persists and retrieves all 14 SourceRun statuses respecting SUCCESS != ZERO_RESULTS != failures', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const parentRun = createRun({
        id: 'parent-run-for-sources',
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
          status: 'PENDING',
          startedAt: new Date('2026-08-30T12:00:00.000Z'),
        }),
        createSourceRun({
          id: 'sr-running',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'RUNNING',
          startedAt: new Date('2026-08-30T12:00:05.000Z'),
        }),
        createSourceRun({
          id: 'sr-success',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:00:10.000Z'),
          finishedAt: new Date('2026-08-30T12:00:30.000Z'),
          itemsCount: 42,
        }),
        createSourceRun({
          id: 'sr-zero-results',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: new Date('2026-08-30T12:00:15.000Z'),
          finishedAt: new Date('2026-08-30T12:00:35.000Z'),
          itemsCount: 0,
        }),
        createSourceRun({
          id: 'sr-auth-req',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'AUTHENTICATION_REQUIRED',
          startedAt: new Date('2026-08-30T12:00:40.000Z'),
          finishedAt: new Date('2026-08-30T12:00:45.000Z'),
          error: 'Session expired, login required',
        }),
        createSourceRun({
          id: 'sr-manual-int',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'MANUAL_INTERVENTION_REQUIRED',
          startedAt: new Date('2026-08-30T12:00:50.000Z'),
          finishedAt: new Date('2026-08-30T12:00:55.000Z'),
          error: 'Checkpoint triggered',
        }),
        createSourceRun({
          id: 'sr-rate-limit',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'RATE_LIMITED',
          startedAt: new Date('2026-08-30T12:01:00.000Z'),
          finishedAt: new Date('2026-08-30T12:01:05.000Z'),
          error: 'HTTP 429 Too Many Requests',
        }),
        createSourceRun({
          id: 'sr-network-err',
          runId: parentRun.id,
          sourceId: 'fb-marketplace',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-30T12:01:10.000Z'),
          finishedAt: new Date('2026-08-30T12:01:15.000Z'),
          error: 'ECONNRESET connecting to Facebook',
        }),
        createSourceRun({
          id: 'sr-source-unavail',
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
        if (sr.status === 'SUCCESS') {
          await repo.saveSourceRun(sr, {
            adapterVersion: '1.0.0',
            metrics: {
              pagesRequested: 2,
              pagesCompleted: 2,
              rawItemsCount: 42,
              parsedItemsCount: 42,
              rejectedItemsCount: 0,
              stopReason: 'ALL_PAGES_FETCHED',
            },
          });
        } else if (sr.status === 'ZERO_RESULTS_CONFIRMED') {
          await repo.saveSourceRun(sr, {
            adapterVersion: '1.0.0',
            metrics: {
              pagesRequested: 1,
              pagesCompleted: 1,
              rawItemsCount: 0,
              parsedItemsCount: 0,
              rejectedItemsCount: 0,
              stopReason: 'NO_MORE_RESULTS',
            },
          });
        } else {
          await repo.saveSourceRun(sr, { adapterVersion: '1.0.0' });
        }
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

  it('rejects Run identity collisions when savedSearchId or startedAt differs', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const searchB = createSavedSearch({
        ...testSavedSearch,
        id: 'search-b',
        name: 'Search B',
      });
      const searchRepo = new SqliteSavedSearchRepository(db);
      await searchRepo.save(searchB);

      const originalStartedAt = new Date('2026-08-30T12:00:00.000Z');
      const initialRun = createRun({
        id: 'run-collision-test',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: originalStartedAt,
      });
      await repo.save(initialRun);

      // 1. Same run id + different savedSearchId -> reject
      const conflictingSearchRun = createRun({
        id: 'run-collision-test',
        savedSearchId: 'search-b',
        status: 'SUCCESS',
        startedAt: originalStartedAt,
        finishedAt: new Date('2026-08-30T12:05:00.000Z'),
      });
      await expect(repo.save(conflictingSearchRun)).rejects.toThrow(RunIdentityCollisionError);

      // Verify row unchanged after rejection
      const afterConflict1 = await repo.getById('run-collision-test');
      expect(afterConflict1!.savedSearchId).toBe(testSavedSearch.id);
      expect(afterConflict1!.status).toBe('RUNNING');

      // 2. Same run id + different startedAt -> reject
      const conflictingDateRun = createRun({
        id: 'run-collision-test',
        savedSearchId: testSavedSearch.id,
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T13:00:00.000Z'),
        finishedAt: new Date('2026-08-30T13:05:00.000Z'),
      });
      await expect(repo.save(conflictingDateRun)).rejects.toThrow(RunIdentityCollisionError);

      // Verify row unchanged after rejection
      const afterConflict2 = await repo.getById('run-collision-test');
      expect(afterConflict2!.startedAt).toEqual(originalStartedAt);
      expect(afterConflict2!.status).toBe('RUNNING');

      // 3. Valid lifecycle update with same identity succeeds
      const updatedRun = createRun({
        id: 'run-collision-test',
        savedSearchId: testSavedSearch.id,
        status: 'SUCCESS',
        startedAt: originalStartedAt,
        finishedAt: new Date('2026-08-30T12:10:00.000Z'),
      });
      await expect(repo.save(updatedRun)).resolves.toBeUndefined();

      const finalRun = await repo.getById('run-collision-test');
      expect(finalRun!.status).toBe('SUCCESS');
    });
  });

  it('rejects SourceRun identity and provenance collisions (runId, sourceId, startedAt, adapterVersion, collectorId) (Findings A & C)', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const runA = createRun({
        id: 'run-a',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      const runB = createRun({
        id: 'run-b',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(runA);
      await repo.save(runB);

      const originalStartedAt = new Date('2026-08-30T12:00:05.000Z');
      const initialSr = createSourceRun({
        id: 'sr-collision-test',
        runId: runA.id,
        sourceId: 'fb-marketplace',
        status: 'RUNNING',
        startedAt: originalStartedAt,
      });
      await repo.saveSourceRun(initialSr, { adapterVersion: '1.0.0' });

      // 1. Same source run id + different runId -> reject
      const conflictRunId = createSourceRun({
        id: 'sr-collision-test',
        runId: runB.id,
        sourceId: 'fb-marketplace',
        status: 'SUCCESS',
        startedAt: originalStartedAt,
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        itemsCount: 5,
      });
      await expect(
        repo.saveSourceRun(conflictRunId, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 5,
            parsedItemsCount: 5,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        }),
      ).rejects.toThrow(SourceRunIdentityCollisionError);

      // 2. Same source run id + different sourceId -> reject
      const conflictSourceId = createSourceRun({
        id: 'sr-collision-test',
        runId: runA.id,
        sourceId: 'mercadolibre',
        status: 'SUCCESS',
        startedAt: originalStartedAt,
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        itemsCount: 5,
      });
      await expect(
        repo.saveSourceRun(conflictSourceId, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 5,
            parsedItemsCount: 5,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        }),
      ).rejects.toThrow(SourceRunIdentityCollisionError);

      // 3. Same source run id + different startedAt -> reject
      const conflictStartedAt = createSourceRun({
        id: 'sr-collision-test',
        runId: runA.id,
        sourceId: 'fb-marketplace',
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T12:15:00.000Z'),
        finishedAt: new Date('2026-08-30T12:16:00.000Z'),
        itemsCount: 5,
      });
      await expect(
        repo.saveSourceRun(conflictStartedAt, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 5,
            parsedItemsCount: 5,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        }),
      ).rejects.toThrow(SourceRunIdentityCollisionError);

      // 4. Immutable adapterVersion (Finding C1): attempt to change 1.0.0 -> 1.1.0 -> REJECT
      const validUpdate = createSourceRun({
        id: 'sr-collision-test',
        runId: runA.id,
        sourceId: 'fb-marketplace',
        status: 'SUCCESS',
        startedAt: originalStartedAt,
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        itemsCount: 10,
      });
      await expect(
        repo.saveSourceRun(validUpdate, {
          adapterVersion: '1.1.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 10,
            parsedItemsCount: 10,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        }),
      ).rejects.toThrow(SourceRunIdentityCollisionError);

      // Verify row and metadata unchanged after rejections
      const listA = await repo.listSourceRunsByRunId(runA.id);
      expect(listA.length).toBe(1);
      expect(listA[0]!.status).toBe('RUNNING');
      expect(listA[0]!.startedAt).toEqual(originalStartedAt);
      const meta = await repo.getSourceRunMetadata('sr-collision-test');
      expect(meta!.adapterVersion).toBe('1.0.0');

      // 5. Valid lifecycle update with same adapterVersion (1.0.0) succeeds
      await expect(
        repo.saveSourceRun(validUpdate, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 10,
            parsedItemsCount: 10,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        }),
      ).resolves.toBeUndefined();

      const finalList = await repo.listSourceRunsByRunId(runA.id);
      expect(finalList[0]!.status).toBe('SUCCESS');
    });
  });

  it('enforces collectorId provenance transitions: NULL->A allowed, A->A allowed, A->B rejected, A->NULL preserves A (Finding C2)', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const run = createRun({
        id: 'run-collector-test',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(run);

      const sr = createSourceRun({
        id: 'sr-collector-1',
        runId: run.id,
        sourceId: 'fb-marketplace',
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });

      // 1. Initial insert with no collectorId -> stored as NULL
      await repo.saveSourceRun(sr, { adapterVersion: '1.0.0' });
      let meta = await repo.getSourceRunMetadata('sr-collector-1');
      expect(meta!.collectorId).toBeUndefined();

      // 2. NULL -> concrete collector 'collector-A': allowed
      await repo.saveSourceRun(sr, {
        adapterVersion: '1.0.0',
        collectorId: 'collector-A',
      });
      meta = await repo.getSourceRunMetadata('sr-collector-1');
      expect(meta!.collectorId).toBe('collector-A');

      // 3. concrete A -> same A: allowed
      await repo.saveSourceRun(sr, {
        adapterVersion: '1.0.0',
        collectorId: 'collector-A',
      });
      meta = await repo.getSourceRunMetadata('sr-collector-1');
      expect(meta!.collectorId).toBe('collector-A');

      // 4. concrete A -> different B: reject with SourceRunIdentityCollisionError, row unchanged
      await expect(
        repo.saveSourceRun(sr, {
          adapterVersion: '1.0.0',
          collectorId: 'collector-B',
        }),
      ).rejects.toThrow(SourceRunIdentityCollisionError);
      meta = await repo.getSourceRunMetadata('sr-collector-1');
      expect(meta!.collectorId).toBe('collector-A');

      // 5. concrete A -> NULL / undefined: does NOT erase provenance (keeps 'collector-A')
      await repo.saveSourceRun(sr, { adapterVersion: '1.0.0' });
      meta = await repo.getSourceRunMetadata('sr-collector-1');
      expect(meta!.collectorId).toBe('collector-A');
    });
  });

  it('enforces mandatory complete metrics for SUCCESS and ZERO_RESULTS_CONFIRMED (Finding A)', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const run = createRun({
        id: 'run-metrics-req',
        savedSearchId: testSavedSearch.id,
        status: 'RUNNING',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(run);

      const successSr = createSourceRun({
        id: 'sr-success-metrics',
        runId: run.id,
        sourceId: 'fb-marketplace',
        status: 'SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        itemsCount: 5,
      });

      const zeroResultsSr = createSourceRun({
        id: 'sr-zero-metrics',
        runId: run.id,
        sourceId: 'fb-marketplace',
        status: 'ZERO_RESULTS_CONFIRMED',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:01:00.000Z'),
        itemsCount: 0,
      });

      // 1. SUCCESS without metrics -> reject
      await expect(repo.saveSourceRun(successSr, { adapterVersion: '1.0.0' })).rejects.toThrow(
        /requires complete execution metrics/,
      );

      // 2. ZERO_RESULTS_CONFIRMED without metrics -> reject
      await expect(repo.saveSourceRun(zeroResultsSr, { adapterVersion: '1.0.0' })).rejects.toThrow(
        /requires complete execution metrics/,
      );

      // 3. SUCCESS with partial metrics -> reject
      await expect(
        repo.saveSourceRun(successSr, {
          adapterVersion: '1.0.0',
          metrics: { pagesRequested: 1 },
        }),
      ).rejects.toThrow(/requires complete execution metrics/);

      // 4. Old invented values PAGES_LIMIT_REACHED / COMPLETED / ERROR -> reject
      await expect(
        repo.saveSourceRun(successSr, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 5,
            parsedItemsCount: 5,
            rejectedItemsCount: 0,
            stopReason: 'COMPLETED' as unknown as SourceRunStopReason,
          },
        }),
      ).rejects.toThrow(/Invalid stopReason/);

      await expect(
        repo.saveSourceRun(successSr, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 5,
            parsedItemsCount: 5,
            rejectedItemsCount: 0,
            stopReason: 'PAGES_LIMIT_REACHED' as unknown as SourceRunStopReason,
          },
        }),
      ).rejects.toThrow(/Invalid stopReason/);

      // 5. SUCCESS with real Adapter SDK stop reasons -> accepted and exact round-trip
      const testCases: { stopReason: SourceRunStopReason; expected: SourceRunStopReason }[] = [
        { stopReason: 'ALL_PAGES_FETCHED', expected: 'ALL_PAGES_FETCHED' },
        { stopReason: 'MAX_PAGES_REACHED', expected: 'MAX_PAGES_REACHED' },
        { stopReason: 'MAX_ITEMS_REACHED', expected: 'MAX_ITEMS_REACHED' },
        { stopReason: 'NO_MORE_RESULTS', expected: 'NO_MORE_RESULTS' },
        { stopReason: 'RATE_LIMIT_STOP', expected: 'RATE_LIMIT_STOP' },
        { stopReason: 'USER_ABORTED', expected: 'USER_ABORTED' },
        { stopReason: 'DEADLINE_EXCEEDED', expected: 'DEADLINE_EXCEEDED' },
      ];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i]!;
        const srId = `sr-test-reason-${i}`;
        const itemSr = createSourceRun({
          id: srId,
          runId: run.id,
          sourceId: 'fb-marketplace',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:00:00.000Z'),
          finishedAt: new Date('2026-08-30T12:01:00.000Z'),
          itemsCount: 10,
        });

        await repo.saveSourceRun(itemSr, {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 3,
            pagesCompleted: 3,
            rawItemsCount: 20,
            parsedItemsCount: 10,
            rejectedItemsCount: 10,
            stopReason: tc.stopReason,
          },
        });

        const meta = await repo.getSourceRunMetadata(srId);
        expect(meta).not.toBeNull();
        expect(meta!.metrics?.stopReason).toBe(tc.expected);
      }
    });
  });

  it('calculates deterministic RunSummary without counting CANCELLED as failedCount', async () => {
    await withTempDatabase(async (db) => {
      await setupBaseSearch(db);
      const repo = new SqliteRunRepository(db);

      const run = createRun({
        id: 'run-summary-test',
        savedSearchId: testSavedSearch.id,
        status: 'PARTIAL_SUCCESS',
        startedAt: new Date('2026-08-30T12:00:00.000Z'),
        finishedAt: new Date('2026-08-30T12:05:00.000Z'),
      });
      await repo.save(run);

      // 1 SUCCESS, 1 ZERO_RESULTS_CONFIRMED, 1 FAILED-like, 1 CANCELLED
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-s1',
          runId: run.id,
          sourceId: 's1',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-30T12:00:00.000Z'),
          finishedAt: new Date('2026-08-30T12:01:00.000Z'),
          itemsCount: 10,
        }),
        {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 10,
            parsedItemsCount: 10,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        },
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-s2',
          runId: run.id,
          sourceId: 's2',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: new Date('2026-08-30T12:01:00.000Z'),
          finishedAt: new Date('2026-08-30T12:02:00.000Z'),
          itemsCount: 0,
        }),
        {
          adapterVersion: '1.0.0',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 0,
            parsedItemsCount: 0,
            rejectedItemsCount: 0,
            stopReason: 'NO_MORE_RESULTS',
          },
        },
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-s3',
          runId: run.id,
          sourceId: 's3',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-30T12:02:00.000Z'),
          finishedAt: new Date('2026-08-30T12:03:00.000Z'),
          error: 'Timeout error',
        }),
        { adapterVersion: '1.0.0' },
      );
      await repo.saveSourceRun(
        createSourceRun({
          id: 'sr-s4',
          runId: run.id,
          sourceId: 's4',
          status: 'CANCELLED',
          startedAt: new Date('2026-08-30T12:03:00.000Z'),
          finishedAt: new Date('2026-08-30T12:04:00.000Z'),
          error: 'User cancelled',
        }),
        { adapterVersion: '1.0.0' },
      );

      const summary = await repo.getSummaryByRunId(run.id);
      expect(summary).not.toBeNull();
      expect(summary!).toEqual({
        runId: run.id,
        totalSourceRuns: 4,
        successCount: 1,
        zeroResultsCount: 1,
        failedCount: 1, // NOT 2! CANCELLED is not counted in failedCount
        cancelledCount: 1,
        totalItemsCount: 10,
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
      await repo.saveSourceRun(sourceRunWithSecretError, { adapterVersion: '1.0.0' });

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
