import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ADAPTER_SDK_VERSION,
  createSourceDiagnostics,
  createZeroResultsConfirmedSearchResult,
  type SourceAdapter,
  type SourceCapabilities,
} from '@busca-ofertas-ai/adapter-sdk';
import {
  parseSavedSearchYaml,
  validateSearchCapabilities,
  deriveRequiredCapabilities,
  SourceRegistry,
  ConfigurationError,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';

describe('Configuration Capability Cross-Validation (BOAI-004)', () => {
  const createMockAdapter = (id: string, capabilities: SourceCapabilities): SourceAdapter => ({
    id,
    version: '1.0.0',
    sdkVersion: ADAPTER_SDK_VERSION,
    capabilities,
    initialize: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      sourceId: id,
      status: 'HEALTHY' as const,
      checkedAt: new Date(),
      evidence: [],
    }),
    search: vi.fn().mockResolvedValue(
      createZeroResultsConfirmedSearchResult({
        sourceId: id,
        pagesRead: 1,
        hasMore: false,
        diagnostics: createSourceDiagnostics({
          pagesRequested: 1,
          pagesCompleted: 1,
          rawItemsCount: 0,
          parsedItemsCount: 0,
          rejectedItemsCount: 0,
          stopReason: 'ALL_PAGES_FETCHED',
          warnings: [],
        }),
      }),
    ),
    dispose: vi.fn().mockResolvedValue(undefined),
  });

  const baseConfig: SavedSearchConfigurationV1 = {
    schemaVersion: 1,
    id: 'test-search',
    name: 'Capability Test Search',
    enabled: true,
    category: 'PRODUCT',
    sources: [
      {
        id: 'fb-adapter',
        enabled: true,
        queries: ['Nintendo Switch Lite'],
        options: { maxPages: 3 },
      },
    ],
    location: {
      mode: 'RADIUS',
      region: 'AMBA',
      radiusKm: 80,
    },
    evaluation: {
      matchThreshold: 80,
      reviewThreshold: 40,
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
  };

  it('derives required capabilities from search and source configuration', () => {
    const sourceCfg = baseConfig.sources[0]!;
    const requirements = deriveRequiredCapabilities(sourceCfg, baseConfig);

    const requiredKeys = requirements.map((r) => r.capability);
    expect(requiredKeys).toContain('textSearch');
    expect(requiredKeys).toContain('geographicSearch');
    expect(requiredKeys).toContain('pagination');
  });

  it('validates capabilities successfully when adapter satisfies all requirements', () => {
    const registry = new SourceRegistry();
    const capabilities: SourceCapabilities = {
      textSearch: true,
      exactUrlWatch: false,
      listingDetails: false,
      authentication: false,
      pagination: true,
      geographicSearch: true,
      priceAndCurrency: false,
      stock: false,
      advertisedDiscount: false,
    };

    registry.register({
      id: 'fb-adapter',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities,
      status: 'ENABLED',
      factory: () => createMockAdapter('fb-adapter', capabilities),
    });

    expect(() => validateSearchCapabilities(baseConfig, registry)).not.toThrow();
  });

  it('throws CONFIG_CAPABILITY_MISMATCH when adapter lacks required capability', () => {
    const registry = new SourceRegistry();
    const capabilitiesWithoutGeo: SourceCapabilities = {
      textSearch: true,
      exactUrlWatch: false,
      listingDetails: false,
      authentication: false,
      pagination: true,
      geographicSearch: false, // Missing required geographic search
      priceAndCurrency: false,
      stock: false,
      advertisedDiscount: false,
    };

    registry.register({
      id: 'fb-adapter',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: capabilitiesWithoutGeo,
      status: 'ENABLED',
      factory: () => createMockAdapter('fb-adapter', capabilitiesWithoutGeo),
    });

    try {
      validateSearchCapabilities(baseConfig, registry);
      expect.unreachable('Should have thrown CONFIG_CAPABILITY_MISMATCH');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_CAPABILITY_MISMATCH');
      expect(configErr.sourceId).toBe('fb-adapter');
      expect(configErr.message).toContain('geographicSearch');
    }
  });

  it('throws CONFIG_SOURCE_DISABLED when configured source is disabled in registry', () => {
    const registry = new SourceRegistry();
    registry.register({
      id: 'fb-adapter',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: {
        textSearch: true,
        exactUrlWatch: false,
        listingDetails: false,
        authentication: false,
        pagination: true,
        geographicSearch: true,
        priceAndCurrency: false,
        stock: false,
        advertisedDiscount: false,
      },
      status: 'DISABLED',
      reason: 'Temporary maintenance',
    });

    try {
      validateSearchCapabilities(baseConfig, registry);
      expect.unreachable('Should have thrown CONFIG_SOURCE_DISABLED');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_SOURCE_DISABLED');
      expect(configErr.sourceId).toBe('fb-adapter');
      expect(configErr.message).toContain('Temporary maintenance');
    }
  });

  it('validates example config/searches/switch-lite-amba.example.yml with a compatible fake adapter', () => {
    const examplePath = path.resolve(__dirname, '../config/searches/switch-lite-amba.example.yml');
    const content = fs.readFileSync(examplePath, 'utf8');
    const config = parseSavedSearchYaml(content);

    const registry = new SourceRegistry();
    const fbCapabilities: SourceCapabilities = {
      textSearch: true,
      exactUrlWatch: false,
      listingDetails: false,
      authentication: false,
      pagination: true,
      geographicSearch: true,
      priceAndCurrency: true,
      stock: false,
      advertisedDiscount: false,
    };

    registry.register({
      id: 'facebook-marketplace',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: fbCapabilities,
      status: 'ENABLED',
      factory: () => createMockAdapter('facebook-marketplace', fbCapabilities),
    });

    expect(() => validateSearchCapabilities(config, registry)).not.toThrow();
  });
});
