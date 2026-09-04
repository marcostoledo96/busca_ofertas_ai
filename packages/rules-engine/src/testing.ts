import {
  type Listing,
  type Observation,
  type SavedSearch,
  createListing,
  createObservation,
  createSavedSearch,
  createResolvedPrice,
} from '@busca-ofertas-ai/core';
import { type RuleEvaluationContext, createRuleEvaluationContext } from './domain/context.js';
import { type Rule } from './domain/rule.js';
import { type RuleResult, createRuleResult } from './domain/rule-result.js';

export interface CreateMockEvaluationContextOverrides {
  readonly listingOverrides?: Partial<Listing>;
  readonly observationOverrides?: Partial<Observation>;
  readonly savedSearchOverrides?: Partial<SavedSearch>;
}

export const createMockRuleEvaluationContext = (
  overrides?: CreateMockEvaluationContextOverrides,
): RuleEvaluationContext => {
  const listingId = overrides?.listingOverrides?.id ?? 'listing_test_1';
  const sourceId = overrides?.listingOverrides?.sourceId ?? 'test_source';
  const externalId = overrides?.listingOverrides?.externalId ?? 'ext_123';
  const canonicalUrl = overrides?.listingOverrides?.canonicalUrl ?? 'https://example.com/item/123';

  const listing: Listing = createListing({
    id: listingId,
    sourceId,
    externalId,
    canonicalUrl,
    firstSeenAt: new Date(1000),
    lastSeenAt: new Date(2000),
    ...overrides?.listingOverrides,
  });

  const price = createResolvedPrice({
    rawText: '$150000',
    amount: 150000,
    currency: 'ARS',
    resolution: 'EXPLICIT',
    confidence: 1,
    evidence: ['test price'],
  });

  const observation: Observation = createObservation({
    id: overrides?.observationOverrides?.id ?? 'obs_test_1',
    listingId,
    sourceRunId: 'source_run_test_1',
    observedAt: new Date(2000),
    title: 'Producto de prueba en excelente estado',
    description: 'Descripción detallada del producto de prueba con accesorios.',
    price,
    location: {
      rawText: 'Capital Federal, Argentina',
      region: 'AMBA',
      city: 'CABA',
    },
    condition: 'LIKE_NEW',
    availability: 'AVAILABLE',
    imageUrls: ['https://example.com/img1.jpg'],
    publishedAt: new Date(1000),
    rawFingerprint: 'canonical_raw_fingerprint_test',
    ...overrides?.observationOverrides,
  });

  const savedSearch: SavedSearch = createSavedSearch({
    id: overrides?.savedSearchOverrides?.id ?? 'search_test_1',
    schemaVersion: 1,
    name: 'Búsqueda de prueba',
    enabled: true,
    category: 'PRODUCT',
    sourceConfigs: [
      {
        id: sourceId,
        enabled: true,
        queries: ['producto de prueba'],
      },
    ],
    query: {
      terms: ['producto'],
      excludedTerms: ['roto', 'repuesto', 'bloqueado'],
    },
    price: {
      targetCurrency: 'ARS',
      maximum: 200000,
      minimumPlausible: 50000,
    },
    condition: {
      accepted: ['NEW', 'LIKE_NEW', 'GOOD'],
    },
    evaluation: {
      matchThreshold: 80,
      reviewThreshold: 40,
      precisionProfile: 'MIXED',
    },
    ai: {
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 5,
    },
    retention: {
      rawArtifacts: 'ERRORS_AND_REVIEW',
      rawDataDays: 30,
    },
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    ...overrides?.savedSearchOverrides,
  });

  return createRuleEvaluationContext({
    listing,
    observation,
    savedSearch,
  });
};

export const createMockRule = (id: string, result: Partial<RuleResult>): Rule => {
  return {
    id,
    name: `Mock Rule ${id}`,
    evaluate: () =>
      createRuleResult({
        ruleId: id,
        triggered: result.triggered ?? true,
        impact: result.impact ?? 0,
        severity: result.severity ?? 'INFO',
        reasons: result.reasons ?? [],
      }),
  };
};
