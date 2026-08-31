/**
 * @busca-ofertas-ai/storage-sqlite
 *
 * Local-first SQLite persistence foundation and migration engine.
 * Pure TypeScript, synchronous, transactional, with zero external runtime dependencies.
 */

// Error hierarchy
export {
  type SqliteStorageErrorCode,
  type SqliteStorageErrorOptions,
  type MigrationFailedErrorDetails,
  type SchemaVersionUnsupportedDetails,
  SqliteStorageError,
  DatabaseOpenFailedError,
  DatabaseClosedError,
  PragmaConfigurationError,
  MigrationFailedError,
  MigrationManifestInvalidError,
  SchemaVersionUnsupportedError,
  TransactionFailedError,
  InvalidDatabasePathError,
  isSqliteStorageError,
} from './errors/index.js';

// Database contracts and factory
export {
  type SqliteRunResult,
  type SqlitePreparedStatement,
  type SqliteTransaction,
  type SqliteDatabase,
  type ClockLike,
  type OpenSqliteDatabaseOptions,
  openSqliteDatabase,
} from './database/index.js';

// Migration contracts and runner
export {
  type MigrationContext,
  type Migration,
  type AppliedMigration,
  type MigrateOptions,
  type MigrationRunResult,
  SCHEMA_MIGRATIONS_TABLE_NAME,
  PRODUCTION_MIGRATIONS,
  migration001,
  validateMigrationManifest,
  inspectSchemaMigrations,
  runMigrations,
} from './migrations/index.js';

// Package Metadata
export const STORAGE_SQLITE_PACKAGE_NAME = '@busca-ofertas-ai/storage-sqlite' as const;

export interface StorageSqlitePackageMetadata {
  readonly name: typeof STORAGE_SQLITE_PACKAGE_NAME;
  readonly initialized: boolean;
}

export const getStorageSqlitePackageMetadata = (): StorageSqlitePackageMetadata => ({
  name: STORAGE_SQLITE_PACKAGE_NAME,
  initialized: true,
});
