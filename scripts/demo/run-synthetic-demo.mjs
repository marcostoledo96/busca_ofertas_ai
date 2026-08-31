#!/usr/bin/env node

/**
 * Busca Ofertas AI — Offline Synthetic Demo Runner
 *
 * Contractual Reference: Issue #10 (BOAI-009), ADR-002.
 *
 * Exercises the end-to-end seam:
 * 1. Reads and parses SavedSearch YAML configuration.
 * 2. Validates schema and capability compatibility against SourceRegistry.
 * 3. Resolves SyntheticAdapter via SourceRegistry factory.
 * 4. Initializes adapter with sanitized context.
 * 5. Executes multi-query search with artificial pagination.
 * 6. Emits structured, sanitized human-readable summary.
 * 7. Disposes adapter cleanly and exits 0.
 *
 * 100% offline, zero network requests, zero secrets, zero database requirements.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  importSavedSearchYaml,
  validateSearchCapabilities,
  ConfigurationError,
  isConfigurationError,
} from '@busca-ofertas-ai/configuration';
import { createDefaultSourceRegistry } from '@busca-ofertas-ai/cli';
import {
  createSanitizedAdapterContext,
  createSanitizedLogger,
  createSanitizedArtifactWriter,
  isSourceAdapterError,
} from '@busca-ofertas-ai/adapter-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runSyntheticDemo(configPathInput) {
  const rootDir = resolve(__dirname, '../..');
  const defaultConfigFile = resolve(rootDir, 'config/searches/synthetic-demo.example.yml');
  const configFilePath = configPathInput ? resolve(configPathInput) : defaultConfigFile;

  if (!existsSync(configFilePath)) {
    throw new ConfigurationError({
      code: 'CONFIG_FILE_NOT_FOUND',
      path: configFilePath,
      message: `Configuration file not found at ${configFilePath}`,
    });
  }

  const rawYaml = readFileSync(configFilePath, 'utf8');

  // 1. Parse & validate SavedSearch configuration schema (throws ConfigurationError on invalid config)
  const importResult = importSavedSearchYaml(rawYaml, {
    clock: { now: () => new Date('2026-08-31T12:00:00Z') },
  });

  const savedSearch = importResult.configuration;

  // 2. Build SourceRegistry & validate capabilities (throws ConfigurationError if incompatible)
  const registry = createDefaultSourceRegistry();
  validateSearchCapabilities(savedSearch, registry);

  const sourceConfig = savedSearch.sources.find((s) => s.id === 'synthetic');
  if (!sourceConfig || !sourceConfig.enabled) {
    throw new ConfigurationError({
      code: 'CONFIG_SOURCE_NOT_FOUND',
      path: 'sources',
      message: 'No enabled synthetic source found in configuration',
    });
  }

  // 3. Create adapter via registry factory
  const adapter = registry.createAdapter('synthetic');

  // 4. Initialize adapter with in-memory context
  const abortController = new AbortController();
  const context = createSanitizedAdapterContext({
    runId: 'demo-synthetic-run-001',
    logger: createSanitizedLogger({
      debug: () => {},
      info: () => {},
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    }),
    clock: { now: () => new Date('2026-08-31T12:00:00Z') },
    abortSignal: abortController.signal,
    artifactWriter: createSanitizedArtifactWriter({
      writeArtifact: () => Promise.resolve('artifact-demo-001'),
    }),
    secretProvider: {
      getSecret: () => Promise.resolve(null),
    },
    sessionDirectory: '/tmp/busca-ofertas-demo',
  });

  await adapter.initialize(context);

  try {
    // 5. Execute search
    const maxPages =
      typeof sourceConfig.options?.['maxPages'] === 'number' ? sourceConfig.options['maxPages'] : 3;
    const maxItems =
      typeof sourceConfig.options?.['maxItems'] === 'number'
        ? sourceConfig.options['maxItems']
        : 50;

    const searchResult = await adapter.search({
      savedSearchId: savedSearch.id,
      queries: sourceConfig.queries,
      pagination: {
        maxPages,
        maxItems,
      },
      sourceOptions: sourceConfig.options ?? {},
      control: {
        signal: abortController.signal,
      },
    });

    // 6. Print brief, sanitized summary
    console.log('============================================================');
    console.log('Busca Ofertas AI — Synthetic Demo (Offline)');
    console.log('============================================================');
    console.log(`SavedSearch ID : ${savedSearch.id}`);
    console.log(`Search Name    : ${savedSearch.name}`);
    console.log(
      `Source         : ${searchResult.sourceId} (version ${adapter.version}, SDK ${adapter.sdkVersion})`,
    );
    console.log(`Status         : ${searchResult.status}`);
    console.log(`Pages read     : ${searchResult.pagesRead}`);
    console.log(`Items count    : ${searchResult.items.length}`);
    console.log(`Has more       : ${searchResult.hasMore}`);
    console.log(`Stop reason    : ${searchResult.diagnostics.stopReason}`);
    console.log('------------------------------------------------------------');
    console.log('Sample Listings:');

    for (const item of searchResult.items) {
      const loc = item.rawLocationText ?? 'Ubicación no especificada';
      console.log(
        `  ${item.externalId} | ${item.title.padEnd(48, ' ')} | ${item.rawPriceText.padEnd(18, ' ')} | ${loc}`,
      );
    }

    console.log('============================================================');
    console.log('Demo completed successfully (offline, 0 network, 0 secrets).');

    return {
      status: searchResult.status,
      pagesRead: searchResult.pagesRead,
      itemsCount: searchResult.items.length,
      hasMore: searchResult.hasMore,
      stopReason: searchResult.diagnostics.stopReason,
    };
  } finally {
    await adapter.dispose();
  }
}

// Direct execution guard
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  runSyntheticDemo(process.argv[2])
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      if (isConfigurationError(err)) {
        console.error(`[INVALID_CONFIGURATION] ${err.code}: ${err.message}`);
        if (err.issues && err.issues.length > 0) {
          for (const issue of err.issues) {
            console.error(`  - [${issue.code}] ${issue.path}: ${issue.message}`);
          }
        }
        process.exit(20); // EXIT_CODES.INVALID_CONFIGURATION
      } else if (isSourceAdapterError(err)) {
        console.error(`[TOTAL_SOURCE_FAILURE] ${err.code}: ${err.message}`);
        process.exit(30); // EXIT_CODES.TOTAL_SOURCE_FAILURE
      } else {
        console.error(`[INTERNAL_ERROR] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(70); // EXIT_CODES.INTERNAL_ERROR
      }
    });
}
