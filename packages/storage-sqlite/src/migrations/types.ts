import type { SqlitePreparedStatement } from '../database/types.js';

export interface MigrationContext {
  exec(sql: string): void;
  prepare<TResult = Record<string, unknown>, TParams extends unknown[] = unknown[]>(
    sql: string,
  ): SqlitePreparedStatement<TResult, TParams>;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(context: MigrationContext): void;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string;
}

export interface MigrateOptions {
  readonly targetVersion?: number | undefined;
}

export interface MigrationRunResult {
  readonly previousVersion: number;
  readonly currentVersion: number;
  readonly appliedMigrations: readonly AppliedMigration[];
  readonly newlyAppliedCount: number;
}
