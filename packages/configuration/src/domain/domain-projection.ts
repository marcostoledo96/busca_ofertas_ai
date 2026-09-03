import {
  createSavedSearch,
  type Clock,
  type RuleExpression,
  type SavedSearch,
  type SourceSearchConfig,
} from '@busca-ofertas-ai/core';
import { ConfigurationError } from '../errors/configuration-error.js';
import type { SavedSearchConfigurationV1 } from '../schema/v1/types.js';

export interface ToDomainSavedSearchOptions {
  readonly clock?: Clock | undefined;
  readonly createdAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

export const toDomainSavedSearch = (
  config: SavedSearchConfigurationV1,
  options?: ToDomainSavedSearchOptions,
): SavedSearch => {
  let createdAt: Date;
  let updatedAt: Date;

  if (options?.clock) {
    const now = options.clock.now();
    createdAt = options.createdAt ?? now;
    updatedAt = options.updatedAt ?? now;
  } else if (options?.createdAt && options?.updatedAt) {
    createdAt = options.createdAt;
    updatedAt = options.updatedAt;
  } else {
    throw new ConfigurationError({
      code: 'CONFIG_INVARIANT_VIOLATION',
      path: 'toDomainSavedSearch',
      message:
        'toDomainSavedSearch requires an injected Clock or explicit createdAt and updatedAt timestamps.',
      suggestion:
        'Provide a Clock instance (e.g. from createFakeClock or SystemClock) or explicit Date timestamps.',
    });
  }

  // Extract all distinct terms across sources
  const termsSet = new Set<string>();
  for (const src of config.sources) {
    for (const q of src.queries) {
      if (q.trim().length > 0) {
        termsSet.add(q.trim());
      }
    }
  }

  const terms = Array.from(termsSet);
  const excludedTerms = config.rules?.exclude ? [...config.rules.exclude] : [];

  const sourceConfigs: SourceSearchConfig[] = config.sources.map((s) => ({
    id: s.id,
    enabled: s.enabled,
    queries: [...s.queries],
    ...(s.options !== undefined ? { options: s.options } : {}),
    ...(s.sessionRef !== undefined ? { sessionRef: s.sessionRef } : {}),
  }));

  const rules: RuleExpression[] = [];
  if (config.rules?.profile) {
    rules.push({
      id: 'rule-profile',
      type: 'PROFILE',
      params: { profile: config.rules.profile },
    });
  }
  if (config.rules?.include && config.rules.include.length > 0) {
    rules.push({
      id: 'rule-include',
      type: 'INCLUDE_TERMS',
      params: { terms: [...config.rules.include] },
    });
  }
  if (config.rules?.exclude && config.rules.exclude.length > 0) {
    rules.push({
      id: 'rule-exclude',
      type: 'EXCLUDE_TERMS',
      params: { terms: [...config.rules.exclude] },
    });
  }
  if (config.product) {
    rules.push({
      id: 'rule-product',
      type: 'PRODUCT_REQUIREMENTS',
      params: { ...config.product },
    });
  }

  return createSavedSearch({
    id: config.id,
    schemaVersion: config.schemaVersion,
    name: config.name,
    enabled: config.enabled,
    category: config.category,
    sourceConfigs,
    query: {
      terms,
      ...(excludedTerms.length > 0 ? { excludedTerms } : {}),
    },
    price: config.price
      ? {
          targetCurrency: config.price.targetCurrency,
          maximum: config.price.maximum ?? null,
          minimumPlausible: config.price.minimumPlausible ?? null,
          ...(config.price.foreignCurrency !== undefined
            ? { foreignCurrency: { ...config.price.foreignCurrency } }
            : {}),
        }
      : null,
    location: config.location
      ? {
          mode: config.location.mode,
          ...(config.location.region !== undefined ? { region: config.location.region } : {}),
          ...(config.location.radiusKm !== undefined ? { radiusKm: config.location.radiusKm } : {}),
          ...(config.location.coordinates !== undefined
            ? { coordinates: { ...config.location.coordinates } }
            : {}),
        }
      : null,
    condition: config.condition ? { accepted: config.condition.accepted } : null,
    rules,
    evaluation: {
      matchThreshold: config.evaluation.matchThreshold,
      reviewThreshold: config.evaluation.reviewThreshold,
      ...(config.evaluation.precisionProfile !== undefined
        ? { precisionProfile: config.evaluation.precisionProfile }
        : {}),
    },
    ai: {
      enabled: config.ai.enabled,
      evaluateOnlyReview: config.ai.evaluateOnlyReview,
      ...(config.ai.provider !== undefined ? { provider: config.ai.provider } : {}),
      requireConfirmation: config.ai.requireConfirmation,
      maxEvaluationsPerRun: config.ai.maxEvaluationsPerRun,
    },
    retention: {
      rawArtifacts:
        config.retention.rawArtifacts === 'ALL' ? 'ALL_LIMITED' : config.retention.rawArtifacts,
      rawDataDays: config.retention.rawDataDays,
    },
    createdAt,
    updatedAt,
  });
};
