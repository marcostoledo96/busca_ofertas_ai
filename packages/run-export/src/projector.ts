import {
  type Listing,
  type ListingRepository,
  type ObservationRepository,
  type RunRepository,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
} from '@busca-ofertas-ai/core';
import { RunExportProjectionError } from './errors.js';
import {
  RUN_EXPORT_SCHEMA_VERSION,
  type RunExportLocation,
  type RunExportPrice,
  type RunExportResult,
  type RunExportRun,
  type RunExportSearch,
  type RunExportSnapshot,
  type RunExportSource,
} from './schema.js';

export interface ProjectPersistedRunExportParams {
  readonly runId: string;
  readonly runRepository: RunRepository;
  readonly savedSearchRepository: SavedSearchRepository;
  readonly listingRepository: ListingRepository;
  readonly observationRepository: ObservationRepository;
}

/**
 * Resolves the effective historical SavedSearch revision according to persisted recordedAt.
 *
 * Selection rule:
 * 1. Filter revisions where recordedAt <= runStartedAt.
 * 2. Order by recordedAt DESC, revisionNumber DESC (non-monotonic timestamps handled deterministically).
 * 3. Verify coherence: revision.recordedAt === revision.snapshot.updatedAt.
 *    If incoherent, fail closed with HISTORICAL_REVISION_COHERENCE_ERROR.
 * 4. If no eligible revision exists, fail closed with HISTORICAL_REVISION_NOT_FOUND.
 *    Does NOT fall back to current SavedSearch state.
 */
export function resolveHistoricalSearchRevision(
  revisions: readonly SavedSearchRevisionRecord[],
  runStartedAt: Date,
  runId: string,
  savedSearchId: string,
): SavedSearchRevisionRecord {
  const eligible = revisions.filter((rev) => rev.recordedAt.getTime() <= runStartedAt.getTime());

  if (eligible.length === 0) {
    throw new RunExportProjectionError({
      code: 'HISTORICAL_REVISION_NOT_FOUND',
      message: `No historical search revision found for savedSearchId '${savedSearchId}' at or before run startedAt '${runStartedAt.toISOString()}' (run '${runId}').`,
      runId,
      savedSearchId,
    });
  }

  // Sort by recordedAt DESC, revisionNumber DESC
  const sorted = [...eligible].sort((a, b) => {
    const timeDiff = b.recordedAt.getTime() - a.recordedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.revisionNumber - a.revisionNumber;
  });

  const selected = sorted[0]!;

  // Strict historical revision coherence check:
  // In our persistence architecture, recordedAt is saved as snapshot.updatedAt.
  if (selected.recordedAt.getTime() !== selected.snapshot.updatedAt.getTime()) {
    throw new RunExportProjectionError({
      code: 'HISTORICAL_REVISION_COHERENCE_ERROR',
      message: `Historical revision '${selected.id}' recordedAt ('${selected.recordedAt.toISOString()}') does not match snapshot.updatedAt ('${selected.snapshot.updatedAt.toISOString()}').`,
      runId,
      savedSearchId,
    });
  }

  return selected;
}

/**
 * Infrastructure-agnostic persisted-run projection service.
 *
 * Reads persisted facts strictly through Core repository ports.
 * Free of SQLite driver dependencies, filesystem access, CLI dependencies, or network.
 *
 * Invariant:
 * Does NOT invent business decisions. Since Evaluation, Opportunity, and Feedback
 * are not persisted in SQLite for this issue, evaluation is projected honestly as null,
 * novelty as null, and manualExchangeRate as null.
 */
export async function projectPersistedRunExport(
  params: ProjectPersistedRunExportParams,
): Promise<RunExportSnapshot> {
  const { runId, runRepository, savedSearchRepository, listingRepository, observationRepository } =
    params;

  // 1. Fetch Run
  const run = await runRepository.getById(runId);
  if (!run) {
    throw new RunExportProjectionError({
      code: 'RUN_NOT_FOUND',
      message: `Run with id '${runId}' not found.`,
      runId,
    });
  }

  // 2. Resolve historical SavedSearch revision
  const revisions = await savedSearchRepository.listRevisions(run.savedSearchId);
  const selectedRevision = resolveHistoricalSearchRevision(
    revisions,
    run.startedAt,
    run.id,
    run.savedSearchId,
  );

  // Whitelist-only search metadata (exclude sessionRef, options, rules internals, etc.)
  const searchExport: RunExportSearch = {
    savedSearchId: selectedRevision.savedSearchId,
    revisionNumber: selectedRevision.revisionNumber,
    schemaVersion: selectedRevision.schemaVersion,
    name: selectedRevision.snapshot.name,
    category: selectedRevision.snapshot.category,
  };

  // 3. Map Run
  const runFinishedAt = 'finishedAt' in run && run.finishedAt ? run.finishedAt.toISOString() : null;
  const runError = 'error' in run && run.error ? { code: null, message: run.error } : null;

  const runExport: RunExportRun = {
    id: run.id,
    savedSearchId: run.savedSearchId,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: runFinishedAt,
    error: runError,
  };

  // 4. Source Runs & Metadata
  const sourceRuns = await runRepository.listSourceRunsByRunId(run.id);
  const sourcesExport: RunExportSource[] = [];

  for (const sr of sourceRuns) {
    if (sr.runId !== run.id) {
      throw new RunExportProjectionError({
        code: 'SOURCE_RUN_COHERENCE_ERROR',
        message: `SourceRun '${sr.id}' runId '${sr.runId}' does not match expected runId '${run.id}'.`,
        runId,
        sourceRunId: sr.id,
      });
    }

    const metadata = await runRepository.getSourceRunMetadata(sr.id);
    if (sr.status === 'SUCCESS' || sr.status === 'ZERO_RESULTS_CONFIRMED') {
      if (!metadata || !metadata.adapterVersion) {
        throw new RunExportProjectionError({
          code: 'SOURCE_METADATA_MISSING',
          message: `SourceRun '${sr.id}' with status '${sr.status}' is missing required execution metadata.`,
          runId,
          sourceRunId: sr.id,
        });
      }
    }

    const adapterVersion = metadata?.adapterVersion ?? '0.0.0';
    const collectorId =
      metadata?.collectorId ?? ('collectorId' in sr ? (sr.collectorId ?? null) : null);
    const finishedAt = 'finishedAt' in sr && sr.finishedAt ? sr.finishedAt.toISOString() : null;
    const itemsCount = 'itemsCount' in sr && sr.itemsCount !== undefined ? sr.itemsCount : null;

    const sourceError = 'error' in sr && sr.error ? { code: null, message: sr.error } : null;

    const sourceMetrics = metadata?.metrics
      ? {
          pagesRequested: metadata.metrics.pagesRequested ?? null,
          pagesCompleted: metadata.metrics.pagesCompleted ?? null,
          rawItemsCount: metadata.metrics.rawItemsCount ?? null,
          parsedItemsCount: metadata.metrics.parsedItemsCount ?? null,
          rejectedItemsCount: metadata.metrics.rejectedItemsCount ?? null,
          stopReason: metadata.metrics.stopReason ?? null,
        }
      : null;

    sourcesExport.push({
      sourceRunId: sr.id,
      sourceId: sr.sourceId,
      collectorId,
      adapterVersion,
      status: sr.status,
      startedAt: sr.startedAt.toISOString(),
      finishedAt,
      itemsCount,
      metrics: sourceMetrics,
      error: sourceError,
    });
  }

  // 5. Observations & Listings (with scoped per-invocation cache)
  const listingCache = new Map<string, Listing | null>();
  const resultsExport: RunExportResult[] = [];

  for (const sr of sourceRuns) {
    const observations = await observationRepository.listBySourceRunId(sr.id);

    for (const obs of observations) {
      let listing = listingCache.get(obs.listingId);
      if (listing === undefined) {
        listing = await listingRepository.getById(obs.listingId);
        listingCache.set(obs.listingId, listing);
      }

      if (listing === null) {
        throw new RunExportProjectionError({
          code: 'LISTING_NOT_FOUND',
          message: `Listing with id '${obs.listingId}' not found for observation '${obs.id}'.`,
          runId,
          sourceRunId: sr.id,
          listingId: obs.listingId,
        });
      }

      if (listing.sourceId !== sr.sourceId) {
        throw new RunExportProjectionError({
          code: 'LISTING_SOURCE_MISMATCH',
          message: `Listing '${listing.id}' sourceId '${listing.sourceId}' does not match sourceRun '${sr.id}' sourceId '${sr.sourceId}'.`,
          runId,
          sourceRunId: sr.id,
          listingId: listing.id,
        });
      }

      let priceExport: RunExportPrice | null = null;
      if (obs.price) {
        priceExport = {
          rawText: obs.price.rawText,
          amount: obs.price.amount,
          currency: obs.price.currency,
          resolution: obs.price.resolution,
          confidence: obs.price.confidence,
          evidence: [...obs.price.evidence],
          kind: obs.price.kind,
          converted: obs.price.converted
            ? {
                amount: obs.price.converted.amount,
                currency: 'ARS',
                exchangeRate: obs.price.converted.exchangeRate,
                exchangeRateOrigin: 'MANUAL',
                convertedAt: obs.price.converted.convertedAt.toISOString(),
              }
            : null,
        };
      }

      let locationExport: RunExportLocation | null = null;
      if (obs.location) {
        locationExport = {
          rawText: obs.location.rawText,
          region: obs.location.region ?? null,
          city: obs.location.city ?? null,
          neighborhood: obs.location.neighborhood ?? null,
          latitude: obs.location.coordinates?.latitude ?? null,
          longitude: obs.location.coordinates?.longitude ?? null,
        };
      }

      resultsExport.push({
        listingId: listing.id,
        observationId: obs.id,
        sourceRunId: sr.id,
        sourceId: sr.sourceId,
        externalId: listing.externalId,
        canonicalUrl: listing.canonicalUrl,
        observedAt: obs.observedAt.toISOString(),
        publishedAt: obs.publishedAt ? obs.publishedAt.toISOString() : null,
        title: obs.title,
        description: obs.description,
        condition: obs.condition,
        availability: obs.availability,
        imageUrls: [...obs.imageUrls],
        rawFingerprint: obs.rawFingerprint,
        price: priceExport,
        location: locationExport,
        novelty: null, // Honest null: novelty is not persisted as a dedicated column
        evaluation: null, // Honest null: evaluations are not persisted in SQLite MVP
      });
    }
  }

  return {
    schemaVersion: RUN_EXPORT_SCHEMA_VERSION,
    run: runExport,
    search: searchExport,
    manualExchangeRate: null, // Honest null: no authoritative manual exchange rate persisted
    sources: sourcesExport,
    results: resultsExport,
  };
}
