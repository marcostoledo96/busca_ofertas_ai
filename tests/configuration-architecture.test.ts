import { describe, it, expect } from 'vitest';
import * as Configuration from '@busca-ofertas-ai/configuration';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Configuration Architecture and Boundary Invariants (BOAI-004)', () => {
  it('exports public production contracts, errors, schemas, registry, and codecs from root entrypoint', () => {
    expect(Configuration.CONFIGURATION_PACKAGE_NAME).toBe('@busca-ofertas-ai/configuration');
    expect(typeof Configuration.getConfigurationPackageMetadata).toBe('function');

    // Errors
    expect(Configuration.ConfigurationError).toBeDefined();
    expect(typeof Configuration.isConfigurationError).toBe('function');
    expect(typeof Configuration.isConfigurationErrorCode).toBe('function');

    // Security
    expect(typeof Configuration.detectForbiddenSecrets).toBe('function');

    // Schema
    expect(Configuration.savedSearchSchemaV1).toBeDefined();
    expect(Configuration.MAX_PAGES_LIMIT).toBe(100);
    expect(Configuration.MAX_ITEMS_LIMIT).toBe(10000);

    // Migrations
    expect(Configuration.MigrationRegistry).toBeDefined();
    expect(Configuration.defaultMigrationRegistry).toBeDefined();

    // Source Registry
    expect(Configuration.SourceRegistry).toBeDefined();

    // Capabilities
    expect(typeof Configuration.deriveRequiredCapabilities).toBe('function');
    expect(typeof Configuration.validateSearchCapabilities).toBe('function');

    // Codecs
    expect(typeof Configuration.parseSavedSearchYaml).toBe('function');
    expect(typeof Configuration.serializeSavedSearchYaml).toBe('function');
    expect(typeof Configuration.validateSavedSearchConfiguration).toBe('function');

    // Domain Projection
    expect(typeof Configuration.toDomainSavedSearch).toBe('function');
  });

  it('contains only permitted runtime dependencies in packages/configuration/package.json', () => {
    const pkgPath = path.resolve(__dirname, '../packages/configuration/package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const content = JSON.parse(raw) as { dependencies?: Record<string, string> };

    const deps: Record<string, string> = content.dependencies ?? {};
    const depKeys = Object.keys(deps).sort();

    // Expected production dependencies:
    // @busca-ofertas-ai/adapter-sdk, @busca-ofertas-ai/core, yaml, zod
    expect(depKeys).toEqual([
      '@busca-ofertas-ai/adapter-sdk',
      '@busca-ofertas-ai/core',
      'yaml',
      'zod',
    ]);
  });

  it('core and adapter-sdk do not depend on configuration (strict inward dependency flow)', () => {
    const corePkgPath = path.resolve(__dirname, '../packages/core/package.json');
    const coreContent = JSON.parse(fs.readFileSync(corePkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const coreDeps = Object.keys(coreContent.dependencies ?? {});
    expect(coreDeps.includes('@busca-ofertas-ai/configuration')).toBe(false);

    const adapterPkgPath = path.resolve(__dirname, '../packages/adapter-sdk/package.json');
    const adapterContent = JSON.parse(fs.readFileSync(adapterPkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const adapterDeps = Object.keys(adapterContent.dependencies ?? {});
    expect(adapterDeps.includes('@busca-ofertas-ai/configuration')).toBe(false);
  });
});
