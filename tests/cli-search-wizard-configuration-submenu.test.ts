import { describe, it, expect, beforeEach } from 'vitest';
import {
  SourceRegistry,
  parseSavedSearchYaml,
  toDomainSavedSearch,
} from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  InMemoryTextFileAdapter,
  ConfigurationSubmenu,
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

describe('CLI Search Wizard — Configuration Submenu (BOAI-007)', () => {
  let terminal: FakeTerminal;
  let registry: SourceRegistry;
  let store: InMemorySavedSearchConfigStore;
  let textPort: InMemoryTextFileAdapter;
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

  const validImportYaml = `
schemaVersion: 1
id: imported-switch-lite
name: Imported Switch Lite
enabled: true
category: PRODUCT
sources:
  - id: synthetic
    enabled: true
    queries:
      - Nintendo Switch Lite
location:
  mode: REGION
  region: AMBA
price:
  targetCurrency: ARS
  maximum: 260000
condition:
  accepted:
    - NEW
    - LIKE_NEW
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
  precisionProfile: MIXED
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
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
    textPort = new InMemoryTextFileAdapter();
    abortController = new AbortController();
  });

  it('imports valid YAML configuration, validates schema & capabilities, and persists to store', async () => {
    await textPort.writeTextFile('/tmp/my-search.yml', validImportYaml);

    // Sequence:
    // 1. Menu: 1 (Importar)
    // 2. Path: /tmp/my-search.yml
    // 3. Confirm import: s
    // 4. Submenu: 4 (Volver)
    terminal.enqueueInput('1', '/tmp/my-search.yml', 's', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await store.exists('imported-switch-lite')).toBe(true);
    const storedYaml = await store.read('imported-switch-lite');
    const parsed = parseSavedSearchYaml(storedYaml!);
    expect(parsed.id).toBe('imported-switch-lite');
    expect(parsed.name).toBe('Imported Switch Lite');
    expect(parsed.price?.maximum).toBe(260000);
    expect(terminal.getRawOutput()).toContain(
      'Búsqueda "imported-switch-lite" importada y guardada exitosamente',
    );
  });

  it('handles invalid YAML syntax and errors safely without writing to store', async () => {
    await textPort.writeTextFile('/tmp/invalid.yml', 'not a valid: yaml: [syntax');

    terminal.enqueueInput('1', '/tmp/invalid.yml', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await store.list()).toEqual([]);
    expect(terminal.getRawOutput()).toContain('Error al validar el archivo YAML importado');
    expect(terminal.getRawOutput()).toContain('Importación abortada');
  });

  it('detects inline secrets in imported YAML, blocks persistence, and sanitizes output', async () => {
    const secretYaml = `
schemaVersion: 1
id: secret-search
name: Secret Search
enabled: true
category: PRODUCT
sources:
  - id: synthetic
    enabled: true
    queries:
      - Nintendo
    options:
      apiKey: "fake-secret-token-123"
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: NONE
  rawDataDays: 30
`.trim();

    await textPort.writeTextFile('/tmp/secret.yml', secretYaml);
    terminal.enqueueInput('1', '/tmp/secret.yml', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await store.exists('secret-search')).toBe(false);
    const output = terminal.getRawOutput();
    expect(output).toContain('CONFIG_SECRET_FORBIDDEN');
    expect(output).not.toContain('fake-secret-token-123'); // Sanitized!
  });

  it('handles capability mismatch in imported YAML safely without writing', async () => {
    const geoMismatchYaml = `
schemaVersion: 1
id: geo-mismatch
name: Geo Mismatch
enabled: true
category: PRODUCT
sources:
  - id: no-geo-source
    enabled: true
    queries:
      - Switch
location:
  mode: RADIUS
  radiusKm: 50
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: NONE
  rawDataDays: 30
`.trim();

    const noGeoCaps: SourceCapabilities = { ...defaultCaps, geographicSearch: false };
    registry.register({
      id: 'no-geo-source',
      version: '1.0.0',
      sdkVersion: '0.1.0',
      capabilities: noGeoCaps,
      status: 'ENABLED',
      factory: () => createMockAdapter('no-geo-source', noGeoCaps),
    });

    await textPort.writeTextFile('/tmp/geo-mismatch.yml', geoMismatchYaml);
    terminal.enqueueInput('1', '/tmp/geo-mismatch.yml', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await store.exists('geo-mismatch')).toBe(false);
    expect(terminal.getRawOutput()).toContain('CONFIG_CAPABILITY_MISMATCH');
  });

  it('SEMANTIC ROUND-TRIP: exports search to external file and verifies semantic equality upon re-import', async () => {
    // 1. Write initial configuration into store
    await store.write('imported-switch-lite', validImportYaml, { overwrite: true });

    // 2. Export search to /tmp/exported-roundtrip.yml
    // Menu: 2 (Exportar), 1 (Select search), Path: /tmp/exported-roundtrip.yml, 4 (Volver)
    terminal.enqueueInput('2', '1', '/tmp/exported-roundtrip.yml', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await textPort.exists('/tmp/exported-roundtrip.yml')).toBe(true);
    const exportedContent = await textPort.readTextFile('/tmp/exported-roundtrip.yml');

    // 3. Parse exported YAML and verify exact semantic equivalence
    const originalConfig = parseSavedSearchYaml(validImportYaml);
    const roundTripConfig = parseSavedSearchYaml(exportedContent);

    expect(roundTripConfig).toEqual(originalConfig);

    // 4. Project both to domain SavedSearch entity and verify domain equality
    const testDate = new Date('2026-08-30T12:00:00Z');
    const domainOriginal = toDomainSavedSearch(originalConfig, {
      createdAt: testDate,
      updatedAt: testDate,
    });
    const domainRoundTrip = toDomainSavedSearch(roundTripConfig, {
      createdAt: testDate,
      updatedAt: testDate,
    });

    expect(domainRoundTrip.id).toBe(domainOriginal.id);
    expect(domainRoundTrip.name).toBe(domainOriginal.name);
    expect(domainRoundTrip.category).toBe(domainOriginal.category);
    expect(domainRoundTrip.sourceConfigs).toEqual(domainOriginal.sourceConfigs);
    expect(domainRoundTrip.location).toEqual(domainOriginal.location);
    expect(domainRoundTrip.price).toEqual(domainOriginal.price);
    expect(domainRoundTrip.condition).toEqual(domainOriginal.condition);
    expect(domainRoundTrip.evaluation).toEqual(domainOriginal.evaluation);
  });

  it('deletes saved search with explicit confirmation, respecting NO and YES responses', async () => {
    await store.write('to-delete-search', validImportYaml, { overwrite: true });

    // 1. Cancel deletion: Menu 3 (Delete), 1 (Select search), 'n' (Confirm NO), 4 (Volver)
    terminal.enqueueInput('3', '1', 'n', '4');

    const submenu = new ConfigurationSubmenu({
      terminal,
      signal: abortController.signal,
      sourceRegistry: registry,
      configStore: store,
      textFilePort: textPort,
    });

    await submenu.run();

    expect(await store.exists('to-delete-search')).toBe(true);
    expect(terminal.getRawOutput()).toContain('Eliminación cancelada');

    // 2. Confirm deletion: Menu 3 (Delete), 1 (Select search), 's' (Confirm YES), 4 (Volver)
    terminal.clear();
    terminal.enqueueInput('3', '1', 's', '4');

    await submenu.run();

    expect(await store.exists('to-delete-search')).toBe(false);
    expect(terminal.getRawOutput()).toContain('Búsqueda "to-delete-search" eliminada exitosamente');
  });
});
