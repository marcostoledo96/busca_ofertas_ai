import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as StorageModule from '@busca-ofertas-ai/storage-sqlite';
import * as StorageTesting from '@busca-ofertas-ai/storage-sqlite/testing';

interface PackageJsonShape {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

describe('Storage SQLite Architecture & Module Boundaries (BOAI-010)', () => {
  it('exports pure storage contracts, factories, error types, and migration runner from main entrypoint', () => {
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
    expect(typeof StorageModule.InvalidDatabasePathError).toBe('function');

    // Constants
    expect(StorageModule.STORAGE_SQLITE_PACKAGE_NAME).toBe('@busca-ofertas-ai/storage-sqlite');
    expect(StorageModule.SCHEMA_MIGRATIONS_TABLE_NAME).toBe('schema_migrations');
    expect(Array.isArray(StorageModule.PRODUCTION_MIGRATIONS)).toBe(true);
    expect(StorageModule.PRODUCTION_MIGRATIONS.length).toBe(1);
    expect(StorageModule.PRODUCTION_MIGRATIONS[0]!.version).toBe(1);
    expect(StorageModule.PRODUCTION_MIGRATIONS[0]!.name).toBe('001_create_schema_migrations');
  });

  it('exports test helper utilities from testing entrypoint', () => {
    expect(typeof StorageTesting.createTempDatabaseContext).toBe('function');
    expect(typeof StorageTesting.withTempDatabase).toBe('function');
  });

  it('declares 0 runtime dependencies in packages/storage-sqlite/package.json', () => {
    const pkgPath = path.resolve('packages/storage-sqlite/package.json');
    const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJsonShape;

    expect(pkgContent.name).toBe('@busca-ofertas-ai/storage-sqlite');
    expect(pkgContent.dependencies).toBeUndefined();
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
