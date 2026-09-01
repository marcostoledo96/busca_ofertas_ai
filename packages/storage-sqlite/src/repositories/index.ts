import type { SqliteDatabase } from '../database/types.js';
import { SqliteSavedSearchRepository } from './saved-search-repository.js';
import { SqliteRunRepository } from './run-repository.js';
import { SqliteListingRepository } from './listing-repository.js';
import { SqliteExecutionLock } from './execution-lock.js';

export {
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  SqliteListingRepository,
  SqliteExecutionLock,
};

export interface SqliteRepositories {
  readonly savedSearches: SqliteSavedSearchRepository;
  readonly runs: SqliteRunRepository;
  readonly listings: SqliteListingRepository;
  readonly executionLock: SqliteExecutionLock;
}

export function createSqliteRepositories(db: SqliteDatabase): SqliteRepositories {
  return {
    savedSearches: new SqliteSavedSearchRepository(db),
    runs: new SqliteRunRepository(db),
    listings: new SqliteListingRepository(db),
    executionLock: new SqliteExecutionLock(db),
  };
}
