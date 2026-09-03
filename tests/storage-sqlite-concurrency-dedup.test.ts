import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import {
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
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  createNodeCryptoHasher,
} from '@busca-ofertas-ai/storage-sqlite';
import { createTempDatabaseContext } from '@busca-ofertas-ai/storage-sqlite/testing';

interface WorkerTaskPayload {
  readonly listing: {
    readonly id: string;
    readonly sourceId: string;
    readonly externalId: string;
    readonly canonicalUrl: string;
    readonly firstSeenAt: string;
    readonly lastSeenAt: string;
  };
  readonly observation: {
    readonly id: string;
    readonly listingId: string;
    readonly sourceRunId: string;
    readonly observedAt: string;
    readonly title: string;
    readonly description?: string | null;
    readonly price?: {
      readonly rawText: string;
      readonly amount: number | null;
      readonly currency: 'ARS' | 'USD' | 'UNKNOWN';
      readonly resolution: 'EXPLICIT' | 'SOURCE_METADATA' | 'TEXT_INFERENCE' | 'AMBIGUOUS';
      readonly confidence: number;
      readonly evidence: readonly string[];
      readonly kind: 'TOTAL' | 'DEPOSIT' | 'INSTALLMENT' | 'FROM_PRICE' | 'UNKNOWN';
    } | null;
    readonly location?: {
      readonly rawText: string;
      readonly region?: string;
      readonly city?: string;
      readonly neighborhood?: string;
      readonly coordinates?: { readonly latitude: number; readonly longitude: number };
    } | null;
    readonly condition?: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS' | 'UNKNOWN' | null;
    readonly availability?: 'AVAILABLE' | 'PENDING' | 'SOLD' | 'REMOVED' | 'UNKNOWN';
    readonly imageUrls?: readonly string[];
    readonly publishedAt?: string | null;
    readonly rawFingerprint: string;
  };
}

interface WorkerResultPayload {
  readonly ok: boolean;
  readonly result?: {
    readonly listingId: string;
    readonly observationId: string;
    readonly isNewObservation: boolean;
    readonly changeKind: string;
  };
  readonly error?: {
    readonly name: string;
    readonly code?: string;
    readonly message: string;
  };
}

const WORKER_SCRIPT = `
import { parentPort } from 'node:worker_threads';
import { openSqliteDatabase, SqliteObservationRepository } from '@busca-ofertas-ai/storage-sqlite';
import { createListing, createObservation, createResolvedPrice } from '@busca-ofertas-ai/core';

let db = null;
let repo = null;

parentPort.on('message', async (msg) => {
  if (msg.type === 'init') {
    db = openSqliteDatabase({ databasePath: msg.databasePath });
    repo = new SqliteObservationRepository(db);
    parentPort.postMessage({ type: 'ready' });
  } else if (msg.type === 'execute') {
    try {
      const task = msg.task;
      const listing = createListing({
        id: task.listing.id,
        sourceId: task.listing.sourceId,
        externalId: task.listing.externalId,
        canonicalUrl: task.listing.canonicalUrl,
        firstSeenAt: new Date(task.listing.firstSeenAt),
        lastSeenAt: new Date(task.listing.lastSeenAt),
      });

      let price = null;
      if (task.observation.price) {
        price = createResolvedPrice(task.observation.price);
      }

      const observation = createObservation({
        id: task.observation.id,
        listingId: task.observation.listingId,
        sourceRunId: task.observation.sourceRunId,
        observedAt: new Date(task.observation.observedAt),
        title: task.observation.title,
        description: task.observation.description ?? null,
        price,
        location: task.observation.location ?? null,
        condition: task.observation.condition ?? null,
        availability: task.observation.availability ?? 'AVAILABLE',
        imageUrls: task.observation.imageUrls ?? [],
        publishedAt: task.observation.publishedAt ? new Date(task.observation.publishedAt) : null,
        rawFingerprint: task.observation.rawFingerprint,
      });

      const res = await repo.recordObservation({ listing, observation });
      parentPort.postMessage({
        type: 'done',
        ok: true,
        result: {
          listingId: res.listing.id,
          observationId: res.observation.id,
          isNewObservation: res.isNewObservation,
          changeKind: res.changeKind,
        },
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'done',
        ok: false,
        error: {
          name: err.name,
          code: err.code,
          message: err.message,
        },
      });
    } finally {
      if (db) {
        try {
          db.close();
        } catch {}
      }
    }
  }
});
`;

interface WorkerMessage {
  readonly type?: string;
  readonly ok?: boolean;
  readonly result?: WorkerResultPayload['result'];
  readonly error?: WorkerResultPayload['error'];
}

function runConcurrentWorkers(
  databasePath: string,
  taskA: WorkerTaskPayload,
  taskB: WorkerTaskPayload,
): Promise<[WorkerResultPayload, WorkerResultPayload]> {
  return new Promise((resolve, reject) => {
    const w1 = new Worker(WORKER_SCRIPT, { eval: true });
    const w2 = new Worker(WORKER_SCRIPT, { eval: true });

    let readyCount = 0;
    let resA: WorkerResultPayload | null = null;
    let resB: WorkerResultPayload | null = null;

    const checkDone = () => {
      if (resA && resB) {
        Promise.all([w1.terminate(), w2.terminate()])
          .then(() => resolve([resA!, resB!]))
          .catch(reject);
      }
    };

    w1.on('message', (rawMsg: unknown) => {
      const msg = rawMsg as WorkerMessage;
      if (msg.type === 'ready') {
        readyCount++;
        if (readyCount === 2) {
          // Release the barrier: start both workers simultaneously on separate threads
          w1.postMessage({ type: 'execute', task: taskA });
          w2.postMessage({ type: 'execute', task: taskB });
        }
      } else if (msg.type === 'done') {
        resA = {
          ok: Boolean(msg.ok),
          ...(msg.result ? { result: msg.result } : {}),
          ...(msg.error ? { error: msg.error } : {}),
        };
        checkDone();
      }
    });

    w2.on('message', (rawMsg: unknown) => {
      const msg = rawMsg as WorkerMessage;
      if (msg.type === 'ready') {
        readyCount++;
        if (readyCount === 2) {
          // Release the barrier: start both workers simultaneously on separate threads
          w1.postMessage({ type: 'execute', task: taskA });
          w2.postMessage({ type: 'execute', task: taskB });
        }
      } else if (msg.type === 'done') {
        resB = {
          ok: Boolean(msg.ok),
          ...(msg.result ? { result: msg.result } : {}),
          ...(msg.error ? { error: msg.error } : {}),
        };
        checkDone();
      }
    });

    w1.on('error', reject);
    w2.on('error', reject);

    w1.postMessage({ type: 'init', databasePath });
    w2.postMessage({ type: 'init', databasePath });
  });
}

describe('SQLite Concurrency & Multi-Threaded Deduplication (BOAI-012 / Finding 4)', () => {
  const hasher: Hasher = createNodeCryptoHasher();

  const setupDatabasePrerequisites = async (databasePath: string) => {
    const db = openSqliteDatabase({ databasePath });
    db.migrate();

    const searchRepo = new SqliteSavedSearchRepository(db);
    const runRepo = new SqliteRunRepository(db);

    const search = createSavedSearch({
      id: 'search-conc-shared',
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
      id: 'run-conc-shared',
      savedSearchId: search.id,
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.save(run);

    const sourceRun = createSourceRun({
      id: 'source-run-conc-shared',
      runId: run.id,
      sourceId: 'synthetic',
      startedAt: new Date('2026-08-30T10:00:00Z'),
    });
    await runRepo.saveSourceRun(sourceRun, { adapterVersion: '0.1.0' });

    db.close();
    return { search, run, sourceRun };
  };

  it('Scenario 1: writer A and writer B record same (sourceId, externalId) starting from empty listing table with true thread concurrency', async () => {
    const ctx = createTempDatabaseContext();
    try {
      await setupDatabasePrerequisites(ctx.databasePath);

      const taskA: WorkerTaskPayload = {
        listing: {
          id: 'listing-writer-a',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-1',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-1',
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:00:00.000Z',
        },
        observation: {
          id: 'obs-writer-a',
          listingId: 'listing-writer-a',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:00:00.000Z',
          title: 'Nintendo Switch Writer A',
          rawFingerprint: 'fp-writer-a',
        },
      };

      const taskB: WorkerTaskPayload = {
        listing: {
          id: 'listing-writer-b',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-1',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-1',
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:05:00.000Z',
        },
        observation: {
          id: 'obs-writer-b',
          listingId: 'listing-writer-b',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:05:00.000Z',
          title: 'Nintendo Switch Writer B',
          rawFingerprint: 'fp-writer-b',
        },
      };

      // Launch both worker threads simultaneously
      const [resA, resB] = await runConcurrentWorkers(ctx.databasePath, taskA, taskB);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      expect(resA.error).toBeUndefined();
      expect(resB.error).toBeUndefined();

      // Verify convergence: exactly 1 Listing row created in the database
      const verifyDb = openSqliteDatabase({ databasePath: ctx.databasePath });
      const listings = verifyDb
        .prepare<{ count: number }, [string, string]>(
          'SELECT COUNT(*) as count FROM listings WHERE source_id = ? AND external_id = ?',
        )
        .get('synthetic', 'syn-item-scenario-1');

      expect(listings?.count).toBe(1);

      // Both observations point to the single converged listing id
      const convergedListing = verifyDb
        .prepare<{ id: string }, [string, string]>(
          'SELECT id FROM listings WHERE source_id = ? AND external_id = ?',
        )
        .get('synthetic', 'syn-item-scenario-1');

      expect(resA.result?.listingId).toBe(convergedListing?.id);
      expect(resB.result?.listingId).toBe(convergedListing?.id);

      verifyDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('Scenario 2: two concurrent threads recording same listing, same sourceRun, same fingerprint/content converge to exactly 1 Observation', async () => {
    const ctx = createTempDatabaseContext();
    try {
      await setupDatabasePrerequisites(ctx.databasePath);

      const basePrice = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });

      const fp = computeObservationFingerprint(
        { title: 'Nintendo Switch Concurrent Dedup', price: basePrice },
        hasher,
      );

      const taskA: WorkerTaskPayload = {
        listing: {
          id: 'listing-scenario-2',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-2',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-2',
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:00:00.000Z',
        },
        observation: {
          id: 'obs-scenario-2-a',
          listingId: 'listing-scenario-2',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:00:00.000Z',
          title: 'Nintendo Switch Concurrent Dedup',
          price: {
            rawText: '$250.000',
            amount: 250000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$250.000'],
            kind: 'TOTAL',
          },
          rawFingerprint: fp,
        },
      };

      const taskB: WorkerTaskPayload = {
        listing: {
          id: 'listing-scenario-2',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-2',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-2',
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:05:00.000Z',
        },
        observation: {
          id: 'obs-scenario-2-b',
          listingId: 'listing-scenario-2',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:05:00.000Z',
          title: 'Nintendo Switch Concurrent Dedup',
          price: {
            rawText: '$250.000',
            amount: 250000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$250.000'],
            kind: 'TOTAL',
          },
          rawFingerprint: fp,
        },
      };

      const [resA, resB] = await runConcurrentWorkers(ctx.databasePath, taskA, taskB);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);

      // One worker inserted (isNewObservation = true), other worker deduplicated (isNewObservation = false)
      const newObsCount = [resA.result?.isNewObservation, resB.result?.isNewObservation].filter(
        Boolean,
      ).length;
      expect(newObsCount).toBe(1);

      // Verify in DB: exactly 1 Observation row exists for this listing and run
      const verifyDb = openSqliteDatabase({ databasePath: ctx.databasePath });
      const obsCount = verifyDb
        .prepare<{ count: number }, [string, string]>(
          'SELECT COUNT(*) as count FROM observations WHERE source_run_id = ? AND raw_fingerprint = ?',
        )
        .get('source-run-conc-shared', fp);

      expect(obsCount?.count).toBe(1);
      verifyDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('Scenario 3: same fallback externalId with different canonicalUrl results in ListingIdentityCollisionError and preserves original', async () => {
    const ctx = createTempDatabaseContext();
    try {
      await setupDatabasePrerequisites(ctx.databasePath);

      const fakeCollidingHasher: Hasher = {
        hash: () => 'identical-fallback-collision-hash',
      };

      const urlA = 'https://synthetic.invalid/listings/item-alpha-scenario3';
      const urlB = 'https://synthetic.invalid/listings/item-beta-scenario3';

      const fallbackIdA = createFallbackExternalId(urlA, fakeCollidingHasher);
      const fallbackIdB = createFallbackExternalId(urlB, fakeCollidingHasher);
      expect(fallbackIdA).toBe(fallbackIdB);

      // Pre-seed listing A so there is a baseline
      const dbPre = openSqliteDatabase({ databasePath: ctx.databasePath });
      dbPre.exec(`
        INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
        VALUES ('listing-orig-scenario3', 'synthetic', '${fallbackIdA}', '${urlA}', '2026-08-30T10:00:00.000Z', '2026-08-30T10:00:00.000Z');
      `);
      dbPre.close();

      // Worker 1 tries recording with URL A (valid matching)
      const taskA: WorkerTaskPayload = {
        listing: {
          id: 'listing-orig-scenario3',
          sourceId: 'synthetic',
          externalId: fallbackIdA,
          canonicalUrl: urlA,
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:00:00.000Z',
        },
        observation: {
          id: 'obs-scenario-3-a',
          listingId: 'listing-orig-scenario3',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:00:00.000Z',
          title: 'Item Alpha',
          rawFingerprint: 'fp-scenario3-a',
        },
      };

      // Worker 2 concurrently tries recording with same fallback ID but URL B (collision!)
      const taskB: WorkerTaskPayload = {
        listing: {
          id: 'listing-attempt-scenario3',
          sourceId: 'synthetic',
          externalId: fallbackIdB,
          canonicalUrl: urlB, // Conflict!
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:05:00.000Z',
        },
        observation: {
          id: 'obs-scenario-3-b',
          listingId: 'listing-attempt-scenario3',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:05:00.000Z',
          title: 'Item Beta Conflicting URL',
          rawFingerprint: 'fp-scenario3-b',
        },
      };

      const [resA, resB] = await runConcurrentWorkers(ctx.databasePath, taskA, taskB);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(false);
      expect(resB.error?.code).toBe('LISTING_IDENTITY_COLLISION');

      // Verify original listing row remains intact with URL A
      const verifyDb = openSqliteDatabase({ databasePath: ctx.databasePath });
      const preserved = verifyDb
        .prepare<{ canonical_url: string }, [string]>(
          'SELECT canonical_url FROM listings WHERE id = ?',
        )
        .get('listing-orig-scenario3');

      expect(preserved?.canonical_url).toBe(urlA);
      verifyDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('Scenario 4: race with differing contents produces consistent history with monotonic firstSeenAt / lastSeenAt', async () => {
    const ctx = createTempDatabaseContext();
    try {
      await setupDatabasePrerequisites(ctx.databasePath);

      const priceA = createResolvedPrice({
        rawText: '$250.000',
        amount: 250000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$250.000'],
      });

      const priceB = createResolvedPrice({
        rawText: '$220.000',
        amount: 220000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 0.9,
        evidence: ['$220.000'],
      });

      const fpA = computeObservationFingerprint(
        { title: 'Nintendo Switch Price 250', price: priceA },
        hasher,
      );

      const fpB = computeObservationFingerprint(
        { title: 'Nintendo Switch Price 220', price: priceB },
        hasher,
      );

      const taskA: WorkerTaskPayload = {
        listing: {
          id: 'listing-scenario-4',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-4',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-4',
          firstSeenAt: '2026-08-30T09:00:00.000Z',
          lastSeenAt: '2026-08-30T09:30:00.000Z',
        },
        observation: {
          id: 'obs-scenario-4-a',
          listingId: 'listing-scenario-4',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T09:30:00.000Z',
          title: 'Nintendo Switch Price 250',
          price: {
            rawText: '$250.000',
            amount: 250000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$250.000'],
            kind: 'TOTAL',
          },
          rawFingerprint: fpA,
        },
      };

      const taskB: WorkerTaskPayload = {
        listing: {
          id: 'listing-scenario-4',
          sourceId: 'synthetic',
          externalId: 'syn-item-scenario-4',
          canonicalUrl: 'https://synthetic.invalid/listings/syn-item-scenario-4',
          firstSeenAt: '2026-08-30T10:00:00.000Z',
          lastSeenAt: '2026-08-30T10:30:00.000Z',
        },
        observation: {
          id: 'obs-scenario-4-b',
          listingId: 'listing-scenario-4',
          sourceRunId: 'source-run-conc-shared',
          observedAt: '2026-08-30T10:30:00.000Z',
          title: 'Nintendo Switch Price 220',
          price: {
            rawText: '$220.000',
            amount: 220000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 0.9,
            evidence: ['$220.000'],
            kind: 'TOTAL',
          },
          rawFingerprint: fpB,
        },
      };

      const [resA, resB] = await runConcurrentWorkers(ctx.databasePath, taskA, taskB);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);

      const verifyDb = openSqliteDatabase({ databasePath: ctx.databasePath });

      // Both observations were persisted into consistent history
      const obsRows = verifyDb
        .prepare<{ id: string; price: string }, [string]>(
          'SELECT id, price FROM observations WHERE listing_id = ? ORDER BY observed_at ASC',
        )
        .all(resA.result!.listingId);

      expect(obsRows).toHaveLength(2);

      // Listing timestamps: monotonic earliest firstSeenAt (09:00:00), monotonic latest lastSeenAt (10:30:00)
      const listingRow = verifyDb
        .prepare<{ first_seen_at: string; last_seen_at: string }, [string]>(
          'SELECT first_seen_at, last_seen_at FROM listings WHERE id = ?',
        )
        .get(resA.result!.listingId);

      expect(listingRow?.first_seen_at).toBe('2026-08-30T09:00:00.000Z');
      expect(listingRow?.last_seen_at).toBe('2026-08-30T10:30:00.000Z');

      verifyDb.close();
    } finally {
      ctx.cleanup();
    }
  });
});
