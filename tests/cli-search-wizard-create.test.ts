import { describe, it, expect, beforeEach } from 'vitest';
import {
  SourceRegistry,
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
} from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  CreateSearchWizard,
} from '@busca-ofertas-ai/cli';
import {
  ADAPTER_SDK_VERSION,
  createSourceDiagnostics,
  createZeroResultsConfirmedSearchResult,
  type SourceAdapter,
  type SourceCapabilities,
} from '@busca-ofertas-ai/adapter-sdk';

function createMockAdapter(id: string, capabilities: SourceCapabilities): SourceAdapter {
  return {
    id,
    version: '1.0.0',
    sdkVersion: ADAPTER_SDK_VERSION,
    capabilities,
    initialize: () => Promise.resolve(),
    healthCheck: () =>
      Promise.resolve({
        sourceId: id,
        status: 'HEALTHY',
        checkedAt: new Date(),
        evidence: [],
      }),
    search: () =>
      Promise.resolve(
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
    dispose: () => Promise.resolve(),
  };
}

describe('CLI Search Wizard — Create Search (BOAI-007)', () => {
  let terminal: FakeTerminal;
  let registry: SourceRegistry;
  let store: InMemorySavedSearchConfigStore;
  let abortController: AbortController;

  const defaultCaps: SourceCapabilities = {
    textSearch: true,
    exactUrlWatch: false,
    listingDetails: true,
    authentication: false,
    pagination: true,
    geographicSearch: true,
    priceAndCurrency: true,
    stock: false,
    advertisedDiscount: false,
  };

  beforeEach(() => {
    terminal = new FakeTerminal();
    registry = new SourceRegistry();
    store = new InMemorySavedSearchConfigStore('/test/searches');
    abortController = new AbortController();
  });

  it('ACCEPTANCE CRITERION: creates a complete synthetic search configuration in simple mode without writing code', async () => {
    // Register test-only fake adapter
    registry.register({
      id: 'synthetic',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('synthetic', defaultCaps),
    });

    // Inputs:
    // 1. Mode: 1 (Simple)
    // 2. ID: switch-lite-synthetic
    // 3. Name: Nintendo Switch Lite Synthetic
    // 4. Enabled: Enter (default true)
    // 5. Category: 1 (PRODUCT)
    // 6. Source selection: 1 (synthetic)
    // 7. Queries: "Nintendo Switch Lite", "Switch Lite", "" (empty to finish)
    // 8. Location: s (yes), Region: "AMBA"
    // 9. Target Currency: 1 (ARS)
    // 10. Max Price: 250000
    // 11. Conditions: 1, 2, 3 (NEW, LIKE_NEW, GOOD)
    // 12. Save confirmation: s (yes)
    terminal.enqueueInput(
      '1', // Modo Simple
      'switch-lite-synthetic', // ID
      'Nintendo Switch Lite Synthetic', // Name
      '', // Enabled (default true)
      '1', // Category PRODUCT
      '1', // Source synthetic
      'Nintendo Switch Lite', // Query 1
      'Switch Lite', // Query 2
      '', // Finish queries
      's', // Wants location
      'AMBA', // Region
      's', // Wants price limits
      '1', // Currency ARS
      '250000', // Max Price
      's', // Wants condition filter
      '1, 2, 3', // Conditions
      's', // Confirm save
    );

    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    // Verify stored configuration
    expect(await store.exists('switch-lite-synthetic')).toBe(true);
    const rawYaml = await store.read('switch-lite-synthetic');
    expect(rawYaml).not.toBeNull();

    const config = validateSavedSearchConfiguration(
      JSON.parse(JSON.stringify(rawYaml ? (await import('yaml')).parse(rawYaml) : {})),
    );
    expect(config.id).toBe('switch-lite-synthetic');
    expect(config.name).toBe('Nintendo Switch Lite Synthetic');
    expect(config.enabled).toBe(true);
    expect(config.category).toBe('PRODUCT');
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.id).toBe('synthetic');
    expect(config.sources[0]?.queries).toEqual(['Nintendo Switch Lite', 'Switch Lite']);
    expect(config.location?.region).toBe('AMBA');
    expect(config.price?.targetCurrency).toBe('ARS');
    expect(config.price?.maximum).toBe(250000);
    expect(config.condition?.accepted).toEqual(['NEW', 'LIKE_NEW', 'GOOD']);

    // Finding 2 verification: product, rules, and report must be undefined in simple mode
    expect(config.product).toBeUndefined();
    expect(config.rules).toBeUndefined();
    expect(config.report).toBeUndefined();

    // Verify two-layer validation succeeds
    expect(() => validateSearchCapabilities(config, registry)).not.toThrow();

    const output = terminal.getRawOutput();
    expect(output).toContain('Búsqueda "switch-lite-synthetic" creada y guardada exitosamente');
  });

  it('creates search in advanced mode configuring evaluation thresholds, precision, rules, and AI', async () => {
    registry.register({
      id: 'synthetic',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('synthetic', defaultCaps),
    });

    terminal.enqueueInput(
      '2', // Modo Avanzado
      'advanced-switch', // ID
      'Advanced Search', // Name
      's', // Enabled
      '1', // PRODUCT
      '1', // Source synthetic
      'Switch OLED', // Query 1
      '', // Finish queries
      '5', // maxPages
      's', // Wants location
      '1', // REGION
      'CABA', // Region
      '30', // RadiusKm
      's', // Wants price
      '1', // Currency ARS
      '350000', // Max Price
      '200000', // Min Plausible Price
      's', // Foreign policy
      '1', // MANUAL_RATE
      '1', // REVIEW
      's', // Wants condition
      '1, 2', // Conditions: NEW, LIKE_NEW
      's', // Wants product filters
      'OLED-MODEL', // Expected Model
      '', // End models
      's', // Require functional
      's', // Charger required
      'n', // Box required
      's', // Wants rules
      'custom-rules', // Rules profile
      'consola', // Include rule
      '', // End includes
      'repuesto', // Exclude rule
      '', // End excludes
      '85', // Match threshold
      '50', // Review threshold
      '1', // Precision MIXED
      's', // AI enabled
      'deepseek', // Provider
      's', // Evaluate only review
      's', // Require confirmation
      '10', // Max evals
      '60', // Raw data days
      's', // Wants report
      's', // Open automatically
      's', // Confirm save
    );

    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    const rawYaml = await store.read('advanced-switch');
    expect(rawYaml).not.toBeNull();
    const config = validateSavedSearchConfiguration(
      JSON.parse(JSON.stringify(rawYaml ? (await import('yaml')).parse(rawYaml) : {})),
    );

    expect(config.evaluation.matchThreshold).toBe(85);
    expect(config.evaluation.reviewThreshold).toBe(50);
    expect(config.evaluation.precisionProfile).toBe('MIXED');
    expect(config.ai.enabled).toBe(true);
    expect(config.ai.provider).toBe('deepseek');
    expect(config.ai.maxEvaluationsPerRun).toBe(10);
    expect(config.retention.rawDataDays).toBe(60);
    expect(config.rules?.include).toEqual(['consola']);
    expect(config.rules?.exclude).toEqual(['repuesto']);
    expect(config.product?.chargerRequired).toBe(true);
    expect(config.product?.boxRequired).toBe(false);
  });

  it('capability-driven: skips textSearch queries when adapter declares textSearch: false', async () => {
    const noTextCaps: SourceCapabilities = {
      ...defaultCaps,
      textSearch: false,
    };
    registry.register({
      id: 'feed-source',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: noTextCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('feed-source', noTextCaps),
    });

    terminal.enqueueInput(
      '1', // Simple
      'no-text-search', // ID
      'No Text Search', // Name
      '', // Enabled
      '1', // PRODUCT
      '1', // Source feed-source
      // Notice: NO queries prompted because textSearch is false!
      'n', // No location
      's', // Wants price
      '1', // ARS
      '', // No max price
      's', // Wants condition
      '1', // NEW
      's', // Save
    );

    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    const rawYaml = await store.read('no-text-search');
    const config = validateSavedSearchConfiguration(
      JSON.parse(JSON.stringify(rawYaml ? (await import('yaml')).parse(rawYaml) : {})),
    );
    expect(config.sources[0]?.queries).toEqual([]);
    expect(terminal.getRawOutput()).toContain('no utiliza búsqueda textual');
  });

  it('displays actionable message and cleanly returns to menu when SourceRegistry has 0 enabled sources', async () => {
    // Registry is empty
    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    expect(terminal.getRawOutput()).toContain(
      'No hay fuentes disponibles o habilitadas en el SourceRegistry',
    );
    expect(await store.list()).toEqual([]);
  });

  it('handles disabled sources in registry by displaying disabled reason and excluding from selection', async () => {
    registry.register({
      id: 'disabled-fb',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'DISABLED',
      reason: 'Requiere sesión activa',
      factory: () => createMockAdapter('disabled-fb', defaultCaps),
    });

    registry.register({
      id: 'active-source',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('active-source', defaultCaps),
    });

    terminal.enqueueInput(
      '1', // Simple
      'test-active-only',
      'Test Active',
      '',
      '1',
      '1', // active-source
      'Switch',
      '',
      'n',
      's', // Wants price
      '1',
      '',
      's', // Wants condition
      '1',
      's',
    );

    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    const output = terminal.getRawOutput();
    expect(output).toContain('disabled-fb: Requiere sesión activa');
    expect(await store.exists('test-active-only')).toBe(true);
  });

  it('prompts overwrite confirmation when ID already exists, respecting NO and YES responses', async () => {
    registry.register({
      id: 'synthetic',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('synthetic', defaultCaps),
    });

    await store.write('existing-search', 'schemaVersion: 1\nid: existing-search\n', {
      overwrite: true,
    });

    // Try to create with same ID and say NO to overwrite
    terminal.enqueueInput(
      '1',
      'existing-search',
      'New Name',
      '',
      '1',
      '1',
      'Query',
      '',
      'n',
      's', // Wants price
      '1',
      '',
      's', // Wants condition
      '1',
      's', // Save confirm
      'n', // Overwrite confirm -> NO
    );

    const wizard = new CreateSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    expect(terminal.getRawOutput()).toContain('El archivo preexistente no fue modificado');
    expect(await store.read('existing-search')).toBe('schemaVersion: 1\nid: existing-search\n');
  });
});
