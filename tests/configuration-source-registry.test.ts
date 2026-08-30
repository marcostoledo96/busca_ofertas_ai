import { describe, it, expect, vi } from 'vitest';
import {
  ADAPTER_SDK_VERSION,
  createSourceDiagnostics,
  createZeroResultsConfirmedSearchResult,
  type SourceAdapter,
  type SourceCapabilities,
} from '@busca-ofertas-ai/adapter-sdk';
import { SourceRegistry, ConfigurationError } from '@busca-ofertas-ai/configuration';

describe('Source Registry and Adapter Lifecycle Invariants (BOAI-004)', () => {
  const createMockCapabilities = (overrides?: Partial<SourceCapabilities>): SourceCapabilities => ({
    textSearch: true,
    exactUrlWatch: false,
    listingDetails: false,
    authentication: false,
    pagination: true,
    geographicSearch: false,
    priceAndCurrency: true,
    stock: false,
    advertisedDiscount: false,
    ...overrides,
  });

  const createMockAdapter = (overrides?: Partial<SourceAdapter>): SourceAdapter => ({
    id: 'mock-source',
    version: '1.0.0',
    sdkVersion: ADAPTER_SDK_VERSION,
    capabilities: createMockCapabilities(),
    initialize: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      sourceId: 'mock-source',
      status: 'HEALTHY' as const,
      checkedAt: new Date(),
      evidence: [],
    }),
    search: vi.fn().mockResolvedValue(
      createZeroResultsConfirmedSearchResult({
        sourceId: 'mock-source',
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
    ...overrides,
  });

  it('registers enabled source adapter with lazy factory', () => {
    const registry = new SourceRegistry();
    const factorySpy = vi.fn(() => createMockAdapter());

    registry.register({
      id: 'mock-source',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: createMockCapabilities(),
      status: 'ENABLED',
      factory: factorySpy,
    });

    expect(registry.has('mock-source')).toBe(true);
    expect(factorySpy).not.toHaveBeenCalled(); // Lazy factory invariant

    const entry = registry.getOrThrow('mock-source');
    expect(entry.id).toBe('mock-source');
    expect(entry.status).toBe('ENABLED');

    const adapterInstance = registry.createAdapter('mock-source');
    expect(factorySpy).toHaveBeenCalledTimes(1);
    expect(adapterInstance.id).toBe('mock-source');
  });

  it('registers disabled source adapter with mandatory reason', () => {
    const registry = new SourceRegistry();

    registry.register({
      id: 'facebook-marketplace-disabled',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: createMockCapabilities(),
      status: 'DISABLED',
      reason: 'Requires manual 2FA session re-authentication in local browser.',
    });

    const entry = registry.getOrThrow('facebook-marketplace-disabled');
    expect(entry.status).toBe('DISABLED');
    if (entry.status === 'DISABLED') {
      expect(entry.reason).toContain('Requires manual 2FA');
    }

    try {
      registry.createAdapter('facebook-marketplace-disabled');
      expect.unreachable('Should have thrown CONFIG_SOURCE_DISABLED');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_SOURCE_DISABLED');
      expect(configErr.sourceId).toBe('facebook-marketplace-disabled');
      expect(configErr.message).toContain('Requires manual 2FA');
    }
  });

  it('rejects disabled source registration without reason with REGISTRY_INVALID_ENTRY', () => {
    const registry = new SourceRegistry();

    try {
      registry.register({
        id: 'bad-disabled-source',
        version: '1.0.0',
        sdkVersion: ADAPTER_SDK_VERSION,
        capabilities: createMockCapabilities(),
        status: 'DISABLED',
        reason: '   ',
      });
      expect.unreachable('Should have rejected empty reason');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('REGISTRY_INVALID_ENTRY');
    }
  });

  it('rejects duplicate source ID registration with REGISTRY_DUPLICATE_SOURCE', () => {
    const registry = new SourceRegistry();

    registry.register({
      id: 'unique-source',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: createMockCapabilities(),
      status: 'ENABLED',
      factory: () => createMockAdapter({ id: 'unique-source' }),
    });

    try {
      registry.register({
        id: 'unique-source',
        version: '1.0.1',
        sdkVersion: ADAPTER_SDK_VERSION,
        capabilities: createMockCapabilities(),
        status: 'ENABLED',
        factory: () => createMockAdapter({ id: 'unique-source' }),
      });
      expect.unreachable('Should have rejected duplicate source ID');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('REGISTRY_DUPLICATE_SOURCE');
      expect(configErr.sourceId).toBe('unique-source');
    }
  });

  it('rejects incompatible SDK version with REGISTRY_INCOMPATIBLE_SDK', () => {
    const registry = new SourceRegistry();

    try {
      registry.register({
        id: 'legacy-source',
        version: '1.0.0',
        sdkVersion: '99.0.0',
        capabilities: createMockCapabilities(),
        status: 'ENABLED',
        factory: () => createMockAdapter({ id: 'legacy-source' }),
      });
      expect.unreachable('Should have rejected incompatible SDK version');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('REGISTRY_INCOMPATIBLE_SDK');
      expect(configErr.sourceId).toBe('legacy-source');
    }
  });

  it('throws CONFIG_SOURCE_NOT_REGISTERED for unknown source queries', () => {
    const registry = new SourceRegistry();

    expect(registry.has('unknown-source')).toBe(false);
    expect(registry.get('unknown-source')).toBeUndefined();

    try {
      registry.getOrThrow('unknown-source');
      expect.unreachable('Should have thrown CONFIG_SOURCE_NOT_REGISTERED');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_SOURCE_NOT_REGISTERED');
      expect(configErr.sourceId).toBe('unknown-source');
    }
  });

  it('validates factory coherence against registered descriptor upon creation', () => {
    const registry = new SourceRegistry();

    // Mismatched ID produced by factory
    registry.register({
      id: 'declared-id',
      version: '1.0.0',
      sdkVersion: ADAPTER_SDK_VERSION,
      capabilities: createMockCapabilities(),
      status: 'ENABLED',
      factory: () => createMockAdapter({ id: 'different-runtime-id' }),
    });

    try {
      registry.createAdapter('declared-id');
      expect.unreachable('Should have rejected factory ID mismatch');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('REGISTRY_FACTORY_MISMATCH');
    }
  });
});
