import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
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
  projectPersistedRunExport,
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
  type RunRepository,
} from '@busca-ofertas-ai/core';
import { parseCsvRfc4180 } from './helpers/csv-test-parser.js';

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

describe('SourceRun Metadata Coherence and adapterVersion Enforcement (BOAI-014 Finding 1)', () => {
  it('fails closed with SOURCE_METADATA_MISSING when a failed/cancelled/error SourceRun has null metadata', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        const search = createSavedSearch({
          id: 'search-meta-1',
          schemaVersion: 1,
          name: 'Search Meta',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'src-1', enabled: true, queries: ['Test'] }],
          query: { terms: ['Test'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await searchRepo.save(search);

        const run = createRun({
          id: 'run-meta-fail',
          savedSearchId: search.id,
          status: 'FAILED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
          error: 'Execution failed',
        });
        await runRepo.save(run);

        // Save SourceRun with adapterVersion in SQLite
        const sourceRun = createSourceRun({
          id: 'sr-meta-fail',
          runId: run.id,
          sourceId: 'src-1',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
          error: 'Network connection dropped',
        });
        await runRepo.saveSourceRun(sourceRun, { adapterVersion: '1.0.0' });

        // Create a runRepository override that returns null metadata for this source run
        const nullMetadataRunRepo: RunRepository = {
          getById: (id) => runRepo.getById(id),
          save: async (r) => {
            await runRepo.save(r);
          },
          saveSourceRun: async (sr, meta) => {
            await runRepo.saveSourceRun(sr, meta);
          },
          listSourceRunsByRunId: (id) => runRepo.listSourceRunsByRunId(id),
          getSummaryByRunId: (id) => runRepo.getSummaryByRunId(id),
          getSourceRunMetadata: () => Promise.resolve(null),
        };

        await expect(
          projectPersistedRunExport({
            runId: run.id,
            runRepository: nullMetadataRunRepo,
            savedSearchRepository: searchRepo,
            listingRepository: listingRepo,
            observationRepository: obsRepo,
          }),
        ).rejects.toThrow(RunExportProjectionError);

        try {
          await projectPersistedRunExport({
            runId: run.id,
            runRepository: nullMetadataRunRepo,
            savedSearchRepository: searchRepo,
            listingRepository: listingRepo,
            observationRepository: obsRepo,
          });
        } catch (err: unknown) {
          if (err instanceof RunExportProjectionError) {
            expect(err.code).toBe('SOURCE_METADATA_MISSING');
          } else {
            throw err;
          }
        }
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
    }
  });

  it('preserves exact real adapterVersion "2.4.1" on NETWORK_ERROR SourceRun without synthesizing "0.0.0"', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        const search = createSavedSearch({
          id: 'search-net-1',
          schemaVersion: 1,
          name: 'Search Net',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'src-net', enabled: true, queries: ['Test'] }],
          query: { terms: ['Test'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await searchRepo.save(search);

        const run = createRun({
          id: 'run-net-1',
          savedSearchId: search.id,
          status: 'FAILED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
          error: 'Source failed',
        });
        await runRepo.save(run);

        const sourceRun = createSourceRun({
          id: 'sr-net-1',
          runId: run.id,
          sourceId: 'src-net',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
          error: 'Connection reset by peer',
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '2.4.1',
          collectorId: 'collector-net',
        });

        const snapshot = await projectPersistedRunExport({
          runId: run.id,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        expect(snapshot.sources).toHaveLength(1);
        expect(snapshot.sources[0]?.status).toBe('NETWORK_ERROR');
        expect(snapshot.sources[0]?.adapterVersion).toBe('2.4.1');
        expect(snapshot.sources[0]?.error?.message).toBe('Connection reset by peer');
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
    }
  });

  it('preserves exact metadata on CANCELLED SourceRun', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        const search = createSavedSearch({
          id: 'search-cancel-1',
          schemaVersion: 1,
          name: 'Search Cancel',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'src-cancel', enabled: true, queries: ['Test'] }],
          query: { terms: ['Test'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await searchRepo.save(search);

        const run = createRun({
          id: 'run-cancel-1',
          savedSearchId: search.id,
          status: 'CANCELLED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
        });
        await runRepo.save(run);

        const sourceRun = createSourceRun({
          id: 'sr-cancel-1',
          runId: run.id,
          sourceId: 'src-cancel',
          status: 'CANCELLED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:05:00.000Z'),
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '1.5.0-beta.2',
          collectorId: 'collector-cancel',
        });

        const snapshot = await projectPersistedRunExport({
          runId: run.id,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        expect(snapshot.sources).toHaveLength(1);
        expect(snapshot.sources[0]?.status).toBe('CANCELLED');
        expect(snapshot.sources[0]?.adapterVersion).toBe('1.5.0-beta.2');
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
    }
  });
});

describe('Full SQLite Persisted Run Export Integration (BOAI-014)', () => {
  it('proves persisted regeneration idempotency: same run exported before and after a future revision is saved yields identical bytes and SHA-256', async () => {
    const ctx = createTempDatabaseContext();
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-run-export-idempotency-'));
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        // 1. Create SavedSearch revision 1 (2026-08-01)
        const searchId = 'search-idempotent-1';
        const rev1Date = new Date('2026-08-01T10:00:00.000Z');
        const searchRev1 = createSavedSearch({
          id: searchId,
          schemaVersion: 1,
          name: 'Nintendo Switch Lite Rev 1',
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
          createdAt: rev1Date,
          updatedAt: rev1Date,
        });
        await searchRepo.save(searchRev1);

        // 2. Create SavedSearch revision 2 (2026-08-20)
        const rev2Date = new Date('2026-08-20T10:00:00.000Z');
        const searchRev2 = createSavedSearch({
          ...searchRev1,
          name: 'Nintendo Switch Lite Rev 2',
          updatedAt: rev2Date,
        });
        await searchRepo.save(searchRev2);

        // 3. Persist Run with startedAt posterior to rev 2 (2026-08-25)
        const runId = 'run-idempotent-e2e';
        const runStartedAt = new Date('2026-08-25T10:00:00.000Z');
        const runFinishedAt = new Date('2026-08-25T10:05:00.000Z');
        const run = createRun({
          id: runId,
          savedSearchId: searchId,
          status: 'SUCCESS',
          startedAt: runStartedAt,
          finishedAt: runFinishedAt,
        });
        await runRepo.save(run);

        // 4. SourceRun
        const sourceRunId = 'sr-idem-1';
        const sourceRun = createSourceRun({
          id: sourceRunId,
          runId,
          sourceId: 'synthetic',
          status: 'SUCCESS',
          startedAt: runStartedAt,
          finishedAt: runFinishedAt,
          itemsCount: 1,
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '1.0.0',
          collectorId: 'collector-synth',
          metrics: {
            pagesRequested: 2,
            pagesCompleted: 2,
            rawItemsCount: 5,
            parsedItemsCount: 3,
            rejectedItemsCount: 2,
            stopReason: 'ALL_PAGES_FETCHED',
          },
        });

        // 5. Listing & Observation
        const listing = createListing({
          id: 'listing-idem-1',
          sourceId: 'synthetic',
          externalId: 'ext-idem-1',
          canonicalUrl: 'https://example.com/idem/1',
          firstSeenAt: runStartedAt,
          lastSeenAt: runStartedAt,
        });
        await listingRepo.save(listing);

        const obs = createObservation({
          id: 'obs-idem-1',
          listingId: listing.id,
          sourceRunId,
          observedAt: runStartedAt,
          title: 'Nintendo Switch Lite Coral',
          description: 'Caja completa',
          condition: 'LIKE_NEW',
          availability: 'AVAILABLE',
          price: {
            rawText: '$ 160.000',
            amount: 160000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.99,
            evidence: ['tag'],
            kind: 'TOTAL',
          },
          location: {
            rawText: 'Belgrano, CABA',
            region: 'CABA',
            city: 'Buenos Aires',
            neighborhood: 'Belgrano',
            coordinates: { latitude: -34.56, longitude: -58.45 },
          },
          rawFingerprint: 'fp-idem-1',
          imageUrls: ['https://example.com/c.jpg'],
        });
        await obsRepo.save(obs);

        // 6. First export: Generation A
        const resultA = await generateRunExports({
          runId,
          reportsDir,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        const jsonA = fs.readFileSync(resultA.jsonPath);
        const csvA = fs.readFileSync(resultA.csvPath);
        const shaJsonA = crypto.createHash('sha256').update(jsonA).digest('hex');
        const shaCsvA = crypto.createHash('sha256').update(csvA).digest('hex');

        // Verify generation A uses revision 2
        const parsedJsonA = JSON.parse(jsonA.toString('utf-8')) as RunExportSnapshot;
        expect(parsedJsonA.search.revisionNumber).toBe(2);
        expect(parsedJsonA.search.name).toBe('Nintendo Switch Lite Rev 2');

        // 7. Save SavedSearch revision 3 (2026-08-30, AFTER run.startedAt)
        const rev3Date = new Date('2026-08-30T10:00:00.000Z');
        const searchRev3 = createSavedSearch({
          ...searchRev2,
          name: 'Nintendo Switch Lite Rev 3 Future Mutation',
          updatedAt: rev3Date,
        });
        await searchRepo.save(searchRev3);

        // 8. Second export: Generation B for the SAME run
        const resultB = await generateRunExports({
          runId,
          reportsDir,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        const jsonB = fs.readFileSync(resultB.jsonPath);
        const csvB = fs.readFileSync(resultB.csvPath);
        const shaJsonB = crypto.createHash('sha256').update(jsonB).digest('hex');
        const shaCsvB = crypto.createHash('sha256').update(csvB).digest('hex');

        // Verify generation B STILL uses historical revision 2, NOT revision 3!
        const parsedJsonB = JSON.parse(jsonB.toString('utf-8')) as RunExportSnapshot;
        expect(parsedJsonB.search.revisionNumber).toBe(2);
        expect(parsedJsonB.search.name).toBe('Nintendo Switch Lite Rev 2');

        // Exact byte-for-byte and SHA-256 equality
        expect(jsonA.equals(jsonB)).toBe(true);
        expect(csvA.equals(csvB)).toBe(true);
        expect(shaJsonA).toBe(shaJsonB);
        expect(shaCsvA).toBe(shaCsvB);
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
      try {
        fs.rmSync(reportsDir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup error
      }
    }
  });

  it('real SQLite zero-result run: SUCCESS run with ZERO_RESULTS_CONFIRMED source produces valid JSON and CSV with 1 RUN, 1 SOURCE, 0 RESULT rows', async () => {
    const ctx = createTempDatabaseContext();
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-run-export-zero-'));
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        const search = createSavedSearch({
          id: 'search-zero-1',
          schemaVersion: 1,
          name: 'Search Zero Results',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'synthetic', enabled: true, queries: ['NonExistentItemXYZ'] }],
          query: { terms: ['NonExistentItemXYZ'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await searchRepo.save(search);

        const run = createRun({
          id: 'run-zero-1',
          savedSearchId: search.id,
          status: 'SUCCESS',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:02:00.000Z'),
        });
        await runRepo.save(run);

        const sourceRun = createSourceRun({
          id: 'sr-zero-1',
          runId: run.id,
          sourceId: 'synthetic',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:02:00.000Z'),
          itemsCount: 0,
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '1.0.0',
          collectorId: 'collector-zero',
          metrics: {
            pagesRequested: 1,
            pagesCompleted: 1,
            rawItemsCount: 0,
            parsedItemsCount: 0,
            rejectedItemsCount: 0,
            stopReason: 'NO_MORE_RESULTS',
          },
        });

        // 0 Observations persisted

        const result = await generateRunExports({
          runId: run.id,
          reportsDir,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf-8')) as RunExportSnapshot;
        expect(json.run.status).toBe('SUCCESS');
        expect(json.sources).toHaveLength(1);
        expect(json.sources[0]?.status).toBe('ZERO_RESULTS_CONFIRMED');
        expect(json.sources[0]?.itemsCount).toBe(0);
        expect(json.sources[0]?.metrics?.stopReason).toBe('NO_MORE_RESULTS');
        expect(json.results).toEqual([]);

        const csvContent = fs.readFileSync(result.csvPath, 'utf-8');
        const parsedCsv = parseCsvRfc4180(csvContent);

        expect(parsedCsv.headers).toHaveLength(65);
        expect(parsedCsv.rows).toHaveLength(2); // 1 RUN + 1 SOURCE, 0 RESULT
        expect(parsedCsv.rows[0]?.[1]).toBe('RUN');
        expect(parsedCsv.rows[1]?.[1]).toBe('SOURCE');
        expect(parsedCsv.rows[1]?.[18]).toBe('ZERO_RESULTS_CONFIRMED'); // source_status column
        expect(parsedCsv.rows.some((r) => r[1] === 'RESULT')).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
      try {
        fs.rmSync(reportsDir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup error
      }
    }
  });

  it('real SQLite source failure: FAILED run with NETWORK_ERROR source produces valid JSON and CSV with 1 RUN, 1 SOURCE, 0 fake RESULT rows and preserves real error', async () => {
    const ctx = createTempDatabaseContext();
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-run-export-fail-'));
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      try {
        const runRepo = new SqliteRunRepository(db);
        const searchRepo = new SqliteSavedSearchRepository(db);
        const listingRepo = new SqliteListingRepository(db);
        const obsRepo = new SqliteObservationRepository(db);

        const search = createSavedSearch({
          id: 'search-fail-1',
          schemaVersion: 1,
          name: 'Search Source Failure',
          category: 'PRODUCT',
          enabled: true,
          sourceConfigs: [{ id: 'failing-src', enabled: true, queries: ['Test'] }],
          query: { terms: ['Test'] },
          evaluation: { matchThreshold: 80, reviewThreshold: 50 },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 10,
          },
          retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await searchRepo.save(search);

        const run = createRun({
          id: 'run-fail-1',
          savedSearchId: search.id,
          status: 'FAILED',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:01:00.000Z'),
          error: 'Total source failure',
        });
        await runRepo.save(run);

        const sourceRun = createSourceRun({
          id: 'sr-fail-1',
          runId: run.id,
          sourceId: 'failing-src',
          status: 'NETWORK_ERROR',
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          finishedAt: new Date('2026-08-10T10:01:00.000Z'),
          error: 'Connection timeout after 30s',
        });
        await runRepo.saveSourceRun(sourceRun, {
          adapterVersion: '2.4.1',
          collectorId: 'collector-failing',
        });

        // 0 Observations persisted

        const result = await generateRunExports({
          runId: run.id,
          reportsDir,
          runRepository: runRepo,
          savedSearchRepository: searchRepo,
          listingRepository: listingRepo,
          observationRepository: obsRepo,
        });

        const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf-8')) as RunExportSnapshot;
        expect(json.run.status).toBe('FAILED');
        expect(json.run.error?.message).toBe('Total source failure');
        expect(json.sources).toHaveLength(1);
        expect(json.sources[0]?.status).toBe('NETWORK_ERROR');
        expect(json.sources[0]?.adapterVersion).toBe('2.4.1');
        expect(json.sources[0]?.error?.message).toBe('Connection timeout after 30s');
        expect(json.results).toEqual([]);

        const csvContent = fs.readFileSync(result.csvPath, 'utf-8');
        const parsedCsv = parseCsvRfc4180(csvContent);

        expect(parsedCsv.headers).toHaveLength(65);
        expect(parsedCsv.rows).toHaveLength(2); // 1 RUN + 1 SOURCE, 0 RESULT
        expect(parsedCsv.rows[0]?.[1]).toBe('RUN');
        expect(parsedCsv.rows[1]?.[1]).toBe('SOURCE');
        expect(parsedCsv.rows[1]?.[17]).toBe('2.4.1'); // adapter_version column
        expect(parsedCsv.rows[1]?.[18]).toBe('NETWORK_ERROR'); // source_status column
        expect(parsedCsv.rows[1]?.[21]).toBe('Connection timeout after 30s'); // source_error_message column
        expect(parsedCsv.rows.some((r) => r[1] === 'RESULT')).toBe(false);
        expect(parsedCsv.rows.some((r) => r.includes('ZERO_RESULTS_CONFIRMED'))).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      ctx.cleanup();
      try {
        fs.rmSync(reportsDir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup error
      }
    }
  });
});
