import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as StorageModule from '@busca-ofertas-ai/storage-sqlite';
import * as StorageTesting from '@busca-ofertas-ai/storage-sqlite/testing';

interface PackageJsonShape {
  readonly name?: string;
  readonly engines?: {
    readonly node?: string;
    readonly pnpm?: string;
  };
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

describe('Storage SQLite Architecture & Module Boundaries (BOAI-010 & BOAI-011)', () => {
  it('exports pure storage contracts, factories, error types, repositories, and migration runner from main entrypoint', () => {
    expect(typeof StorageModule.openSqliteDatabase).toBe('function');
    expect(typeof StorageModule.runMigrations).toBe('function');
    expect(typeof StorageModule.inspectSchemaMigrations).toBe('function');
    expect(typeof StorageModule.validateMigrationManifest).toBe('function');
    expect(typeof StorageModule.getStorageSqlitePackageMetadata).toBe('function');
    expect(typeof StorageModule.isSqliteStorageError).toBe('function');

    // Error constructors
    expect(typeof StorageModule.SqliteStorageError).toBe('function');
    expect(typeof StorageModule.DatabaseOpenFailedError).toBe('function');
    expect(typeof StorageModule.DatabaseClosedError).toBe('function');
    expect(typeof StorageModule.PragmaConfigurationError).toBe('function');
    expect(typeof StorageModule.MigrationFailedError).toBe('function');
    expect(typeof StorageModule.MigrationManifestInvalidError).toBe('function');
    expect(typeof StorageModule.SchemaVersionUnsupportedError).toBe('function');
    expect(typeof StorageModule.TransactionFailedError).toBe('function');
    expect(typeof StorageModule.TransactionAsyncCallbackUnsupportedError).toBe('function');
    expect(typeof StorageModule.TransactionScopeClosedError).toBe('function');
    expect(typeof StorageModule.InvalidDatabasePathError).toBe('function');
    expect(typeof StorageModule.StorageCorruptionError).toBe('function');
    expect(typeof StorageModule.ExecutionLockHeldError).toBe('function');
    expect(typeof StorageModule.ExecutionLockReleaseError).toBe('function');
    expect(typeof StorageModule.ListingIdentityCollisionError).toBe('function');
    expect(typeof StorageModule.ObservationIdentityCollisionError).toBe('function');
    expect(typeof StorageModule.ObservationFingerprintCollisionError).toBe('function');
    expect(typeof StorageModule.RecordObservationCoherenceError).toBe('function');
    expect(typeof StorageModule.SensitiveDataDetectedError).toBe('function');

    // Crypto
    expect(typeof StorageModule.NodeCryptoHasher).toBe('function');
    expect(typeof StorageModule.createNodeCryptoHasher).toBe('function');

    // Sanitizer
    expect(typeof StorageModule.sanitizeString).toBe('function');
    expect(typeof StorageModule.sanitizeErrorMessage).toBe('function');
    expect(typeof StorageModule.sanitizeObject).toBe('function');
    expect(StorageModule.REDACTED_PLACEHOLDER).toBe('[REDACTED]');

    // Repositories and factory
    expect(typeof StorageModule.SqliteSavedSearchRepository).toBe('function');
    expect(typeof StorageModule.SqliteRunRepository).toBe('function');
    expect(typeof StorageModule.SqliteListingRepository).toBe('function');
    expect(typeof StorageModule.SqliteObservationRepository).toBe('function');
    expect(typeof StorageModule.SqliteExecutionLock).toBe('function');
    expect(typeof StorageModule.createSqliteRepositories).toBe('function');

    // Constants & Migrations
    expect(StorageModule.STORAGE_SQLITE_PACKAGE_NAME).toBe('@busca-ofertas-ai/storage-sqlite');
    expect(StorageModule.SCHEMA_MIGRATIONS_TABLE_NAME).toBe('schema_migrations');
    expect(Array.isArray(StorageModule.PRODUCTION_MIGRATIONS)).toBe(true);
    expect(StorageModule.PRODUCTION_MIGRATIONS.length).toBe(3);
    expect(StorageModule.PRODUCTION_MIGRATIONS[0]!.version).toBe(1);
    expect(StorageModule.PRODUCTION_MIGRATIONS[0]!.name).toBe('001_create_schema_migrations');
    expect(StorageModule.PRODUCTION_MIGRATIONS[1]!.version).toBe(2);
    expect(StorageModule.PRODUCTION_MIGRATIONS[1]!.name).toBe('002_create_operational_persistence');
    expect(StorageModule.PRODUCTION_MIGRATIONS[2]!.version).toBe(3);
    expect(StorageModule.PRODUCTION_MIGRATIONS[2]!.name).toBe('003_create_observation_history');
  });

  it('guarantees runtime immutability of the production migration manifest', () => {
    expect(Object.isFrozen(StorageModule.PRODUCTION_MIGRATIONS)).toBe(true);
    expect(Object.isFrozen(StorageModule.PRODUCTION_MIGRATIONS[0])).toBe(true);
    expect(Object.isFrozen(StorageModule.PRODUCTION_MIGRATIONS[1])).toBe(true);
    expect(Object.isFrozen(StorageModule.PRODUCTION_MIGRATIONS[2])).toBe(true);

    // Attempting to push to frozen array must throw in strict mode
    expect(() => {
      (StorageModule.PRODUCTION_MIGRATIONS as unknown as unknown[]).push({
        version: 99,
        name: 'mutated',
        up: () => {},
      });
    }).toThrow();

    // Attempting to mutate descriptor properties must throw in strict mode
    expect(() => {
      (
        StorageModule.PRODUCTION_MIGRATIONS[0] as unknown as {
          version: number;
        }
      ).version = 999;
    }).toThrow();
  });

  it('declares Node.js >= 22.13.0 engine requirement for standard unflagged node:sqlite support', () => {
    const rootPkgPath = path.resolve('package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8')) as PackageJsonShape;

    expect(rootPkg.engines?.node).toBeDefined();
    const engineNode = rootPkg.engines!.node!;
    expect(engineNode).toMatch(/>=\s*22\.13\.0/);

    const match = />=\s*(\d+)\.(\d+)\.(\d+)/.exec(engineNode);
    expect(match).not.toBeNull();
    const [, major, minor] = match!;
    const majorNum = Number(major);
    const minorNum = Number(minor);

    expect(majorNum >= 22).toBe(true);
    if (majorNum === 22) {
      expect(minorNum >= 13).toBe(true);
    }
  });

  it('exports test helper utilities from testing entrypoint', () => {
    expect(typeof StorageTesting.createTempDatabaseContext).toBe('function');
    expect(typeof StorageTesting.withTempDatabase).toBe('function');
  });

  it('declares 0 external third-party runtime dependencies in packages/storage-sqlite/package.json', () => {
    const pkgPath = path.resolve('packages/storage-sqlite/package.json');
    const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJsonShape;

    expect(pkgContent.name).toBe('@busca-ofertas-ai/storage-sqlite');
    // Only internal workspace dependencies are allowed (@busca-ofertas-ai/core)
    const externalDeps = Object.keys(pkgContent.dependencies ?? {}).filter(
      (dep) => !dep.startsWith('@busca-ofertas-ai/'),
    );
    expect(externalDeps).toEqual([]);
  });

  it('verifies that core, configuration, adapter-sdk, and cli do not depend on storage-sqlite', () => {
    const corePkg = JSON.parse(
      fs.readFileSync(path.resolve('packages/core/package.json'), 'utf-8'),
    ) as PackageJsonShape;
    const configPkg = JSON.parse(
      fs.readFileSync(path.resolve('packages/configuration/package.json'), 'utf-8'),
    ) as PackageJsonShape;
    const sdkPkg = JSON.parse(
      fs.readFileSync(path.resolve('packages/adapter-sdk/package.json'), 'utf-8'),
    ) as PackageJsonShape;
    const cliPkg = JSON.parse(
      fs.readFileSync(path.resolve('apps/cli/package.json'), 'utf-8'),
    ) as PackageJsonShape;

    expect(corePkg.dependencies?.['@busca-ofertas-ai/storage-sqlite']).toBeUndefined();
    expect(configPkg.dependencies?.['@busca-ofertas-ai/storage-sqlite']).toBeUndefined();
    expect(sdkPkg.dependencies?.['@busca-ofertas-ai/storage-sqlite']).toBeUndefined();
    expect(cliPkg.dependencies?.['@busca-ofertas-ai/storage-sqlite']).toBeUndefined();
  });
});
