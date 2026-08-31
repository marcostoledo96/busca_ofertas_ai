import { describe, it, expect } from 'vitest';
import {
  MigrationRegistry,
  defaultMigrationRegistry,
  ConfigurationError,
} from '@busca-ofertas-ai/configuration';

describe('Configuration Migrations Engine (BOAI-004)', () => {
  it('defaultMigrationRegistry starts with zero production legacy migrations', () => {
    expect(defaultMigrationRegistry.hasStep(0)).toBe(false);
    expect(defaultMigrationRegistry.hasStep(1)).toBe(false);
  });

  it('rejects document missing schemaVersion with CONFIG_SCHEMA_VERSION_REQUIRED', () => {
    const registry = new MigrationRegistry();
    const docWithoutVersion = { id: 'test', name: 'Test' };

    try {
      registry.migrate(docWithoutVersion, 1);
      expect.unreachable('Should have thrown CONFIG_SCHEMA_VERSION_REQUIRED');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_SCHEMA_VERSION_REQUIRED');
      expect(configErr.path).toBe('schemaVersion');
    }
  });

  it('rejects document with schemaVersion higher than targetVersion with CONFIG_SCHEMA_VERSION_UNSUPPORTED', () => {
    const registry = new MigrationRegistry();
    const futureDoc = { schemaVersion: 5, id: 'future-search' };

    try {
      registry.migrate(futureDoc, 1);
      expect.unreachable('Should have thrown CONFIG_SCHEMA_VERSION_UNSUPPORTED');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_SCHEMA_VERSION_UNSUPPORTED');
      expect(configErr.schemaVersion).toBe(5);
    }
  });

  it('rejects missing migration path with CONFIG_MIGRATION_ERROR', () => {
    const registry = new MigrationRegistry();
    const docV1 = { schemaVersion: 1, id: 'v1-search' };

    try {
      registry.migrate(docV1, 3);
      expect.unreachable('Should have thrown CONFIG_MIGRATION_ERROR');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.code).toBe('CONFIG_MIGRATION_ERROR');
      expect(configErr.message).toContain('No migration path found');
    }
  });

  it('enforces sequential step registration (N -> N+1) and rejects duplicates', () => {
    const registry = new MigrationRegistry();

    // Valid registration
    registry.register({
      fromVersion: 1,
      toVersion: 2,
      migrate: (doc) => ({ ...doc, v2Field: true }),
    });

    // Non-sequential registration (1 -> 3)
    expect(() =>
      registry.register({
        fromVersion: 1,
        toVersion: 3,
        migrate: (doc) => doc,
      }),
    ).toThrow(ConfigurationError);

    // Duplicate registration (1 -> 2)
    expect(() =>
      registry.register({
        fromVersion: 1,
        toVersion: 2,
        migrate: (doc) => doc,
      }),
    ).toThrow(ConfigurationError);
  });

  it('executes deterministic sequential synthetic migrations v1 -> v2 -> v3', () => {
    const registry = new MigrationRegistry();

    registry.register({
      fromVersion: 1,
      toVersion: 2,
      migrate: (doc) => {
        const migrated = { ...doc };
        migrated['legacyQuery'] = migrated['query'];
        delete migrated['query'];
        return migrated;
      },
    });

    registry.register({
      fromVersion: 2,
      toVersion: 3,
      migrate: (doc) => {
        return {
          ...doc,
          migratedToV3: true,
          schemaVersion: 3,
        };
      },
    });

    const initialDoc = {
      schemaVersion: 1,
      id: 'search-migration-test',
      query: 'switch lite',
    };

    const result = registry.migrate(initialDoc, 3);

    expect(result.appliedVersions).toEqual([2, 3]);
    expect(result.document['schemaVersion']).toBe(3);
    expect(result.document['legacyQuery']).toBe('switch lite');
    expect(result.document['query']).toBeUndefined();
    expect(result.document['migratedToV3']).toBe(true);
  });
});
