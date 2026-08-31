export type SqliteStorageErrorCode =
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_CLOSED'
  | 'PRAGMA_CONFIGURATION_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_MANIFEST_INVALID'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_ALREADY_ACTIVE'
  | 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED'
  | 'TRANSACTION_SCOPE_CLOSED'
  | 'INVALID_DATABASE_PATH';

export interface SqliteStorageErrorOptions {
  readonly cause?: unknown;
}

export class SqliteStorageError extends Error {
  readonly code: SqliteStorageErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: SqliteStorageErrorCode, options?: SqliteStorageErrorOptions) {
    super(message);
    this.name = 'SqliteStorageError';
    this.code = code;
    this.cause = options?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DatabaseOpenFailedError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'DATABASE_OPEN_FAILED', options);
    this.name = 'DatabaseOpenFailedError';
  }
}

export class DatabaseClosedError extends SqliteStorageError {
  constructor(
    message = 'Cannot perform operation: SQLite database is closed',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'DATABASE_CLOSED', options);
    this.name = 'DatabaseClosedError';
  }
}

export class PragmaConfigurationError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'PRAGMA_CONFIGURATION_FAILED', options);
    this.name = 'PragmaConfigurationError';
  }
}

export interface MigrationFailedErrorDetails {
  readonly version: number;
  readonly migrationName: string;
}

export class MigrationFailedError extends SqliteStorageError {
  readonly version: number;
  readonly migrationName: string;

  constructor(
    details: MigrationFailedErrorDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Migration ${details.version} ('${details.migrationName}') failed and was rolled back.`;
    super(msg, 'MIGRATION_FAILED', options);
    this.name = 'MigrationFailedError';
    this.version = details.version;
    this.migrationName = details.migrationName;
  }
}

export class MigrationManifestInvalidError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'MIGRATION_MANIFEST_INVALID', options);
    this.name = 'MigrationManifestInvalidError';
  }
}

export interface SchemaVersionUnsupportedDetails {
  readonly foundVersion: number;
  readonly maxSupportedVersion: number;
}

export class SchemaVersionUnsupportedError extends SqliteStorageError {
  readonly foundVersion: number;
  readonly maxSupportedVersion: number;

  constructor(
    details: SchemaVersionUnsupportedDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Database schema version ${details.foundVersion} exceeds maximum version ${details.maxSupportedVersion} supported by this application. Please upgrade Busca Ofertas AI.`;
    super(msg, 'SCHEMA_VERSION_UNSUPPORTED', options);
    this.name = 'SchemaVersionUnsupportedError';
    this.foundVersion = details.foundVersion;
    this.maxSupportedVersion = details.maxSupportedVersion;
  }
}

export type TransactionErrorCode =
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_ALREADY_ACTIVE'
  | 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED'
  | 'TRANSACTION_SCOPE_CLOSED';

export class TransactionFailedError extends SqliteStorageError {
  constructor(
    message: string,
    code: TransactionErrorCode = 'TRANSACTION_FAILED',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, code, options);
    this.name = 'TransactionFailedError';
  }
}

export class TransactionAsyncCallbackUnsupportedError extends SqliteStorageError {
  constructor(
    message = 'Async transaction callbacks are not supported: transaction callback returned a Promise or thenable.',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED', options);
    this.name = 'TransactionAsyncCallbackUnsupportedError';
  }
}

export class TransactionScopeClosedError extends SqliteStorageError {
  constructor(
    message = 'Cannot perform operation: transaction scope has finished and is no longer active.',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'TRANSACTION_SCOPE_CLOSED', options);
    this.name = 'TransactionScopeClosedError';
  }
}

export class InvalidDatabasePathError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'INVALID_DATABASE_PATH', options);
    this.name = 'InvalidDatabasePathError';
  }
}

export function isSqliteStorageError(error: unknown): error is SqliteStorageError {
  return error instanceof SqliteStorageError;
}
