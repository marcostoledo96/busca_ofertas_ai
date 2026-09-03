import { type RunExportSnapshot } from './schema.js';
import { sortResults, sortSources } from './sort.js';
import { validateRunExportSnapshot } from './validation.js';

export function serializeJson(snapshot: RunExportSnapshot): string {
  validateRunExportSnapshot(snapshot);

  const sortedSources = sortSources(snapshot.sources);
  const sortedResults = sortResults(snapshot.results);

  const orderedRun = {
    id: snapshot.run.id,
    savedSearchId: snapshot.run.savedSearchId,
    status: snapshot.run.status,
    startedAt: snapshot.run.startedAt,
    finishedAt: snapshot.run.finishedAt,
    error: snapshot.run.error
      ? {
          code: snapshot.run.error.code,
          message: snapshot.run.error.message,
        }
      : null,
  };

  const orderedSearch = {
    savedSearchId: snapshot.search.savedSearchId,
    revisionNumber: snapshot.search.revisionNumber,
    schemaVersion: snapshot.search.schemaVersion,
    name: snapshot.search.name,
    category: snapshot.search.category,
  };

  const orderedSources = sortedSources.map((src) => ({
    sourceRunId: src.sourceRunId,
    sourceId: src.sourceId,
    collectorId: src.collectorId,
    adapterVersion: src.adapterVersion,
    status: src.status,
    startedAt: src.startedAt,
    finishedAt: src.finishedAt,
    itemsCount: src.itemsCount,
    metrics: src.metrics
      ? {
          pagesRequested: src.metrics.pagesRequested,
          pagesCompleted: src.metrics.pagesCompleted,
          rawItemsCount: src.metrics.rawItemsCount,
          parsedItemsCount: src.metrics.parsedItemsCount,
          rejectedItemsCount: src.metrics.rejectedItemsCount,
          stopReason: src.metrics.stopReason,
        }
      : null,
    error: src.error
      ? {
          code: src.error.code,
          message: src.error.message,
        }
      : null,
  }));

  const orderedResults = sortedResults.map((res) => ({
    listingId: res.listingId,
    observationId: res.observationId,
    sourceRunId: res.sourceRunId,
    sourceId: res.sourceId,
    externalId: res.externalId,
    canonicalUrl: res.canonicalUrl,
    observedAt: res.observedAt,
    publishedAt: res.publishedAt,
    title: res.title,
    description: res.description,
    condition: res.condition,
    availability: res.availability,
    imageUrls: [...res.imageUrls],
    rawFingerprint: res.rawFingerprint,
    price: res.price
      ? {
          rawText: res.price.rawText,
          amount: res.price.amount,
          currency: res.price.currency,
          resolution: res.price.resolution,
          confidence: res.price.confidence,
          evidence: [...res.price.evidence],
          kind: res.price.kind,
          converted: res.price.converted
            ? {
                amount: res.price.converted.amount,
                currency: res.price.converted.currency,
                exchangeRate: res.price.converted.exchangeRate,
                exchangeRateOrigin: res.price.converted.exchangeRateOrigin,
                convertedAt: res.price.converted.convertedAt,
              }
            : null,
        }
      : null,
    location: res.location
      ? {
          rawText: res.location.rawText,
          region: res.location.region,
          city: res.location.city,
          neighborhood: res.location.neighborhood,
          latitude: res.location.latitude,
          longitude: res.location.longitude,
        }
      : null,
    novelty: res.novelty,
    evaluation: res.evaluation
      ? {
          decision: res.evaluation.decision,
          score: res.evaluation.score,
          reasons: res.evaluation.reasons.map((r) => ({
            code: r.code,
            message: r.message,
            impact: r.impact,
            severity: r.severity,
            ...(r.evidence !== undefined ? { evidence: r.evidence } : {}),
          })),
          evaluatedBy: [...res.evaluation.evaluatedBy],
          policyVersion: res.evaluation.policyVersion,
          createdAt: res.evaluation.createdAt,
        }
      : null,
  }));

  const root = {
    schemaVersion: snapshot.schemaVersion,
    run: orderedRun,
    search: orderedSearch,
    manualExchangeRate: snapshot.manualExchangeRate,
    sources: orderedSources,
    results: orderedResults,
  };

  return JSON.stringify(root, null, 2) + '\n';
}
