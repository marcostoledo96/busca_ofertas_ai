import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createListing,
  createSavedSearch,
  createRun,
  createSourceRun,
  createResolvedPrice,
  computeObservationFingerprint,
} from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteObservationRepository,
  SqliteListingRepository,
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  ObservationIdentityCollisionError,
  RecordObservationCoherenceError,
  StorageCorruptionError,
  createNodeCryptoHasher,
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

  it('fails closed on direct row manipulation with corrupted price or location fields (Finding 1)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      const validPrice = {
        rawText: '$100',
        amount: 100,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$100'],
        kind: 'TOTAL',
      };

      const validLocation = {
        rawText: 'Palermo',
        region: 'CABA',
        city: 'Buenos Aires',
        neighborhood: 'Palermo',
        coordinates: { latitude: -34.58, longitude: -58.43 },
      };

      const corruptionScenarios = [
        {
          id: 'corrupt-price-amount-string',
          price: { ...validPrice, amount: 'CORRUPT' },
          location: validLocation,
        },
        {
          id: 'corrupt-price-amount-missing',
          price: {
            rawText: '$100',
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$100'],
            kind: 'TOTAL',
          },
          location: validLocation,
        },
        {
          id: 'corrupt-price-kind-broken',
          price: { ...validPrice, kind: 'BROKEN' },
          location: validLocation,
        },
        {
          id: 'corrupt-price-kind-missing',
          price: {
            rawText: '$100',
            amount: 100,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$100'],
          },
          location: validLocation,
        },
        {
          id: 'corrupt-price-confidence-out-of-range',
          price: { ...validPrice, confidence: 2 },
          location: validLocation,
        },
        {
          id: 'corrupt-location-region-number',
          price: validPrice,
          location: { ...validLocation, region: 123 },
        },
        {
          id: 'corrupt-location-city-object',
          price: validPrice,
          location: { ...validLocation, city: {} },
        },
        {
          id: 'corrupt-location-neighborhood-bool',
          price: validPrice,
          location: { ...validLocation, neighborhood: false },
        },
        {
          id: 'corrupt-coordinates-lat-invalid',
          price: validPrice,
          location: { ...validLocation, coordinates: { latitude: 999, longitude: -58.43 } },
        },
      ];

      for (const scenario of corruptionScenarios) {
        db.exec(`
          INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint)
          VALUES ('${scenario.id}', '${listing.id}', '${sourceRun.id}', '2026-08-30T10:00:00.000Z', 'Title', NULL, '${JSON.stringify(scenario.price)}', '${JSON.stringify(scenario.location)}', NULL, 'AVAILABLE', '[]', NULL, 'fp-${scenario.id}');
        `);

        await expect(repo.getById(scenario.id)).rejects.toThrow(StorageCorruptionError);
      }

      // listByListingId must also fail closed when a corrupted observation row is present
      await expect(repo.listByListingId(listing.id)).rejects.toThrow(StorageCorruptionError);
    });
  });

  it('enforces complete immutability: same id/fp/price amount but different resolution/confidence/evidence/converted fields reject with ObservationIdentityCollisionError (Finding 2)', async () => {
    const hasher = createNodeCryptoHasher();

    await withTempDatabase(async (db) => {
      db.migrate();
      const { listing, sourceRun } = await setupPrerequisites(db);
      const repo = new SqliteObservationRepository(db);

      const basePrice = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
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

      const fp = computeObservationFingerprint(
        { title: 'Nintendo Switch Immutability Test', price: basePrice },
        hasher,
      );

      const canonicalObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: basePrice,
        rawFingerprint: fp,
      });

      // 1. Initial save
      await repo.save(canonicalObs);

      // 2. Exactly identical save must continue to be idempotent
      await expect(repo.save(canonicalObs)).resolves.toBeUndefined();

      // 3. Same id + same rawFingerprint + same amount/currency/kind, but:
      // a) different resolution (EXPLICIT vs SOURCE_METADATA)
      const diffResolutionObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'SOURCE_METADATA', // differing
          confidence: 0.9,
          evidence: ['$250.000'],
          kind: 'TOTAL',
          ...(basePrice.converted ? { converted: basePrice.converted } : {}),
        }),
        rawFingerprint: fp,
      });
      await expect(repo.save(diffResolutionObs)).rejects.toThrow(ObservationIdentityCollisionError);

      // b) different confidence (0.9 vs 0.8)
      const diffConfidenceObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.8, // differing
          evidence: ['$250.000'],
          kind: 'TOTAL',
          ...(basePrice.converted ? { converted: basePrice.converted } : {}),
        }),
        rawFingerprint: fp,
      });
      await expect(repo.save(diffConfidenceObs)).rejects.toThrow(ObservationIdentityCollisionError);

      // c) different evidence (['$250.000'] vs ['$250.000', 'promo tag'])
      const diffEvidenceObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.9,
          evidence: ['$250.000', 'promo tag'], // differing
          kind: 'TOTAL',
          ...(basePrice.converted ? { converted: basePrice.converted } : {}),
        }),
        rawFingerprint: fp,
      });
      await expect(repo.save(diffEvidenceObs)).rejects.toThrow(ObservationIdentityCollisionError);

      // d) different converted.exchangeRate (1.0 vs 1.15)
      const diffRateObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.9,
          evidence: ['$250.000'],
          kind: 'TOTAL',
          converted: {
            amount: 250000,
            currency: 'ARS',
            exchangeRate: 1.15, // differing
            exchangeRateOrigin: 'MANUAL',
            convertedAt: new Date('2026-08-30T10:00:00Z'),
          },
        }),
        rawFingerprint: fp,
      });
      await expect(repo.save(diffRateObs)).rejects.toThrow(ObservationIdentityCollisionError);

      // e) different converted.convertedAt
      const diffConvertedAtObs = createObservation({
        id: 'obs-immutability-full',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Immutability Test',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.9,
          evidence: ['$250.000'],
          kind: 'TOTAL',
          converted: {
            amount: 250000,
            currency: 'ARS',
            exchangeRate: 1.0,
            exchangeRateOrigin: 'MANUAL',
            convertedAt: new Date('2026-08-30T14:30:00Z'), // differing
          },
        }),
        rawFingerprint: fp,
      });
      await expect(repo.save(diffConvertedAtObs)).rejects.toThrow(
        ObservationIdentityCollisionError,
      );

      // Verify original row in DB remains 100% intact
      const preserved = await repo.getById('obs-immutability-full');
      expect(preserved!.price?.confidence).toBe(0.9);
      expect(preserved!.price?.resolution).toBe('EXPLICIT');
      expect(preserved!.price?.evidence).toEqual(['$250.000']);
      expect(preserved!.price?.converted?.exchangeRate).toBe(1.0);
      expect(preserved!.price?.converted?.convertedAt.toISOString()).toBe(
        '2026-08-30T10:00:00.000Z',
      );

      // 4. recordObservation attempting to insert existing ID with differing content also throws ObservationIdentityCollisionError
      await expect(
        repo.recordObservation({
          listing,
          observation: diffResolutionObs,
        }),
      ).rejects.toThrow(ObservationIdentityCollisionError);
    });
  });

  it('enforces input coherence in recordObservation: listingId mismatch and sourceId mismatch reject fail-closed (Coherence)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { run } = await setupPrerequisites(db);
      const runRepo = new SqliteRunRepository(db);
      const obsRepo = new SqliteObservationRepository(db);

      // Create a source run for source 'other-source'
      const otherSourceRun = createSourceRun({
        id: 'source-run-other-source',
        runId: run.id,
        sourceId: 'other-source',
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.saveSourceRun(otherSourceRun, { adapterVersion: '0.1.0' });

      const listing = createListing({
        id: 'listing-coherence-1',
        sourceId: 'synthetic',
        externalId: 'syn-coherence',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-coherence',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // 1. Incoming listing.id !== observation.listingId
      const mismatchedIdObs = createObservation({
        id: 'obs-mismatched-id',
        listingId: 'different-provisional-id', // mismatch!
        sourceRunId: 'source-run-1',
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Mismatched ID',
        rawFingerprint: 'fp-mismatch',
      });

      await expect(
        obsRepo.recordObservation({
          listing,
          observation: mismatchedIdObs,
        }),
      ).rejects.toThrow(RecordObservationCoherenceError);

      try {
        await obsRepo.recordObservation({ listing, observation: mismatchedIdObs });
      } catch (err) {
        expect(err).toBeInstanceOf(RecordObservationCoherenceError);
        if (err instanceof RecordObservationCoherenceError) {
          expect(err.code).toBe('RECORD_OBSERVATION_COHERENCE_ERROR');
          expect(err.details.kind).toBe('LISTING_ID_MISMATCH');
        }
      }

      // 2. Listing source 'synthetic' recorded under SourceRun of source 'other-source'
      const mismatchedSourceObs = createObservation({
        id: 'obs-mismatched-source',
        listingId: listing.id,
        sourceRunId: otherSourceRun.id, // source is 'other-source', listing source is 'synthetic'
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Mismatched Source',
        rawFingerprint: 'fp-source-mismatch',
      });

      await expect(
        obsRepo.recordObservation({
          listing,
          observation: mismatchedSourceObs,
        }),
      ).rejects.toThrow(RecordObservationCoherenceError);

      try {
        await obsRepo.recordObservation({ listing, observation: mismatchedSourceObs });
      } catch (err) {
        expect(err).toBeInstanceOf(RecordObservationCoherenceError);
        if (err instanceof RecordObservationCoherenceError) {
          expect(err.code).toBe('RECORD_OBSERVATION_COHERENCE_ERROR');
          expect(err.details.kind).toBe('SOURCE_ID_MISMATCH');
        }
      }

      // Assert zero mutation / zero writes
      const listingCount = db
        .prepare<{ total: number }, [string]>('SELECT COUNT(*) as total FROM listings WHERE id = ?')
        .get('listing-coherence-1');
      expect(listingCount?.total).toBe(0);

      const obsCount = db
        .prepare<{ total: number }, [string, string]>(
          'SELECT COUNT(*) as total FROM observations WHERE id IN (?, ?)',
        )
        .get('obs-mismatched-id', 'obs-mismatched-source');
      expect(obsCount?.total).toBe(0);
    });
  });
});
