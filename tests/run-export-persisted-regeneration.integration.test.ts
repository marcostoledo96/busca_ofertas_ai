import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  openSqliteDatabase,
  SqliteRunRepository,
  SqliteSavedSearchRepository,
  SqliteListingRepository,
  SqliteObservationRepository,
} from '@busca-ofertas-ai/storage-sqlite';
import { createTempDatabaseContext } from '@busca-ofertas-ai/storage-sqlite/testing';
import {
  resolveHistoricalSearchRevision,
  RunExportProjectionError,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';
import { generateRunExports } from '@busca-ofertas-ai/cli';
import {
  createRun,
  createSourceRun,
  createListing,
  createObservation,
  createSavedSearch,
  type SavedSearchRevisionRecord,
} from '@busca-ofertas-ai/core';

describe('Historical Revision Resolution Semantics (BOAI-014)', () => {
  const runStartedAt = new Date('2026-08-30T10:00:00.000Z');

  function makeRev(params: {
    id: string;
    revisionNumber: number;
    recordedAt: string;
    updatedAt?: string;
  }): SavedSearchRevisionRecord {
    const recDate = new Date(params.recordedAt);
    const upDate = params.updatedAt ? new Date(params.updatedAt) : recDate;
    const snapshot = createSavedSearch({
      id: 'search-1',
      schemaVersion: 1,
      name: `Rev ${params.revisionNumber}`,
      category: 'PRODUCT',
      enabled: true,
      sourceConfigs: [{ id: 'synthetic', enabled: true, queries: ['Switch Lite'] }],
      query: { terms: ['Switch Lite'] },
      evaluation: { matchThreshold: 80, reviewThreshold: 50 },
      ai: {
        enabled: false,
        evaluateOnlyReview: true,
        requireConfirmation: true,
        maxEvaluationsPerRun: 10,
      },
      retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: upDate,
    });
    return {
      id: params.id,
      savedSearchId: 'search-1',
      revisionNumber: params.revisionNumber,
      schemaVersion: 1,
      recordedAt: recDate,
      snapshot,
    };
  }

  it('Scenario A: picks rev 2 (recordedAt <= run.startedAt) when rev 3 is after run.startedAt', () => {
    const rev1 = makeRev({ id: 'r1', revisionNumber: 1, recordedAt: '2026-08-01T10:00:00.000Z' });
    const rev2 = makeRev({ id: 'r2', revisionNumber: 2, recordedAt: '2026-08-25T10:00:00.000Z' });
    const rev3 = makeRev({ id: 'r3', revisionNumber: 3, recordedAt: '2026-09-01T10:00:00.000Z' });

    const selected = resolveHistoricalSearchRevision(
      [rev1, rev2, rev3],
      runStartedAt,
      'run-1',
      'search-1',
    );
    expect(selected.revisionNumber).toBe(2);
    expect(selected.id).toBe('r2');
  });

  it('Scenario B: when two revisions share identical recordedAt, highest revisionNumber wins', () => {
    const revA = makeRev({ id: 'rA', revisionNumber: 2, recordedAt: '2026-08-25T10:00:00.000Z' });
    const revB = makeRev({ id: 'rB', revisionNumber: 4, recordedAt: '2026-08-25T10:00:00.000Z' });

    const selected = resolveHistoricalSearchRevision(
      [revA, revB],
      runStartedAt,
      'run-1',
      'search-1',
    );
    expect(selected.revisionNumber).toBe(4);
    expect(selected.id).toBe('rB');
  });

  it('Scenario C: fails closed with HISTORICAL_REVISION_COHERENCE_ERROR if recordedAt !== snapshot.updatedAt', () => {
    const corruptRev = makeRev({
      id: 'r-corrupt',
      revisionNumber: 1,
      recordedAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T11:00:00.000Z', // Mismatch!
    });

    expect(() =>
      resolveHistoricalSearchRevision([corruptRev], runStartedAt, 'run-1', 'search-1'),
    ).toThrow(RunExportProjectionError);

    try {
      resolveHistoricalSearchRevision([corruptRev], runStartedAt, 'run-1', 'search-1');
    } catch (err: unknown) {
      if (err instanceof RunExportProjectionError) {
        expect(err.code).toBe('HISTORICAL_REVISION_COHERENCE_ERROR');
      } else {
        throw err;
      }
    }
  });

  it('Scenario D: handles non-monotonic timestamps deterministically by recordedAt DESC, revisionNumber DESC', () => {
    // Non-monotonic: rev 5 has earlier recordedAt than rev 3
    const rev3 = makeRev({ id: 'r3', revisionNumber: 3, recordedAt: '2026-08-28T10:00:00.000Z' });
    const rev5 = makeRev({ id: 'r5', revisionNumber: 5, recordedAt: '2026-08-20T10:00:00.000Z' });

    const selected = resolveHistoricalSearchRevision(
      [rev3, rev5],
      runStartedAt,
      'run-1',
      'search-1',
    );
    // Must pick rev 3 because its recordedAt is newer (2026-08-28 > 2026-08-20), NOT rev 5
    expect(selected.revisionNumber).toBe(3);
    expect(selected.id).toBe('r3');
  });

  it('Scenario E: fails closed with HISTORICAL_REVISION_NOT_FOUND if no revision is <= run.startedAt', () => {
    const futureRev = makeRev({
      id: 'r-future',
      revisionNumber: 1,
      recordedAt: '2026-09-01T10:00:00.000Z',
    });

    expect(() =>
      resolveHistoricalSearchRevision([futureRev], runStartedAt, 'run-1', 'search-1'),
    ).toThrow(RunExportProjectionError);

    try {
      resolveHistoricalSearchRevision([futureRev], runStartedAt, 'run-1', 'search-1');
    } catch (err: unknown) {
      if (err instanceof RunExportProjectionError) {
        expect(err.code).toBe('HISTORICAL_REVISION_NOT_FOUND');
      } else {
        throw err;
      }
    }
  });
});

describe('Full SQLite Persisted Run Export Integration (BOAI-014)', () => {
  it('persists a complete execution and generates both results.json and results.csv in report directory', async () => {
    const ctx = createTempDatabaseContext();
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-run-export-reports-'));
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        // 1. Create SavedSearch and Revision
        const searchId = 'search-e2e-1';
        const searchDate = new Date('2026-08-20T10:00:00.000Z');
        const savedSearch = createSavedSearch({
          id: searchId,
          schemaVersion: 1,
          name: 'Nintendo Switch Lite AMBA E2E',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'synthetic', enabled: true, queries: ['Switch Lite'] }],
          query: { terms: ['Switch Lite'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: searchDate,
          updatedAt: searchDate,
        });
        await searchRepo.save(savedSearch);

        // 2. Create Run
        const runId = 'run-e2e-integration';
        const startedAt = new Date('2026-08-30T10:00:00.000Z');
        const finishedAt = new Date('2026-08-30T10:05:00.000Z');
        const run = createRun({
          id: runId,
          savedSearchId: searchId,
          status: 'SUCCESS',
          startedAt,
          finishedAt,
        });
        await runRepo.save(run);

        // 3. Create SourceRun with metadata
        const sourceRunId = 'sr-e2e-1';
        const sourceRun = createSourceRun({
          id: sourceRunId,
          runId,
          sourceId: 'synthetic',
          status: 'SUCCESS',
          startedAt,
          finishedAt,
          itemsCount: 1,
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '0.1.0',
          collectorId: 'collector-synthetic',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 1,
            parsedItemsCount: 1,
            rejectedItemsCount: 0,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        });

        // 4. Create Listing & Observation
        const listing = createListing({
          id: 'listing-e2e-1',
          sourceId: 'synthetic',
          externalId: 'ext-e2e-1',
          canonicalUrl: 'https://example.com/items/1',
          firstSeenAt: startedAt,
          lastSeenAt: startedAt,
        });
        await listingRepo.save(listing);

        const observation = createObservation({
          id: 'obs-e2e-1',
          listingId: listing.id,
          sourceRunId,
          observedAt: startedAt,
          title: 'Nintendo Switch Lite Turquesa Completa',
          description: 'Impecable con caja y funda',
          condition: 'LIKE_NEW',
          availability: 'AVAILABLE',
          price: {
            rawText: '$ 185.000',
            amount: 185000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.95,
            evidence: ['price_badge'],
            kind: 'TOTAL',
          },
          location: {
            rawText: 'Caballito, CABA',
            region: 'CABA',
            city: 'Buenos Aires',
            neighborhood: 'Caballito',
            coordinates: {
              latitude: -34.6186,
              longitude: -58.4428,
            },
          },
          rawFingerprint: 'fp-e2e-1',
          imageUrls: ['https://example.com/img.jpg'],
        });
        await obsRepo.save(observation);

        // 5. Generate exports
        const result = await generateRunExports({
          runId,
          reportsDir,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        expect(fs.existsSync(result.jsonPath)).toBe(true);
        expect(fs.existsSync(result.csvPath)).toBe(true);

        const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf-8')) as RunExportSnapshot;
        expect(json.schemaVersion).toBe(1);
        expect(json.run.id).toBe(runId);
        expect(json.search.name).toBe('Nintendo Switch Lite AMBA E2E');
        expect(json.results).toHaveLength(1);
        expect(json.results[0]?.title).toBe('Nintendo Switch Lite Turquesa Completa');
        expect(json.results[0]?.location?.latitude).toBe(-34.6186);

        const csvContent = fs.readFileSync(result.csvPath, 'utf-8');
        expect(csvContent.includes('Nintendo Switch Lite Turquesa Completa')).toBe(true);
        expect(csvContent.includes('-34.6186')).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
      try {
        fs.rmSync(reportsDir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup errors
      }
    }
  });
});
