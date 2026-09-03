import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createListing,
  createSavedSearch,
  createRun,
  createSourceRun,
  createResolvedPrice,
  computeObservationFingerprint,
  type Hasher,
} from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteObservationRepository,
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  createNodeCryptoHasher,
} from '@busca-ofertas-ai/storage-sqlite';
import { createTempDatabaseContext } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SQLite Concurrency & Multi-Query Deduplication (BOAI-012)', () => {
  const hasher: Hasher = createNodeCryptoHasher();

  it('converges to exactly 1 Listing and 1 Observation when two connections concurrently record the same item', async () => {
    const ctx = createTempDatabaseContext();
    try {
      // 1. Initial setup using dbInit
      const dbInit = openSqliteDatabase({ databasePath: ctx.databasePath });
      dbInit.migrate();

      const searchRepo = new SqliteSavedSearchRepository(dbInit);
      const runRepo = new SqliteRunRepository(dbInit);

      const search = createSavedSearch({
        id: 'search-conc-1',
        schemaVersion: 1,
        name: 'Concurrent Ingestion Search',
        category: 'PRODUCT',
        enabled: true,
        sourceConfigs: [{ id: 'synthetic', enabled: true, queries: ['switch'] }],
        query: { terms: ['switch'] },
        evaluation: { matchThreshold: 80, reviewThreshold: 50 },
        ai: {
          enabled: false,
          evaluateOnlyReview: true,
          requireConfirmation: true,
          maxEvaluationsPerRun: 10,
        },
        retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
        createdAt: new Date('2026-08-30T10:00:00Z'),
        updatedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await searchRepo.save(search);

      const run = createRun({
        id: 'run-conc-1',
        savedSearchId: search.id,
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.save(run);

      const sourceRun = createSourceRun({
        id: 'source-run-conc-1',
        runId: run.id,
        sourceId: 'synthetic',
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.saveSourceRun(sourceRun, { adapterVersion: '0.1.0' });
      dbInit.close();

      // 2. Open two separate connections to the same database file
      const dbConn1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const dbConn2 = openSqliteDatabase({ databasePath: ctx.databasePath });

      const repo1 = new SqliteObservationRepository(dbConn1);
      const repo2 = new SqliteObservationRepository(dbConn2);

      const listingA = createListing({
        id: 'listing-conc-shared',
        sourceId: 'synthetic',
        externalId: 'syn-concurrent-item',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-concurrent-item',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const listingB = createListing({
        id: 'listing-conc-shared',
        sourceId: 'synthetic',
        externalId: 'syn-concurrent-item',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-concurrent-item',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:05:00Z'),
      });

      const price = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });

      const fp = computeObservationFingerprint(
        { title: 'Nintendo Switch Concurrent', price },
        hasher,
      );

      const obs1 = createObservation({
        id: 'obs-conn-1',
        listingId: listingA.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Concurrent',
        price,
        rawFingerprint: fp,
      });

      const obs2 = createObservation({
        id: 'obs-conn-2',
        listingId: listingB.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:05:00Z'),
        title: 'Nintendo Switch Concurrent',
        price,
        rawFingerprint: fp,
      });

      // Record sequentially from connection 1 then connection 2
      const res1 = await repo1.recordObservation({ listing: listingA, observation: obs1 });
      const res2 = await repo2.recordObservation({ listing: listingB, observation: obs2 });

      expect(res1.isNewObservation).toBe(true);
      expect(res1.changeKind).toBe('NEW');

      expect(res2.isNewObservation).toBe(false);
      expect(res2.changeKind).toBe('UNCHANGED');
      expect(res2.observation.id).toBe('obs-conn-1');

      // Assert database has exactly 1 listing and 1 observation
      const listingsCount = dbConn1
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM listings')
        .get();
      expect(listingsCount?.total).toBe(1);

      const obsCount = dbConn1
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM observations')
        .get();
      expect(obsCount?.total).toBe(1);

      dbConn1.close();
      dbConn2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('handles multi-page duplication within same run gracefully', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();

      const searchRepo = new SqliteSavedSearchRepository(db);
      const runRepo = new SqliteRunRepository(db);
      const obsRepo = new SqliteObservationRepository(db);

      const search = createSavedSearch({
        id: 'search-multipage',
        schemaVersion: 1,
        name: 'Multipage Search',
        category: 'PRODUCT',
        enabled: true,
        sourceConfigs: [{ id: 'synthetic', enabled: true, queries: ['switch'] }],
        query: { terms: ['switch'] },
        evaluation: { matchThreshold: 80, reviewThreshold: 50 },
        ai: {
          enabled: false,
          evaluateOnlyReview: true,
          requireConfirmation: true,
          maxEvaluationsPerRun: 10,
        },
        retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
        createdAt: new Date('2026-08-30T10:00:00Z'),
        updatedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await searchRepo.save(search);

      const run = createRun({
        id: 'run-multipage',
        savedSearchId: search.id,
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.save(run);

      const sourceRun = createSourceRun({
        id: 'source-run-multipage',
        runId: run.id,
        sourceId: 'synthetic',
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.saveSourceRun(sourceRun, { adapterVersion: '0.1.0' });

      // Page 1 returns items: item-1, item-2, item-3
      // Page 2 returns items: item-3 (duplicate due to pagination shift), item-4
      const items = [
        { externalId: 'syn-p1', title: 'Item 1' },
        { externalId: 'syn-p2', title: 'Item 2' },
        { externalId: 'syn-p3', title: 'Item 3' }, // Page 1
        { externalId: 'syn-p3', title: 'Item 3' }, // Page 2 duplicate!
        { externalId: 'syn-p4', title: 'Item 4' },
      ];

      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const listing = createListing({
          id: `listing-${item.externalId}`,
          sourceId: 'synthetic',
          externalId: item.externalId,
          canonicalUrl: `https://synthetic.invalid/listings/${item.externalId}`,
          firstSeenAt: new Date('2026-08-30T10:00:00Z'),
          lastSeenAt: new Date(`2026-08-30T10:0${i}:00Z`),
        });

        const fp = computeObservationFingerprint({ title: item.title }, hasher);

        const obs = createObservation({
          id: `obs-${item.externalId}-${i}`,
          listingId: listing.id,
          sourceRunId: sourceRun.id,
          observedAt: new Date(`2026-08-30T10:0${i}:00Z`),
          title: item.title,
          rawFingerprint: fp,
        });

        await obsRepo.recordObservation({ listing, observation: obs });
      }

      // Total listings should be 4 (syn-p1, syn-p2, syn-p3, syn-p4)
      const listingsCount = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM listings')
        .get();
      expect(listingsCount?.total).toBe(4);

      // Total observations should be 4 (item-3 was deduplicated!)
      const obsCount = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM observations')
        .get();
      expect(obsCount?.total).toBe(4);

      db.close();
    } finally {
      ctx.cleanup();
    }
  });
});
