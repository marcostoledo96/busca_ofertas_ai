import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createListing,
  createSavedSearch,
  createRun,
  createSourceRun,
  createResolvedPrice,
} from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteObservationRepository,
  SqliteListingRepository,
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  ObservationIdentityCollisionError,
  StorageCorruptionError,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteObservationRepository (BOAI-012)', () => {
  // Helper to set up prerequisites: SavedSearch -> Run -> SourceRun -> Listing
  const setupPrerequisites = async (db: ReturnType<typeof openSqliteDatabase>) => {
    const searchRepo = new SqliteSavedSearchRepository(db);
    const runRepo = new SqliteRunRepository(db);
    const listingRepo = new SqliteListingRepository(db);

    const search = createSavedSearch({
      id: 'search-1',
      schemaVersion: 1,
      name: 'Nintendo Switch Lite Search',
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
      id: 'run-1',
      savedSearchId: search.id,
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.save(run);

    const sourceRun = createSourceRun({
      id: 'source-run-1',
      runId: run.id,
      sourceId: 'synthetic',
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.saveSourceRun(sourceRun, { adapterVersion: '0.1.0' });

    const listing = createListing({
      id: 'listing-1',
      sourceId: 'synthetic',
      externalId: 'syn-001',
      canonicalUrl: 'https://synthetic.invalid/listings/syn-001',
      firstSeenAt: new Date('2026-08-30T10:00:00Z'),
      lastSeenAt: new Date('2026-08-30T10:00:00Z'),
    });
    await listingRepo.save(listing);

    return { search, run, sourceRun, listing };
  };

  it('persists and retrieves observation by id and by listingId with full roundtrip', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db1);

      const obsRepo1 = new SqliteObservationRepository(db1);

      const price = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.95,
        evidence: ['$250.000'],
        kind: 'TOTAL',
        converted: {
          amount: 250000,
          currency: 'ARS',
          exchangeRate: 1.0,
          exchangeRateOrigin: 'MANUAL',
          convertedAt: new Date('2026-08-30T10:00:00Z'),
        },
      });

      const observation1 = createObservation({
        id: 'obs-uuid-1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:05:00Z'),
        title: 'Nintendo Switch Lite Coral',
        description: 'En caja original con cargador',
        price,
        location: {
          rawText: 'Belgrano, CABA',
          region: 'CABA',
          city: 'Buenos Aires',
          neighborhood: 'Belgrano',
          coordinates: { latitude: -34.56, longitude: -58.45 },
        },
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
        publishedAt: new Date('2026-08-29T18:00:00Z'),
        rawFingerprint: 'deadbeef12345678',
      });

      await obsRepo1.save(observation1);
      db1.close();

      // Reopen and retrieve
      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const obsRepo2 = new SqliteObservationRepository(db2);

      const retrieved = await obsRepo2.getById('obs-uuid-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(observation1.id);
      expect(retrieved!.listingId).toBe(observation1.listingId);
      expect(retrieved!.sourceRunId).toBe(observation1.sourceRunId);
      expect(retrieved!.observedAt).toEqual(observation1.observedAt);
      expect(retrieved!.title).toBe(observation1.title);
      expect(retrieved!.description).toBe(observation1.description);
      expect(retrieved!.price).toEqual(observation1.price);
      expect(retrieved!.location).toEqual(observation1.location);
      expect(retrieved!.condition).toBe(observation1.condition);
      expect(retrieved!.availability).toBe(observation1.availability);
      expect(retrieved!.imageUrls).toEqual(observation1.imageUrls);
      expect(retrieved!.publishedAt).toEqual(observation1.publishedAt);
      expect(retrieved!.rawFingerprint).toBe(observation1.rawFingerprint);

      // List by listing ID
      const list = await obsRepo2.listByListingId(listing.id);
      expect(list.length).toBe(1);
      expect(list[0]!.id).toBe('obs-uuid-1');

      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('persists and retrieves observation with all optional fields null', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      const minimalObs = createObservation({
        id: 'obs-minimal',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T11:00:00Z'),
        title: 'Minimal Nintendo Switch',
        description: null,
        price: null,
        location: null,
        condition: null,
        availability: 'UNKNOWN',
        imageUrls: [],
        publishedAt: null,
        rawFingerprint: 'minimalfingerprint111',
      });

      await repo.save(minimalObs);

      const retrieved = await repo.getById('obs-minimal');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.description).toBeNull();
      expect(retrieved!.price).toBeNull();
      expect(retrieved!.location).toBeNull();
      expect(retrieved!.condition).toBeNull();
      expect(retrieved!.availability).toBe('UNKNOWN');
      expect(retrieved!.imageUrls).toEqual([]);
      expect(retrieved!.publishedAt).toBeNull();
    });
  });

  it('returns observations in chronological order (observed_at ASC, id ASC)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      const obs1 = createObservation({
        id: 'obs-time-1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Title at 10:00',
        rawFingerprint: 'fp1',
      });

      const obs2 = createObservation({
        id: 'obs-time-2',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T12:00:00Z'),
        title: 'Title at 12:00',
        rawFingerprint: 'fp2',
      });

      const obs3 = createObservation({
        id: 'obs-time-3',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T11:00:00Z'),
        title: 'Title at 11:00',
        rawFingerprint: 'fp3',
      });

      // Insert out of order
      await repo.save(obs2);
      await repo.save(obs1);
      await repo.save(obs3);

      const list = await repo.listByListingId(listing.id);
      expect(list.length).toBe(3);
      expect(list[0]!.id).toBe('obs-time-1'); // 10:00
      expect(list[1]!.id).toBe('obs-time-3'); // 11:00
      expect(list[2]!.id).toBe('obs-time-2'); // 12:00
    });
  });

  it('returns null when querying nonexistent observation', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteObservationRepository(db);
      const found = await repo.getById('non-existent');
      expect(found).toBeNull();
    });
  });

  it('rejects foreign key violation when listingId or sourceRunId does not exist (ON DELETE RESTRICT)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun, listing } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      // Invalid listingId
      const invalidListingObs = createObservation({
        id: 'obs-bad-listing',
        listingId: 'non-existent-listing',
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Bad listing',
        rawFingerprint: 'fp-bad',
      });
      await expect(repo.save(invalidListingObs)).rejects.toThrow();

      // Invalid sourceRunId
      const invalidRunObs = createObservation({
        id: 'obs-bad-run',
        listingId: listing.id,
        sourceRunId: 'non-existent-source-run',
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Bad run',
        rawFingerprint: 'fp-bad',
      });
      await expect(repo.save(invalidRunObs)).rejects.toThrow();
    });
  });

  it('enforces immutability: identical save is idempotent, differing save throws ObservationIdentityCollisionError', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      const obs = createObservation({
        id: 'obs-immutable-1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Original Title',
        rawFingerprint: 'fingerprint-original',
      });

      // 1. Initial save
      await repo.save(obs);

      // 2. Identical save -> idempotent success
      await expect(repo.save(obs)).resolves.toBeUndefined();

      // 3. Save same ID with differing content -> collision error
      const mutatedObs = createObservation({
        id: 'obs-immutable-1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Mutated Title Trying to Overwrite History',
        rawFingerprint: 'fingerprint-mutated',
      });

      await expect(repo.save(mutatedObs)).rejects.toThrow(ObservationIdentityCollisionError);

      try {
        await repo.save(mutatedObs);
      } catch (err) {
        expect(err).toBeInstanceOf(ObservationIdentityCollisionError);
        if (err instanceof ObservationIdentityCollisionError) {
          expect(err.code).toBe('OBSERVATION_IDENTITY_COLLISION');
          expect(err.observationId).toBe('obs-immutable-1');
        }
      }

      // 4. Verify historical row remains intact
      const preserved = await repo.getById('obs-immutable-1');
      expect(preserved!.title).toBe('Original Title');
      expect(preserved!.rawFingerprint).toBe('fingerprint-original');
    });
  });

  it('fails closed with StorageCorruptionError when persisted observation contains corrupt date or json', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      // Insert corrupted date row directly
      db.exec(`
        INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint)
        VALUES ('obs-corrupt-date', '${listing.id}', '${sourceRun.id}', 'INVALID_DATE', 'Title', NULL, NULL, NULL, NULL, 'AVAILABLE', '[]', NULL, 'fp');
      `);

      await expect(repo.getById('obs-corrupt-date')).rejects.toThrow(StorageCorruptionError);

      // Insert corrupted json in price
      db.exec(`
        INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint)
        VALUES ('obs-corrupt-price', '${listing.id}', '${sourceRun.id}', '2026-08-30T10:00:00.000Z', 'Title', NULL, 'NOT_VALID_JSON', NULL, NULL, 'AVAILABLE', '[]', NULL, 'fp2');
      `);

      await expect(repo.getById('obs-corrupt-price')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
