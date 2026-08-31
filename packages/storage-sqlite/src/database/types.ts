import type {
  Migration,
  AppliedMigration,
  MigrateOptions,
  MigrationRunResult,
} from '../migrations/types.js';

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqlitePreparedStatement<
  TResult = Record<string, unknown>,
  TParams extends unknown[] = unknown[],
> {
  run(...params: TParams): SqliteRunResult;
  get(...params: TParams): TResult | undefined;
  all(...params: TParams): readonly TResult[];
}

export interface SqliteTransaction {
  exec(sql: string): void;
  prepare<TResult = Record<string, unknown>, TParams extends unknown[] = unknown[]>(
    sql: string,
  ): SqlitePreparedStatement<TResult, TParams>;
}

export interface SqliteDatabase {
  readonly databasePath: string;
  readonly isOpen: boolean;
  exec(sql: string): void;
  prepare<TResult = Record<string, unknown>, TParams extends unknown[] = unknown[]>(
    sql: string,
  ): SqlitePreparedStatement<TResult, TParams>;
  transaction<T>(fn: (tx: SqliteTransaction) => T): T;
  migrate(options?: MigrateOptions): MigrationRunResult;
  getCurrentSchemaVersion(): number;
  getAppliedMigrations(): readonly AppliedMigration[];
  close(): void;
}

export interface ClockLike {
  now(): Date;
}

export interface OpenSqliteDatabaseOptions {
  readonly databasePath: string;
  readonly clock?: ClockLike | undefined;
  readonly customMigrations?: readonly Migration[] | undefined;
  readonly createParentDirectory?: boolean | undefined;
}
