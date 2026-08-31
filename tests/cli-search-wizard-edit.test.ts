import { describe, it, expect, beforeEach } from 'vitest';
import { SourceRegistry, parseSavedSearchYaml } from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  EditSearchWizard,
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

describe('CLI Search Wizard — Edit Search (BOAI-007)', () => {
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

  const fullSampleYaml = `
schemaVersion: 1
id: switch-lite-full
name: Nintendo Switch Lite Full Config
enabled: true
category: PRODUCT
sources:
  - id: synthetic
    enabled: true
    queries:
      - Nintendo Switch Lite
      - Switch Lite
    options:
      customFutureOption: keep-this-intact
      sort: NEWEST
      maxPages: 3
location:
  mode: REGION
  region: AMBA
  radiusKm: 80
price:
  targetCurrency: ARS
  maximum: 250000
  minimumPlausible: 100000
condition:
  accepted:
    - NEW
    - LIKE_NEW
product:
  expectedModels:
    - SWITCH_LITE_TURQUOISE
  requireFunctional: true
  chargerRequired: true
  boxRequired: false
rules:
  profile: switch-rules
  include:
    - consola
  exclude:
    - repuesto
evaluation:
  matchThreshold: 85
  reviewThreshold: 45
  precisionProfile: STRICT
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 45
report:
  openAutomatically: true
  includeRejected: COLLAPSED
  exports:
    - HTML
    - JSON
`.trim();

  beforeEach(() => {
    terminal = new FakeTerminal();
    registry = new SourceRegistry();
    registry.register({
      id: 'synthetic',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: defaultCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('synthetic', defaultCaps),
    });
    store = new InMemorySavedSearchConfigStore('/test/searches');
    abortController = new AbortController();
  });

  it('PRESERVATION GUARANTEE: editing only price preserves all untouched fields and custom source.options keys', async () => {
    await store.write('switch-lite-full', fullSampleYaml, { overwrite: true });

    // Sequence:
    // 1. Select search: 1 (switch-lite-full)
    // 2. Select section: 4 (Precios y monedas)
    // 3. Keep Currency ARS (Enter)
    // 4. Set Price Maximum: 290000
    // 5. Keep Minimum Plausible: Enter (100000)
    // 6. Select section: 12 (Guardar cambios y volver)
    // 7. Confirm save: s
    terminal.enqueueInput(
      '1', // Select search
      '4', // Section Precios
      '', // Keep ARS
      '290000', // New max price
      '', // Keep min plausible
      '12', // Save cambios
      's', // Confirm save
    );

    const wizard = new EditSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    const updatedYaml = await store.read('switch-lite-full');
    expect(updatedYaml).not.toBeNull();
    const updatedConfig = parseSavedSearchYaml(updatedYaml!);

    // Verify modified field
    expect(updatedConfig.price?.maximum).toBe(290000);

    // Verify all untouched fields are 100% preserved
    expect(updatedConfig.id).toBe('switch-lite-full');
    expect(updatedConfig.name).toBe('Nintendo Switch Lite Full Config');
    expect(updatedConfig.category).toBe('PRODUCT');
    expect(updatedConfig.enabled).toBe(true);
    expect(updatedConfig.sources[0]?.options).toEqual({
      customFutureOption: 'keep-this-intact',
      sort: 'NEWEST',
      maxPages: 3,
    });
    expect(updatedConfig.sources[0]?.queries).toEqual(['Nintendo Switch Lite', 'Switch Lite']);
    expect(updatedConfig.location).toEqual({
      mode: 'REGION',
      region: 'AMBA',
      radiusKm: 80,
    });
    expect(updatedConfig.condition?.accepted).toEqual(['NEW', 'LIKE_NEW']);
    expect(updatedConfig.product).toEqual({
      expectedModels: ['SWITCH_LITE_TURQUOISE'],
      requireFunctional: true,
      chargerRequired: true,
      boxRequired: false,
    });
    expect(updatedConfig.rules).toEqual({
      profile: 'switch-rules',
      include: ['consola'],
      exclude: ['repuesto'],
    });
    expect(updatedConfig.evaluation).toEqual({
      matchThreshold: 85,
      reviewThreshold: 45,
      precisionProfile: 'STRICT',
    });
    expect(updatedConfig.ai).toEqual({
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 5,
    });
    expect(updatedConfig.retention).toEqual({
      rawArtifacts: 'ERRORS_AND_REVIEW',
      rawDataDays: 45,
    });

    // Check that diff output was shown
    const output = terminal.getRawOutput();
    expect(output).toContain('CAMBIOS APLICADOS');
    expect(output).toContain('~ price.maximum: 250000 → 290000');
  });

  it('exits cleanly with informative message when user saves without making changes', async () => {
    await store.write('switch-lite-full', fullSampleYaml, { overwrite: true });

    terminal.enqueueInput(
      '1', // Select search
      '12', // Save immediately without changes
    );

    const wizard = new EditSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    expect(terminal.getRawOutput()).toContain('No se detectaron modificaciones');
  });

  it('discards all draft modifications when user selects cancel', async () => {
    await store.write('switch-lite-full', fullSampleYaml, { overwrite: true });

    terminal.enqueueInput(
      '1', // Select search
      '4', // Price section
      '', // Currency
      '999999', // Change max price
      '', // Min plausible
      '13', // Cancel section
    );

    const wizard = new EditSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    expect(terminal.getRawOutput()).toContain('Edición cancelada por el usuario');
    const unchangedYaml = await store.read('switch-lite-full');
    const config = parseSavedSearchYaml(unchangedYaml!);
    expect(config.price?.maximum).toBe(250000);
  });

  it('informs user and returns when no searches are available in store', async () => {
    const wizard = new EditSearchWizard({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
    });

    await wizard.run();

    expect(terminal.getRawOutput()).toContain('No hay búsquedas guardadas disponibles para editar');
  });
});
