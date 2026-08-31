import { DatabaseSync, type StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DatabaseClosedError,
  DatabaseOpenFailedError,
  InvalidDatabasePathError,
  PragmaConfigurationError,
  TransactionAsyncCallbackUnsupportedError,
  TransactionFailedError,
  TransactionScopeClosedError,
  isSqliteStorageError,
} from '../errors/storage-errors.js';
import { inspectSchemaMigrations, runMigrations } from '../migrations/runner.js';
import type {
  AppliedMigration,
  MigrateOptions,
  Migration,
  MigrationRunResult,
} from '../migrations/types.js';
import type {
  ClockLike,
  OpenSqliteDatabaseOptions,
  SqliteDatabase,
  SqlitePreparedStatement,
  SqliteRunResult,
  SqliteTransaction,
} from './types.js';

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

class SqlitePreparedStatementImpl<
  TResult = Record<string, unknown>,
  TParams extends unknown[] = unknown[],
> implements SqlitePreparedStatement<TResult, TParams> {
  constructor(
    private readonly rawStatement: StatementSync,
    private readonly checkActive: () => void,
  ) {}

  run(...params: TParams): SqliteRunResult {
    this.checkActive();
    const result = this.rawStatement.run(
      ...(params as unknown[] as (string | number | bigint | null | Uint8Array)[]),
    );
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(...params: TParams): TResult | undefined {
    this.checkActive();
    const result = this.rawStatement.get(
      ...(params as unknown[] as (string | number | bigint | null | Uint8Array)[]),
    );
    return result as TResult | undefined;
  }

  all(...params: TParams): readonly TResult[] {
    this.checkActive();
    const result = this.rawStatement.all(
      ...(params as unknown[] as (string | number | bigint | null | Uint8Array)[]),
    );
    return result as unknown as readonly TResult[];
  }
}

class SqliteDatabaseImpl implements SqliteDatabase {
  readonly databasePath: string;
  private rawDb: DatabaseSync | null;
  private inTransaction = false;
  private readonly customMigrations?: readonly Migration[] | undefined;
  private readonly clock: ClockLike;

  constructor(
    databasePath: string,
    rawDb: DatabaseSync,
    options?: {
      readonly customMigrations?: readonly Migration[] | undefined;
      readonly clock?: ClockLike | undefined;
    },
  ) {
    this.databasePath = databasePath;
    this.rawDb = rawDb;
    this.customMigrations = options?.customMigrations;
    this.clock = options?.clock ?? { now: () => new Date() };
  }

  get isOpen(): boolean {
    return this.rawDb !== null;
  }

  private ensureOpen(): DatabaseSync {
    if (this.rawDb === null) {
      throw new DatabaseClosedError();
    }
    return this.rawDb;
  }

  exec(sql: string): void {
    const db = this.ensureOpen();
    db.exec(sql);
  }

  prepare<TResult = Record<string, unknown>, TParams extends unknown[] = unknown[]>(
    sql: string,
  ): SqlitePreparedStatement<TResult, TParams> {
    const db = this.ensureOpen();
    const rawStatement = db.prepare(sql);
    return new SqlitePreparedStatementImpl<TResult, TParams>(rawStatement, () => {
      this.ensureOpen();
    });
  }

  transaction<T>(fn: (tx: SqliteTransaction) => T): T {
    const db = this.ensureOpen();
    if (this.inTransaction) {
      throw new TransactionFailedError(
        'A transaction is already active on this database handle',
        'TRANSACTION_ALREADY_ACTIVE',
      );
    }

    try {
      db.exec('BEGIN');
    } catch (err) {
      this.inTransaction = false;
      throw new TransactionFailedError(
        `Failed to begin transaction: ${err instanceof Error ? err.message : String(err)}`,
        'TRANSACTION_FAILED',
        { cause: err },
      );
    }

    this.inTransaction = true;
    let scopeActive = true;

    const checkScope = (): void => {
      this.ensureOpen();
      if (!scopeActive) {
        throw new TransactionScopeClosedError();
      }
    };

    const txProxy: SqliteTransaction = {
      exec: (sql: string) => {
        checkScope();
        db.exec(sql);
      },
      prepare: <TResult = Record<string, unknown>, TParams extends unknown[] = unknown[]>(
        sql: string,
      ) => {
        checkScope();
        const rawStatement = db.prepare(sql);
        return new SqlitePreparedStatementImpl<TResult, TParams>(rawStatement, checkScope);
      },
    };

    try {
      const result = fn(txProxy);

      if (isThenable(result)) {
        const promiseLike = result as unknown as {
          catch?: (fn: () => void) => unknown;
        };
        if (typeof promiseLike.catch === 'function') {
          promiseLike.catch(() => {});
        }
        try {
          db.exec('ROLLBACK');
        } catch {
          // suppress secondary rollback failure
        }
        throw new TransactionAsyncCallbackUnsupportedError();
      }

      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Rollback failure secondary suppression
      }
      if (isSqliteStorageError(error)) {
        throw error;
      }
      throw new TransactionFailedError(
        `Transaction failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
        'TRANSACTION_FAILED',
        { cause: error },
      );
    } finally {
      scopeActive = false;
      this.inTransaction = false;
    }
  }

  migrate(options?: MigrateOptions): MigrationRunResult {
    this.ensureOpen();
    return runMigrations(this, options, this.customMigrations, this.clock);
  }

  getCurrentSchemaVersion(): number {
    this.ensureOpen();
    const applied = inspectSchemaMigrations(this);
    return applied.length > 0 ? applied[applied.length - 1]!.version : 0;
  }

  getAppliedMigrations(): readonly AppliedMigration[] {
    this.ensureOpen();
    return inspectSchemaMigrations(this);
  }

  close(): void {
    if (this.rawDb === null) {
      return; // Idempotent close
    }
    const db = this.rawDb;
    this.rawDb = null;
    this.inTransaction = false;
    try {
      db.close();
    } catch (error) {
      // In case underlying handle is already closed
      if (error instanceof Error && error.message.includes('not open')) {
        return;
      }
      throw error;
    }
  }
}

export function openSqliteDatabase(options: OpenSqliteDatabaseOptions): SqliteDatabase {
  const { databasePath } = options;

  if (typeof databasePath !== 'string' || databasePath.trim().length === 0) {
    throw new InvalidDatabasePathError('databasePath must be a non-empty string');
  }

  // Validate that path does not point to an existing directory
  if (fs.existsSync(databasePath)) {
    try {
      const stat = fs.statSync(databasePath);
      if (stat.isDirectory()) {
        throw new InvalidDatabasePathError(
          `Database path cannot be an existing directory: ${databasePath}`,
        );
      }
    } catch (err) {
      if (isSqliteStorageError(err)) {
        throw err;
      }
      throw new DatabaseOpenFailedError(
        `Failed to inspect database path: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  } else if (databasePath !== ':memory:') {
    // Optionally create parent directory with restrictive POSIX permissions (0o700)
    if (options.createParentDirectory !== false) {
      const parentDir = path.dirname(databasePath);
      if (parentDir && parentDir !== '.' && !fs.existsSync(parentDir)) {
        try {
          fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
        } catch (err) {
          throw new DatabaseOpenFailedError(
            `Failed to create parent directory for database: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
      }
    }
  }

  let rawDb: DatabaseSync;
  try {
    rawDb = new DatabaseSync(databasePath);
  } catch (err) {
    throw new DatabaseOpenFailedError(
      `Failed to open SQLite database at '${databasePath}': ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  // Enforce secure POSIX file permissions (0o600) on database file
  if (databasePath !== ':memory:' && process.platform !== 'win32') {
    try {
      fs.chmodSync(databasePath, 0o600);
    } catch (err) {
      try {
        rawDb.close();
      } catch {
        // ignore
      }
      throw new DatabaseOpenFailedError(
        `Failed to enforce secure POSIX file permissions (0600) on database file '${databasePath}': ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // Configure and verify PRAGMA foreign_keys = ON
  try {
    rawDb.exec('PRAGMA foreign_keys = ON;');
    const stmt = rawDb.prepare('PRAGMA foreign_keys;');
    const result = stmt.get() as { foreign_keys?: number | bigint } | undefined;
    if (!result || Number(result.foreign_keys) !== 1) {
      rawDb.close();
      throw new PragmaConfigurationError(
        'Failed to enable foreign keys: PRAGMA foreign_keys returned 0',
      );
    }
  } catch (err) {
    try {
      rawDb.close();
    } catch {
      // ignore
    }
    if (isSqliteStorageError(err)) {
      throw err;
    }
    throw new PragmaConfigurationError(
      `Failed to configure SQLite pragmas: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return new SqliteDatabaseImpl(databasePath, rawDb, {
    customMigrations: options.customMigrations,
    clock: options.clock,
  });
}
