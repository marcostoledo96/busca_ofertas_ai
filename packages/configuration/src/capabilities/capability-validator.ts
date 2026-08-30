import type { SourceCapabilities } from '@busca-ofertas-ai/adapter-sdk';
import { ConfigurationError } from '../errors/configuration-error.js';
import type { SourceRegistry } from '../registry/source-registry.js';
import type { SavedSearchConfigurationV1, SourceConfigurationV1 } from '../schema/v1/types.js';

export interface RequiredCapabilityRequirement {
  readonly capability: keyof SourceCapabilities;
  readonly reason: string;
}

export const deriveRequiredCapabilities = (
  sourceConfig: SourceConfigurationV1,
  searchConfig: SavedSearchConfigurationV1,
): RequiredCapabilityRequirement[] => {
  const requirements: RequiredCapabilityRequirement[] = [];

  // 1. Textual Search
  if (sourceConfig.queries && sourceConfig.queries.length > 0) {
    requirements.push({
      capability: 'textSearch',
      reason: `Source "${sourceConfig.id}" specifies ${sourceConfig.queries.length} search queries.`,
    });
  }

  // 2. Geographic Radius Search
  if (
    searchConfig.location &&
    (searchConfig.location.mode === 'RADIUS' ||
      (searchConfig.location.radiusKm !== undefined && searchConfig.location.radiusKm > 0))
  ) {
    requirements.push({
      capability: 'geographicSearch',
      reason: `SavedSearch "${searchConfig.id}" specifies geographic radius search (${searchConfig.location.radiusKm ?? ''}km).`,
    });
  }

  // 3. Authentication
  if (sourceConfig.sessionRef && sourceConfig.sessionRef.trim().length > 0) {
    requirements.push({
      capability: 'authentication',
      reason: `Source "${sourceConfig.id}" specifies session reference "${sourceConfig.sessionRef}".`,
    });
  }

  // 4. Pagination
  const maxPages = sourceConfig.options?.['maxPages'];
  if (typeof maxPages === 'number' && maxPages > 1) {
    requirements.push({
      capability: 'pagination',
      reason: `Source "${sourceConfig.id}" specifies maxPages = ${maxPages}.`,
    });
  }

  return requirements;
};

export const validateSearchCapabilities = (
  config: SavedSearchConfigurationV1,
  registry: SourceRegistry,
): void => {
  for (let i = 0; i < config.sources.length; i++) {
    const sourceConfig = config.sources[i];
    if (!sourceConfig || !sourceConfig.enabled) {
      continue;
    }

    const entry = registry.get(sourceConfig.id);
    if (!entry) {
      throw new ConfigurationError({
        code: 'CONFIG_SOURCE_NOT_REGISTERED',
        path: `sources[${i}]`,
        sourceId: sourceConfig.id,
        message: `Source "${sourceConfig.id}" is not registered in the SourceRegistry.`,
        suggestion: `Register adapter "${sourceConfig.id}" in SourceRegistry or disable it in configuration.`,
      });
    }

    if (entry.status === 'DISABLED') {
      throw new ConfigurationError({
        code: 'CONFIG_SOURCE_DISABLED',
        path: `sources[${i}]`,
        sourceId: sourceConfig.id,
        message: `Source "${sourceConfig.id}" is disabled in the registry: ${entry.reason}`,
        suggestion: `Resolve the disabled reason for source "${sourceConfig.id}" ("${entry.reason}") or disable the source in configuration.`,
      });
    }

    const requiredCaps = deriveRequiredCapabilities(sourceConfig, config);
    for (const req of requiredCaps) {
      if (!entry.capabilities[req.capability]) {
        throw new ConfigurationError({
          code: 'CONFIG_CAPABILITY_MISMATCH',
          path: `sources[${i}]`,
          sourceId: sourceConfig.id,
          message: `Source "${sourceConfig.id}" lacks required capability "${req.capability}": ${req.reason}`,
          suggestion: `Enable capability "${req.capability}" on adapter "${sourceConfig.id}" or adjust the search configuration.`,
        });
      }
    }
  }
};
