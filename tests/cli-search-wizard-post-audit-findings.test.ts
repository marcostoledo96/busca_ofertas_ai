import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SourceRegistry,
  ConfigurationError,
  detectForbiddenSecrets,
  parseSavedSearchYaml,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  CreateSearchWizard,
  EditSearchWizard,
  CliShell,
  EXIT_CODES,
  formatSearchSummary,
  formatStructuralDiff,
  calculateStructuralDiff,
  resolveDefaultSearchConfigDirectory,
  ErrorPresenter,
  SanitizedDiagnosticLogger,
  TerminalProgressReporter,
  MenuFormatter,
  type MenuAction,
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

describe('BOAI-007 — Post-Audit Findings & Refinement Coverage (Findings 1–6)', () => {
  let terminal: FakeTerminal;
  let registry: SourceRegistry;
  let store: InMemorySavedSearchConfigStore;
  let abortController: AbortController;

  const geoCaps: SourceCapabilities = {
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

  const nonGeoCaps: SourceCapabilities = {
    ...geoCaps,
    geographicSearch: false,
  };

  beforeEach(() => {
    terminal = new FakeTerminal();
    registry = new SourceRegistry();
    store = new InMemorySavedSearchConfigStore('/test/searches');
    abortController = new AbortController();
  });

  describe('Finding 1 (HIGH — Safe Output & Defense in Depth / Secret Detection)', () => {
    const BEARER_SENTINEL = ['synthetic', 'bearer', 'token', 'abc123456789'].join('_');
    const PAT_SENTINEL = ['github', 'pat', '11AAAAAA_BBBBBBBBBBBBBBBB'].join('_');
    const PASSWORD_ASSIGNMENT = ['password', 'super_secret_pw_999'].join('=');

    it('detects and rejects secret patterns within innocent keys (options note, queries, rules, ai provider)', () => {
      const innocentLocations: Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
      }> = [
        {
          name: 'options.note with Authorization header',
          payload: {
            sources: [{ id: 'src', options: { note: `Authorization: Bearer ${BEARER_SENTINEL}` } }],
          },
          expectedPath: 'sources[0].options.note',
        },
        {
          name: 'query containing password assignment',
          payload: {
            sources: [{ id: 'src', queries: [`search for item with ${PASSWORD_ASSIGNMENT}`] }],
          },
          expectedPath: 'sources[0].queries[0]',
        },
        {
          name: 'rules include containing github pat',
          payload: {
            rules: { profile: 'p', include: [`rule with ${PAT_SENTINEL}`] },
          },
          expectedPath: 'rules.include[0]',
        },
        {
          name: 'ai.provider containing Bearer token pattern',
          payload: {
            ai: { enabled: true, provider: `Bearer ${BEARER_SENTINEL}` },
          },
          expectedPath: 'ai.provider',
        },
      ];

      for (const loc of innocentLocations) {
        const violations = detectForbiddenSecrets(loc.payload);
        expect(violations.length, `Expected violation for ${loc.name}`).toBeGreaterThanOrEqual(1);
        const matchingViolation = violations.find((v) => v.path === loc.expectedPath);
        expect(matchingViolation, `Violation path mismatch for ${loc.name}`).toBeDefined();
        expect(matchingViolation?.code).toBe('CONFIG_SECRET_FORBIDDEN');

        // CRITICAL: Ensure the secret sentinel never leaks on the violation object
        expect(JSON.stringify(matchingViolation).includes(BEARER_SENTINEL)).toBe(false);
        expect(JSON.stringify(matchingViolation).includes(PAT_SENTINEL)).toBe(false);
        expect(JSON.stringify(matchingViolation).includes(PASSWORD_ASSIGNMENT)).toBe(false);
      }
    });

    it('formatSearchSummary and formatStructuralDiff redact secret patterns so stdout/diff never leak secrets', () => {
      const configWithSecretPatterns: SavedSearchConfigurationV1 = {
        schemaVersion: 1,
        id: 'test-search',
        name: `Name with ${PASSWORD_ASSIGNMENT}`,
        enabled: true,
        category: 'PRODUCT',
        sources: [
          {
            id: 'synthetic',
            enabled: true,
            queries: [`query with Authorization: Bearer ${BEARER_SENTINEL}`],
            options: {
              customNote: `Authorization: Bearer ${BEARER_SENTINEL}`,
            },
          },
        ],
        rules: {
          profile: 'rules-profile',
          include: [`rule with ${PAT_SENTINEL}`],
        },
        evaluation: { matchThreshold: 80, reviewThreshold: 40 },
        ai: {
          enabled: true,
          evaluateOnlyReview: true,
          requireConfirmation: true,
          maxEvaluationsPerRun: 5,
          provider: `Bearer ${BEARER_SENTINEL}`,
        },
        retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
      };

      const summary = formatSearchSummary(configWithSecretPatterns);
      expect(summary.includes(BEARER_SENTINEL)).toBe(false);
      expect(summary.includes(PAT_SENTINEL)).toBe(false);
      expect(summary.includes(PASSWORD_ASSIGNMENT)).toBe(false);
      expect(summary).toContain('[REDACTED]');

      const originalConfig: SavedSearchConfigurationV1 = {
        ...configWithSecretPatterns,
        sources: [{ id: 'synthetic', enabled: true, queries: [] }],
      };
      const diff = calculateStructuralDiff(originalConfig, configWithSecretPatterns);
      const formattedDiff = formatStructuralDiff(diff);

      expect(formattedDiff.includes(BEARER_SENTINEL)).toBe(false);
      expect(formattedDiff.includes(PAT_SENTINEL)).toBe(false);
      expect(formattedDiff.includes(PASSWORD_ASSIGNMENT)).toBe(false);
      expect(formattedDiff).toContain('[REDACTED]');
    });
  });

  describe('Finding 2 (HIGH — No Injected Business Defaults in Simple Mode)', () => {
    it('creates a strictly minimal search configuration when user answers NO to optional sections', async () => {
      registry.register({
        id: 'synthetic',
        version: '1.0.0',
        sdkVersion: '0.1.0',
        capabilities: geoCaps,
        status: 'ENABLED',
        factory: () => createMockAdapter('synthetic', geoCaps),
      });

      // Simple mode minimal answers:
      // 1. Mode: 1 (Simple)
      // 2. ID: minimal-search
      // 3. Name: Minimal Search
      // 4. Enabled: Enter (true)
      // 5. Category: 1 (PRODUCT)
      // 6. Sources: 1 (synthetic)
      // 7. Queries: 'Minimal Query', '' (finish)
      // 8. Location: 'n' (omit)
      // 9. Price: 'n' (omit)
      // 10. Condition: 'n' (omit)
      // 11. Confirm save: 's'
      terminal.enqueueInput(
        '1', // Mode Simple
        'minimal-search',
        'Minimal Search',
        '', // Enabled: true
        '1', // PRODUCT
        '1', // Source synthetic
        'Minimal Query',
        '', // Finish queries
        'n', // Location: omit
        'n', // Price: omit
        'n', // Condition: omit
        's', // Confirm save
      );

      const wizard = new CreateSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      await wizard.run();

      const rawYaml = await store.read('minimal-search');
      expect(rawYaml).not.toBeNull();
      const config = parseSavedSearchYaml(rawYaml!);

      // Assert optional blocks are strictly undefined (not auto-injected)
      expect(config.location).toBeUndefined();
      expect(config.price).toBeUndefined();
      expect(config.condition).toBeUndefined();
      expect(config.product).toBeUndefined();
      expect(config.rules).toBeUndefined();
      expect(config.report).toBeUndefined();

      // Assert only mandatory evaluation/ai/retention defaults are present
      expect(config.evaluation).toEqual({
        matchThreshold: 80,
        reviewThreshold: 40,
        precisionProfile: 'MIXED',
      });
      expect(config.ai).toEqual({
        enabled: false,
        evaluateOnlyReview: true,
        requireConfirmation: true,
        maxEvaluationsPerRun: 5,
      });
      expect(config.retention).toEqual({
        rawArtifacts: 'ERRORS_AND_REVIEW',
        rawDataDays: 30,
      });
    });
  });

  describe('Finding 3 (MEDIUM — Capability UX in Edit Search Wizard)', () => {
    it('warns user when an enabled source lacks geographicSearch and allows removing location from draft', async () => {
      registry.register({
        id: 'geo-source',
        version: '1.0.0',
        sdkVersion: '0.1.0',
        capabilities: geoCaps,
        status: 'ENABLED',
        factory: () => createMockAdapter('geo-source', geoCaps),
      });

      registry.register({
        id: 'no-geo-source',
        version: '1.0.0',
        sdkVersion: '0.1.0',
        capabilities: nonGeoCaps,
        status: 'ENABLED',
        factory: () => createMockAdapter('no-geo-source', nonGeoCaps),
      });

      const initialYaml = `
schemaVersion: 1
id: multi-source-search
name: Multi Source Search
enabled: true
category: PRODUCT
sources:
  - id: geo-source
    enabled: true
    queries: ["query 1"]
  - id: no-geo-source
    enabled: true
    queries: ["query 2"]
location:
  mode: REGION
  region: AMBA
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`.trim();

      await store.write('multi-source-search', initialYaml, { overwrite: true });

      // Sequence:
      // 1. Select search: 1 (multi-source-search)
      // 2. Select section: 3 (Ubicación geográfica)
      // -> Wizard detects no-geo-source lacks geographicSearch and displays warning
      // 3. Select action: 2 (Eliminar ubicación geográfica del draft)
      // 4. Select section: 13 (Guardar cambios y volver)
      // 5. Confirm save: 's'
      terminal.enqueueInput(
        '1', // Select search
        '3', // Location section
        '2', // Action: Eliminar ubicación geográfica
        '13', // Guardar cambios
        's', // Confirm save
      );

      const wizard = new EditSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      await wizard.run();

      const output = terminal.getRawOutput();
      expect(output).toContain('No es posible configurar filtros de ubicación geográfica');
      expect(output).toContain('[no-geo-source] No admite búsqueda geográfica');

      const updatedYaml = await store.read('multi-source-search');
      const updatedConfig = parseSavedSearchYaml(updatedYaml!);
      expect(updatedConfig.location).toBeUndefined();
    });
  });

  describe('Finding 4 (MEDIUM — Field Preservation Guarantee)', () => {
    it('preserves existing ai.provider when AI is edited but left disabled', async () => {
      registry.register({
        id: 'synthetic',
        version: '1.0.0',
        sdkVersion: '0.1.0',
        capabilities: geoCaps,
        status: 'ENABLED',
        factory: () => createMockAdapter('synthetic', geoCaps),
      });

      const yamlWithAiProvider = `
schemaVersion: 1
id: ai-provider-search
name: AI Provider Test
enabled: true
category: PRODUCT
sources:
  - id: synthetic
    enabled: true
    queries: ["test"]
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
  provider: openai
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`.trim();

      await store.write('ai-provider-search', yamlWithAiProvider, { overwrite: true });

      // Sequence:
      // 1. Select search: 1
      // 2. Select section: 9 (IA)
      // 3. Enable IA? 'n' (keep false)
      // 4. Select section: 13 (Guardar cambios)
      terminal.enqueueInput(
        '1', // Select search
        '9', // IA section
        'n', // Keep enabled: false
        '13', // Guardar cambios
      );

      const wizard = new EditSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      await wizard.run();

      const output = terminal.getRawOutput();
      expect(output).toContain('No se detectaron modificaciones');

      const config = parseSavedSearchYaml((await store.read('ai-provider-search'))!);
      expect(config.ai.provider).toBe('openai');
    });

    it('preserves report as undefined when only retention is edited', async () => {
      registry.register({
        id: 'synthetic',
        version: '1.0.0',
        sdkVersion: '0.1.0',
        capabilities: geoCaps,
        status: 'ENABLED',
        factory: () => createMockAdapter('synthetic', geoCaps),
      });

      const yamlWithoutReport = `
schemaVersion: 1
id: no-report-search
name: No Report Test
enabled: true
category: PRODUCT
sources:
  - id: synthetic
    enabled: true
    queries: ["test"]
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`.trim();

      await store.write('no-report-search', yamlWithoutReport, { overwrite: true });

      // Sequence:
      // 1. Select search: 1
      // 2. Select section: 10 (Retención de datos crudos)
      // 3. New rawDataDays: 60
      // 4. Select section: 13 (Guardar cambios)
      // 5. Confirm save: 's'
      terminal.enqueueInput(
        '1', // Select search
        '10', // Retention section
        '60', // 60 days
        '13', // Guardar cambios
        's', // Confirm save
      );

      const wizard = new EditSearchWizard({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
      });

      await wizard.run();

      const config = parseSavedSearchYaml((await store.read('no-report-search'))!);
      expect(config.retention.rawDataDays).toBe(60);
      expect(config.report).toBeUndefined();
    });
  });

  describe('Finding 5 (MEDIUM — Exit Code Resolution for ConfigurationError)', () => {
    it('resolves ConfigurationError to INVALID_CONFIGURATION (20), unknown errors to 70, and abort to 130', async () => {
      const failingAction: MenuAction = {
        id: 'failing-config-action',
        optionNumber: 1,
        title: 'Failing Config Action',
        execute: () => {
          throw new ConfigurationError({
            code: 'CONFIG_SCHEMA_VALIDATION_ERROR',
            path: 'root',
            message: 'Invalid configuration in action',
          });
        },
      };

      const shell = new CliShell({
        terminal,
        actions: [failingAction],
        errorPresenter: new ErrorPresenter(terminal),
        diagnostics: new SanitizedDiagnosticLogger(),
        progress: new TerminalProgressReporter(terminal),
        formatter: new MenuFormatter(),
      });

      terminal.enqueueInput('1');
      const exitCode = await shell.run(abortController.signal);
      expect(exitCode).toBe(EXIT_CODES.INVALID_CONFIGURATION); // 20
    });
  });

  describe('Finding 6 (MEDIUM — Storage Root CWD-Independence)', () => {
    it('resolves default storage root deterministically regardless of process.cwd()', () => {
      const originalCwd = process.cwd();
      const tmpDir = os.tmpdir();

      try {
        process.chdir(tmpDir);

        const resolvedDir = resolveDefaultSearchConfigDirectory();
        expect(resolvedDir).not.toContain(tmpDir);
        expect(resolvedDir.endsWith(path.join('busca-ofertas-ai', 'searches'))).toBe(true);

        // Verify explicit directory is respected if provided
        const customDir = resolveDefaultSearchConfigDirectory('/custom/searches');
        expect(customDir).toBe(path.resolve('/custom/searches'));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
