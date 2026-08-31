import { describe, it, expect } from 'vitest';
import { createDefaultSourceRegistry } from '@busca-ofertas-ai/cli';
import {
  validateSearchCapabilities,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';
import {
  SyntheticAdapter,
  SYNTHETIC_ADAPTER_CAPABILITIES,
  SYNTHETIC_ADAPTER_ID,
  SYNTHETIC_ADAPTER_SDK_VERSION,
  SYNTHETIC_ADAPTER_VERSION,
} from '@busca-ofertas-ai/adapter-synthetic';

describe('Synthetic Source Registry Integration & Wizard Visibility (BOAI-009)', () => {
  it('pre-registers SyntheticAdapter in createDefaultSourceRegistry() with ENABLED status', () => {
    const registry = createDefaultSourceRegistry();
    expect(registry.has('synthetic')).toBe(true);

    const entry = registry.getOrThrow('synthetic');
    expect(entry.id).toBe(SYNTHETIC_ADAPTER_ID);
    expect(entry.version).toBe(SYNTHETIC_ADAPTER_VERSION);
    expect(entry.sdkVersion).toBe(SYNTHETIC_ADAPTER_SDK_VERSION);
    expect(entry.capabilities).toEqual(SYNTHETIC_ADAPTER_CAPABILITIES);
    expect(entry.status).toBe('ENABLED');
  });

  it('produces a fully coherent SyntheticAdapter instance via registry factory', () => {
    const registry = createDefaultSourceRegistry();
    const adapter = registry.createAdapter('synthetic');

    expect(adapter).toBeInstanceOf(SyntheticAdapter);
    expect(adapter.id).toBe('synthetic');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.capabilities).toEqual(SYNTHETIC_ADAPTER_CAPABILITIES);
  });

  it('makes synthetic source visible to wizard and configuration discovery', () => {
    const registry = createDefaultSourceRegistry();
    const allSources = registry.list();

    expect(allSources.some((s) => s.id === 'synthetic' && s.status === 'ENABLED')).toBe(true);
  });

  it('passes capability cross-validation against a SavedSearch targeting synthetic source', () => {
    const registry = createDefaultSourceRegistry();
    const config: SavedSearchConfigurationV1 = {
      schemaVersion: 1,
      id: 'test-synthetic-config',
      name: 'Test Synthetic Search',
      enabled: true,
      category: 'PRODUCT',
      sources: [
        {
          id: 'synthetic',
          enabled: true,
          queries: ['Nintendo Switch Lite'],
          options: { maxPages: 2, maxItems: 20 },
        },
      ],
      evaluation: { matchThreshold: 80, reviewThreshold: 40 },
      ai: {
        enabled: false,
        evaluateOnlyReview: true,
        requireConfirmation: true,
        maxEvaluationsPerRun: 5,
      },
      retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
    };

    expect(() => validateSearchCapabilities(config, registry)).not.toThrow();
  });
});
