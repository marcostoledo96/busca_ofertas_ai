import { describe, it, expect } from 'vitest';
import {
  createObservation,
  createListing,
  createSavedSearch,
  createRun,
  createSourceRun,
  createResolvedPrice,
  computeObservationFingerprint,
  createFallbackExternalId,
  type Hasher,
} from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteObservationRepository,
  SqliteListingRepository,
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  createNodeCryptoHasher,
  ListingIdentityCollisionError,
  ObservationFingerprintCollisionError,
  RecordObservationCoherenceError,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('Deduplication & Change Classification (BOAI-012)', () => {
  const hasher: Hasher = createNodeCryptoHasher();

  const setupPrerequisites = async (db: ReturnType<typeof openSqliteDatabase>) => {
    const searchRepo = new SqliteSavedSearchRepository(db);
    const runRepo = new SqliteRunRepository(db);

    const search = createSavedSearch({
      id: 'search-dedup-1',
      schemaVersion: 1,
      name: 'Nintendo Switch Search',
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
      id: 'run-dedup-1',
      savedSearchId: search.id,
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.save(run);

    const sourceRun = createSourceRun({
      id: 'source-run-dedup-1',
      runId: run.id,
      sourceId: 'synthetic',
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.saveSourceRun(sourceRun, { adapterVersion: '0.1.0' });

    return { search, run, sourceRun };
  };

  it('classifies first sighting as NEW and creates new Observation (isNewObservation = true)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const listing = createListing({
        id: 'listing-first-sight',
        sourceId: 'synthetic',
        externalId: 'syn-first',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-first',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const fp = computeObservationFingerprint(
        {
          title: 'Nintendo Switch Lite Turquesa',
          price: createResolvedPrice({
            rawText: '$250.000',
            amount: 250000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$250.000'],
          }),
        },
        hasher,
      );

      const obs = createObservation({
        id: 'obs-first',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Lite Turquesa',
        price: createResolvedPrice({
          rawText: '$250.000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.9,
          evidence: ['$250.000'],
        }),
        rawFingerprint: fp,
      });

      const result = await obsRepo.recordObservation({ listing, observation: obs });

      expect(result.changeKind).toBe('NEW');
      expect(result.isNewObservation).toBe(true);
      expect(result.listing.id).toBe(listing.id);
      expect(result.observation.id).toBe(obs.id);

      // In DB: 1 listing and 1 observation
      const obsCount = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM observations')
        .get();
      expect(obsCount?.total).toBe(1);
    });
  });

  it('deduplicates identical observation in same run: isNewObservation = false, changeKind = UNCHANGED (Condition 1)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const listing = createListing({
        id: 'listing-dup',
        sourceId: 'synthetic',
        externalId: 'syn-dup',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-dup',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const price = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });

      const fp = computeObservationFingerprint({ title: 'Switch', price }, hasher);

      const obs1 = createObservation({
        id: 'obs-q1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Switch',
        price,
        rawFingerprint: fp,
      });

      // Query 1 returns item
      const res1 = await obsRepo.recordObservation({ listing, observation: obs1 });
      expect(res1.changeKind).toBe('NEW');
      expect(res1.isNewObservation).toBe(true);

      // Query 2 returns the SAME item in the same run with updated lastSeenAt
      const listingQuery2 = createListing({
        id: 'listing-dup',
        sourceId: 'synthetic',
        externalId: 'syn-dup',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-dup',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:05:00Z'),
      });

      const obs2 = createObservation({
        id: 'obs-q2', // different ephemeral observation ID proposed by query 2
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:05:00Z'),
        title: 'Switch',
        price,
        rawFingerprint: fp,
      });

      const res2 = await obsRepo.recordObservation({ listing: listingQuery2, observation: obs2 });

      expect(res2.changeKind).toBe('UNCHANGED');
      expect(res2.isNewObservation).toBe(false);
      expect(res2.observation.id).toBe('obs-q1'); // Retains existing persisted observation!

      // In DB: exactly 1 row in observations
      const count = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM observations')
        .get();
      expect(count?.total).toBe(1);

      // Listing lastSeenAt was updated to 10:05
      const listingRepo = new SqliteListingRepository(db);
      const updatedListing = await listingRepo.getById(listing.id);
      expect(updatedListing!.lastSeenAt.toISOString()).toBe('2026-08-30T10:05:00.000Z');
      expect(updatedListing!.firstSeenAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');
    });
  });

  it('persists new Observation with changeKind = UNCHANGED when non-price content changes (Condition 2)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const listing = createListing({
        id: 'listing-content-change',
        sourceId: 'synthetic',
        externalId: 'syn-cc',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-cc',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const price = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });

      // 1. Initial observation
      const fp1 = computeObservationFingerprint(
        { title: 'Nintendo Switch Lite', description: 'Usada', price, condition: 'GOOD' },
        hasher,
      );
      const obs1 = createObservation({
        id: 'obs-c1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Nintendo Switch Lite',
        description: 'Usada',
        price,
        condition: 'GOOD',
        rawFingerprint: fp1,
      });
      await obsRepo.recordObservation({ listing, observation: obs1 });

      // 2. Second observation: title, description, and condition changed, but price is UNCHANGED and not reappeared
      const fp2 = computeObservationFingerprint(
        {
          title: 'Nintendo Switch Lite + Funda Gratis',
          description: 'Usada, impecable con accesorios',
          price, // price is identical!
          condition: 'LIKE_NEW',
        },
        hasher,
      );
      expect(fp2).not.toBe(fp1);

      const obs2 = createObservation({
        id: 'obs-c2',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T11:00:00Z'),
        title: 'Nintendo Switch Lite + Funda Gratis',
        description: 'Usada, impecable con accesorios',
        price,
        condition: 'LIKE_NEW',
        rawFingerprint: fp2,
      });

      const res2 = await obsRepo.recordObservation({ listing, observation: obs2 });

      // Semantic separation: changeKind is UNCHANGED (no price change, no reappearance),
      // but isNewObservation is TRUE (content changed, observation history recorded!)
      expect(res2.changeKind).toBe('UNCHANGED');
      expect(res2.isNewObservation).toBe(true);
      expect(res2.observation.id).toBe('obs-c2');

      // In DB: exactly 2 observation rows
      const count = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM observations')
        .get();
      expect(count?.total).toBe(2);
    });
  });

  it('classifies price change as PRICE_CHANGED and persists new observation (Condition 3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const listing = createListing({
        id: 'listing-price-drop',
        sourceId: 'synthetic',
        externalId: 'syn-price',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-price',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // Sighting 1: $250.000 ARS
      const price1 = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });
      const fp1 = computeObservationFingerprint({ title: 'Switch', price: price1 }, hasher);
      const obs1 = createObservation({
        id: 'obs-p1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Switch',
        price: price1,
        rawFingerprint: fp1,
      });
      await obsRepo.recordObservation({ listing, observation: obs1 });

      // Sighting 2: price drops to $220.000 ARS
      const price2 = createResolvedPrice({
        rawText: '$220.000',
        amount: 220000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$220.000'],
      });
      const fp2 = computeObservationFingerprint({ title: 'Switch', price: price2 }, hasher);
      const obs2 = createObservation({
        id: 'obs-p2',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T14:00:00Z'),
        title: 'Switch',
        price: price2,
        rawFingerprint: fp2,
      });

      const res2 = await obsRepo.recordObservation({ listing, observation: obs2 });

      expect(res2.changeKind).toBe('PRICE_CHANGED');
      expect(res2.isNewObservation).toBe(true);

      // Verify history has both observations with distinct prices
      const allObs = await obsRepo.listByListingId(listing.id);
      expect(allObs.length).toBe(2);
      expect(allObs[0]!.price?.amount).toBe(250000);
      expect(allObs[1]!.price?.amount).toBe(220000);
    });
  });

  it('classifies REMOVED/SOLD -> AVAILABLE/PENDING as REAPPEARED and does not infer reappearance from absence (Condition 4)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { run } = await setupPrerequisites(db);
      const runRepo = new SqliteRunRepository(db);
      const obsRepo = new SqliteObservationRepository(db);

      const sourceRun1 = createSourceRun({
        id: 'source-run-reappear-1',
        runId: run.id,
        sourceId: 'synthetic',
        startedAt: new Date('2026-08-30T10:00:00Z'),
      });
      await runRepo.saveSourceRun(sourceRun1, { adapterVersion: '0.1.0' });

      const sourceRun2 = createSourceRun({
        id: 'source-run-reappear-2',
        runId: run.id,
        sourceId: 'synthetic',
        startedAt: new Date('2026-08-30T12:00:00Z'),
      });
      await runRepo.saveSourceRun(sourceRun2, { adapterVersion: '0.1.0' });

      const sourceRun3 = createSourceRun({
        id: 'source-run-reappear-3',
        runId: run.id,
        sourceId: 'synthetic',
        startedAt: new Date('2026-08-30T16:00:00Z'),
      });
      await runRepo.saveSourceRun(sourceRun3, { adapterVersion: '0.1.0' });

      const listing = createListing({
        id: 'listing-reappear',
        sourceId: 'synthetic',
        externalId: 'syn-reappear',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-reappear',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // 1. Initial sighting in Run 1: AVAILABLE
      const fp1 = computeObservationFingerprint(
        { title: 'Switch', availability: 'AVAILABLE' },
        hasher,
      );
      const obs1 = createObservation({
        id: 'obs-r1',
        listingId: listing.id,
        sourceRunId: sourceRun1.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Switch',
        availability: 'AVAILABLE',
        rawFingerprint: fp1,
      });
      await obsRepo.recordObservation({ listing, observation: obs1 });

      // 2. Marked SOLD in Run 2
      const fp2 = computeObservationFingerprint({ title: 'Switch', availability: 'SOLD' }, hasher);
      const obs2 = createObservation({
        id: 'obs-r2',
        listingId: listing.id,
        sourceRunId: sourceRun2.id,
        observedAt: new Date('2026-08-30T12:00:00Z'),
        title: 'Switch',
        availability: 'SOLD',
        rawFingerprint: fp2,
      });
      const res2 = await obsRepo.recordObservation({ listing, observation: obs2 });
      expect(res2.changeKind).toBe('UNCHANGED'); // Transitioned to SOLD, not reappeared

      // 3. Marked AVAILABLE again in Run 3 -> REAPPEARED
      const fp3 = computeObservationFingerprint(
        { title: 'Switch', availability: 'AVAILABLE' },
        hasher,
      );
      const obs3 = createObservation({
        id: 'obs-r3',
        listingId: listing.id,
        sourceRunId: sourceRun3.id,
        observedAt: new Date('2026-08-30T16:00:00Z'),
        title: 'Switch',
        availability: 'AVAILABLE',
        rawFingerprint: fp3,
      });
      const res3 = await obsRepo.recordObservation({ listing, observation: obs3 });
      expect(res3.changeKind).toBe('REAPPEARED');
      expect(res3.isNewObservation).toBe(true);

      // Proves absence from a query without explicit SOLD/REMOVED does NOT trigger REAPPEARED
      // (If previous observation was AVAILABLE and next in same run is still AVAILABLE with same fingerprint -> UNCHANGED, deduped)
      const res4 = await obsRepo.recordObservation({ listing, observation: obs3 });
      expect(res4.changeKind).toBe('UNCHANGED');
      expect(res4.isNewObservation).toBe(false);
    });
  });

  it('guarantees atomic rollback when observation insertion fails after listing resolution', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const newListing = createListing({
        id: 'listing-rollback-test',
        sourceId: 'synthetic',
        externalId: 'syn-rollback',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-rollback',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // Observation has an invalid sourceRunId that causes FK failure
      const badObs = createObservation({
        id: 'obs-failing-fk',
        listingId: newListing.id,
        sourceRunId: 'non-existent-source-run-id',
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Rollback item',
        rawFingerprint: 'fp-fail',
      });

      await expect(
        obsRepo.recordObservation({ listing: newListing, observation: badObs }),
      ).rejects.toThrow();

      // Assert that listing was NOT left in database (atomic rollback!)
      const listingRepo = new SqliteListingRepository(db);
      const foundListing = await listingRepo.getById('listing-rollback-test');
      expect(foundListing).toBeNull();
    });
  });

  it('detects and rejects fallback hash collisions on different canonical URLs (Condition 4)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const canonicalUrlA = 'https://synthetic.invalid/listings/item-alpha';
      const canonicalUrlB = 'https://synthetic.invalid/listings/item-beta';

      // Simulate a fake hasher that collides on two different canonical URLs
      const collidingHasher: Hasher = {
        hash: () => 'identical-collision-hash-1234567890abcdef',
      };

      const fallbackIdA = createFallbackExternalId(canonicalUrlA, collidingHasher);
      const fallbackIdB = createFallbackExternalId(canonicalUrlB, collidingHasher);
      expect(fallbackIdA).toBe(fallbackIdB);

      const listingA = createListing({
        id: 'listing-alpha',
        sourceId: 'synthetic',
        externalId: fallbackIdA,
        canonicalUrl: canonicalUrlA,
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const obsA = createObservation({
        id: 'obs-alpha',
        listingId: listingA.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Item Alpha',
        rawFingerprint: 'fp-alpha',
      });

      // 1. Save listing A successfully
      await obsRepo.recordObservation({ listing: listingA, observation: obsA });

      // 2. Incoming listing B has DIFFERENT canonicalUrl but identical fallbackId (collision!)
      const listingB = createListing({
        id: 'listing-beta',
        sourceId: 'synthetic',
        externalId: fallbackIdB,
        canonicalUrl: canonicalUrlB, // Conflicting URL!
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const obsB = createObservation({
        id: 'obs-beta',
        listingId: listingB.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Item Beta',
        rawFingerprint: 'fp-beta',
      });

      await expect(
        obsRepo.recordObservation({ listing: listingB, observation: obsB }),
      ).rejects.toThrow(ListingIdentityCollisionError);

      // Existing listing A is preserved intact
      const listingRepo = new SqliteListingRepository(db);
      const preserved = await listingRepo.getById('listing-alpha');
      expect(preserved!.canonicalUrl).toBe(canonicalUrlA);
    });
  });

  it('rejects fingerprint collision with ObservationFingerprintCollisionError when fake hasher collides on differing content (Finding 3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const fakeHasher: Hasher = {
        hash: () => 'identical-fingerprint-hash',
      };

      const listing = createListing({
        id: 'listing-fp-collision',
        sourceId: 'synthetic',
        externalId: 'syn-fp-collision',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-fp-collision',
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // Observation 1: Title "Item Alpha", condition "NEW"
      const fp1 = computeObservationFingerprint(
        { title: 'Item Alpha', condition: 'NEW' },
        fakeHasher,
      );
      const obs1 = createObservation({
        id: 'obs-fp-col-1',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:00:00Z'),
        title: 'Item Alpha',
        condition: 'NEW',
        rawFingerprint: fp1,
      });

      // Save obs1 successfully
      const res1 = await obsRepo.recordObservation({ listing, observation: obs1 });
      expect(res1.isNewObservation).toBe(true);
      expect(res1.changeKind).toBe('NEW');

      // Observation 2: same listing, same sourceRun, same rawFingerprint (via fakeHasher), but differing title and condition!
      const fp2 = computeObservationFingerprint(
        { title: 'Item Beta Differing Content', condition: 'FOR_PARTS' },
        fakeHasher,
      );
      expect(fp1).toBe(fp2); // Confirms hash collided!

      const obs2 = createObservation({
        id: 'obs-fp-col-2',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:05:00Z'),
        title: 'Item Beta Differing Content',
        condition: 'FOR_PARTS',
        rawFingerprint: fp2,
      });

      await expect(obsRepo.recordObservation({ listing, observation: obs2 })).rejects.toThrow(
        ObservationFingerprintCollisionError,
      );

      try {
        await obsRepo.recordObservation({ listing, observation: obs2 });
      } catch (err) {
        expect(err).toBeInstanceOf(ObservationFingerprintCollisionError);
        if (err instanceof ObservationFingerprintCollisionError) {
          expect(err.code).toBe('OBSERVATION_FINGERPRINT_COLLISION');
          expect(err.fingerprint).toBe(fp1);
          expect(err.listingId).toBe(listing.id);
          expect(err.sourceRunId).toBe(sourceRun.id);
        }
      }

      // Assert zero mutation / corruption: exactly 1 historical observation preserved
      const history = await obsRepo.listByListingId(listing.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe('obs-fp-col-1');
      expect(history[0]!.title).toBe('Item Alpha');
      expect(history[0]!.condition).toBe('NEW');
    });
  });

  it('rejects out-of-order observation fail-closed when incoming observedAt is older than latest persisted (Finding C)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);

      const listing = createListing({
        id: 'listing-chronological-test',
        sourceId: 'synthetic',
        externalId: 'syn-item-chrono',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-item-chrono',
        firstSeenAt: new Date('2026-08-30T10:30:00.000Z'),
        lastSeenAt: new Date('2026-08-30T10:30:00.000Z'),
      });

      // 1. Persist latest observation at 10:30
      const fpLatest = computeObservationFingerprint(
        { title: 'Nintendo Switch Latest', price: null },
        hasher,
      );
      const obsLatest = createObservation({
        id: 'obs-latest-1030',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:30:00.000Z'),
        title: 'Nintendo Switch Latest',
        rawFingerprint: fpLatest,
      });

      const res1 = await obsRepo.recordObservation({ listing, observation: obsLatest });
      expect(res1.isNewObservation).toBe(true);
      expect(res1.changeKind).toBe('NEW');

      // 2. Incoming observation with observedAt = 09:30 (older than latest persisted 10:30)
      const fpOlder = computeObservationFingerprint(
        { title: 'Nintendo Switch Older Out-Of-Order', price: null },
        hasher,
      );
      const obsOlder = createObservation({
        id: 'obs-older-0930',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T09:30:00.000Z'), // out-of-order!
        title: 'Nintendo Switch Older Out-Of-Order',
        rawFingerprint: fpOlder,
      });

      await expect(obsRepo.recordObservation({ listing, observation: obsOlder })).rejects.toThrow(
        RecordObservationCoherenceError,
      );

      try {
        await obsRepo.recordObservation({ listing, observation: obsOlder });
      } catch (err) {
        expect(err).toBeInstanceOf(RecordObservationCoherenceError);
        if (err instanceof RecordObservationCoherenceError) {
          expect(err.code).toBe('RECORD_OBSERVATION_COHERENCE_ERROR');
          expect(err.details.kind).toBe('OUT_OF_ORDER_OBSERVED_AT');
          expect(err.details.incomingObservedAt).toBe('2026-08-30T09:30:00.000Z');
          expect(err.details.latestPersistedObservedAt).toBe('2026-08-30T10:30:00.000Z');
          expect(err.details.listingId).toBe(listing.id);
        }
      }

      // 3. Verify zero mutation: exactly 1 observation remains in the database
      const history = await obsRepo.listByListingId(listing.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe('obs-latest-1030');
      expect(history[0]!.observedAt.toISOString()).toBe('2026-08-30T10:30:00.000Z');
    });
  });

  it('rejects out-of-order incoming observation even when exact identical intra-run dedup match is present (Finding B regression)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const { sourceRun } = await setupPrerequisites(db);
      const obsRepo = new SqliteObservationRepository(db);
      const listingRepo = new SqliteListingRepository(db);

      const listing = createListing({
        id: 'listing-dedup-chrono-test',
        sourceId: 'synthetic',
        externalId: 'syn-dedup-chrono',
        canonicalUrl: 'https://synthetic.invalid/listings/syn-dedup-chrono',
        firstSeenAt: new Date('2026-08-30T10:30:00.000Z'),
        lastSeenAt: new Date('2026-08-30T10:30:00.000Z'),
      });

      const fp = computeObservationFingerprint({ title: 'Identical Item', price: null }, hasher);

      // 1. Persist initial observation at 10:30:00.000Z
      const obsInitial = createObservation({
        id: 'obs-initial-1030',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T10:30:00.000Z'),
        title: 'Identical Item',
        rawFingerprint: fp,
      });
      const res1 = await obsRepo.recordObservation({ listing, observation: obsInitial });
      expect(res1.isNewObservation).toBe(true);
      expect(res1.changeKind).toBe('NEW');

      // 2. Incoming identical observation with older timestamp 09:30:00.000Z
      // Same sourceRun, same fingerprint, same canonical payload, different ephemeral Observation.id
      const obsOlderIdentical = createObservation({
        id: 'obs-older-identical-0930',
        listingId: listing.id,
        sourceRunId: sourceRun.id,
        observedAt: new Date('2026-08-30T09:30:00.000Z'), // older than latest persisted 10:30!
        title: 'Identical Item',
        rawFingerprint: fp,
      });

      // Must reject fail-closed and must NOT return UNCHANGED / isNewObservation: false
      await expect(
        obsRepo.recordObservation({ listing, observation: obsOlderIdentical }),
      ).rejects.toThrow(RecordObservationCoherenceError);

      try {
        await obsRepo.recordObservation({ listing, observation: obsOlderIdentical });
      } catch (err) {
        expect(err).toBeInstanceOf(RecordObservationCoherenceError);
        if (err instanceof RecordObservationCoherenceError) {
          expect(err.code).toBe('RECORD_OBSERVATION_COHERENCE_ERROR');
          expect(err.details.kind).toBe('OUT_OF_ORDER_OBSERVED_AT');
          expect(err.details.incomingObservedAt).toBe('2026-08-30T09:30:00.000Z');
          expect(err.details.latestPersistedObservedAt).toBe('2026-08-30T10:30:00.000Z');
          expect(err.details.listingId).toBe(listing.id);
        }
      }

      // 3. Verify zero mutation and complete rollback:
      // observations count unchanged
      const history = await obsRepo.listByListingId(listing.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe('obs-initial-1030');
      expect(history[0]!.observedAt.toISOString()).toBe('2026-08-30T10:30:00.000Z');

      // Listing.firstSeenAt, Listing.lastSeenAt, canonicalUrl unchanged
      const persistedListing = await listingRepo.getById(listing.id);
      expect(persistedListing).not.toBeNull();
      expect(persistedListing!.firstSeenAt.toISOString()).toBe('2026-08-30T10:30:00.000Z');
      expect(persistedListing!.lastSeenAt.toISOString()).toBe('2026-08-30T10:30:00.000Z');
      expect(persistedListing!.canonicalUrl).toBe(listing.canonicalUrl);
    });
  });
});
