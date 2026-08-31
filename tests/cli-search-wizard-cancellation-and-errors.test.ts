import { describe, it, expect, beforeEach } from 'vitest';
import { SourceRegistry } from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  InMemoryTextFileAdapter,
  CreateSearchWizard,
  EditSearchWizard,
  ConfigurationSubmenu,
  validateSearchId,
  isCliError,
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

describe('CLI Search Wizard — Cancellation, Input Validation & Security (BOAI-007)', () => {
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

  describe('Immediate Input Validation Loops', () => {
    it('reprompts on invalid ID format and preserves draft until valid input is given', async () => {
      // Invalid IDs followed by valid ID
      terminal.enqueueInput(
        '1', // Mode simple
        'INVALID ID WITH SPACES', // Invalid
        'Invalid_Caps', // Invalid
        'switch--lite', // Invalid double dash
        'valid-switch-lite', // Valid!
        'Valid Name',
        '',
        '1',
        '1',
        'Query',
        '',
        'n',
        '1',
        '',
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
      expect(output).toContain('El ID debe estar en formato kebab-case en minúsculas');
      expect(await store.exists('valid-switch-lite')).toBe(true);
    });

    it('reprompts on invalid numbers and threshold invariant violations without crashing', async () => {
      terminal.enqueueInput(
        '2', // Advanced
        'threshold-test',
        'Threshold Test',
        '',
        '1',
        '1',
        'Query',
        '',
        'not-a-number', // Invalid page
        '-5', // Invalid page < 1
        '3', // Valid page
        'n', // Location
        '1', // Currency ARS
        'abc', // Invalid price
        '250000', // Valid max price
        '300000', // Invalid min plausible > max price!
        '150000', // Valid min plausible
        'n', // Foreign
        '1', // Condition
        '', // Expected models (empty to omit)
        's', // Require functional
        'n', // Charger required
        'n', // Box required
        'test-rules', // Rules profile
        '', // Include (empty)
        '', // Exclude (empty)
        '80', // Match threshold
        '85', // Invalid review threshold >= match threshold (85 >= 80)!
        '40', // Valid review threshold < 80
        '1', // Precision
        'n', // AI
        '0', // Invalid raw data days < 1
        '30', // Valid days
        's', // Open auto
        's', // Save
      );

      const wizard = new CreateSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      await wizard.run();

      const output = terminal.getRawOutput();
      expect(output).toContain(
        'El precio mínimo verosímil (300000) no puede superar el precio máximo (250000)',
      );
      expect(output).toContain(
        'reviewThreshold (85) debe ser estrictamente menor que matchThreshold (80)',
      );
      expect(await store.exists('threshold-test')).toBe(true);
    });
  });

  describe('Cooperative Cancellation with AbortSignal', () => {
    it('aborts create wizard cleanly without writing to store', async () => {
      terminal.enqueueInput('1', 'aborted-search');

      const wizard = new CreateSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      const runPromise = wizard.run();
      abortController.abort('User pressed Ctrl+C');

      await expect(runPromise).rejects.toThrow();
      expect(await store.list()).toEqual([]);
    });

    it('aborts edit wizard cleanly without mutating store', async () => {
      await store.write(
        'original-search',
        'schemaVersion: 1\nid: original-search\nname: Orig\nenabled: true\ncategory: PRODUCT\nsources: [{ id: synthetic, enabled: true, queries: [Q] }]\nevaluation: { matchThreshold: 80, reviewThreshold: 40 }\nai: { enabled: false, evaluateOnlyReview: true, requireConfirmation: true, maxEvaluationsPerRun: 5 }\nretention: { rawArtifacts: NONE, rawDataDays: 30 }\n',
        { overwrite: true },
      );

      terminal.enqueueInput('1');

      const wizard = new EditSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      const runPromise = wizard.run();
      abortController.abort('User pressed Ctrl+C');

      await expect(runPromise).rejects.toThrow();
      expect(await store.read('original-search')).toContain('name: Orig');
    });

    it('aborts import cleanly without writing to store', async () => {
      await textPort.writeTextFile('/tmp/valid.yml', 'schemaVersion: 1\nid: import-abort\n');

      terminal.enqueueInput('1');

      const submenu = new ConfigurationSubmenu({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
      });

      const runPromise = submenu.run();
      abortController.abort('User cancelled');

      await expect(runPromise).rejects.toThrow();
      expect(await store.exists('import-abort')).toBe(false);
    });

    it('aborts delete cleanly without removing file from store', async () => {
      await store.write('keep-me', 'schemaVersion: 1\nid: keep-me\n', { overwrite: true });

      terminal.enqueueInput('3');

      const submenu = new ConfigurationSubmenu({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
      });

      const runPromise = submenu.run();
      abortController.abort('User cancelled');

      await expect(runPromise).rejects.toThrow();
      expect(await store.exists('keep-me')).toBe(true);
    });
  });

  describe('Path Traversal & Security Defenses', () => {
    it('strictly rejects path traversal patterns in search ID', () => {
      const maliciousIds = [
        '../evil',
        '../../etc/passwd',
        'sub/dir',
        'sub\\dir',
        'id\0null',
        '..',
        '.',
        '/root-path',
      ];

      for (const badId of maliciousIds) {
        expect(() => validateSearchId(badId)).toThrow();
        try {
          validateSearchId(badId);
        } catch (err) {
          expect(isCliError(err)).toBe(true);
        }
      }
    });

    it('store.resolvePath throws on path traversal attempts escaping storage root', () => {
      expect(() => store.resolvePath('../../escape')).toThrow();
      expect(() => store.resolvePath('/absolute/path')).toThrow();
    });
  });
});
