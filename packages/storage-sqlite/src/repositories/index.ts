import type { SqliteDatabase } from '../database/types.js';
import { SqliteSavedSearchRepository } from './saved-search-repository.js';
import { SqliteRunRepository } from './run-repository.js';
import { SqliteListingRepository } from './listing-repository.js';
import { SqliteObservationRepository } from './observation-repository.js';
import { SqliteEvaluationRepository } from './evaluation-repository.js';
import { SqliteOpportunityRepository } from './opportunity-repository.js';
import { SqliteFeedbackRepository } from './feedback-repository.js';
import { SqliteRawArtifactRepository } from './raw-artifact-repository.js';
import { SqliteExecutionLock } from './execution-lock.js';

export {
  SqliteSavedSearchRepository,
  SqliteRunRepository,
  SqliteListingRepository,
  SqliteObservationRepository,
  SqliteEvaluationRepository,
  SqliteOpportunityRepository,
  SqliteFeedbackRepository,
  SqliteRawArtifactRepository,
  SqliteExecutionLock,
};

export interface SqliteRepositories {
  readonly savedSearches: SqliteSavedSearchRepository;
  readonly runs: SqliteRunRepository;
  readonly listings: SqliteListingRepository;
  readonly observations: SqliteObservationRepository;
  readonly evaluations: SqliteEvaluationRepository;
  readonly opportunities: SqliteOpportunityRepository;
  readonly feedback: SqliteFeedbackRepository;
  readonly rawArtifacts: SqliteRawArtifactRepository;
  readonly executionLock: SqliteExecutionLock;
}

export function createSqliteRepositories(db: SqliteDatabase): SqliteRepositories {
  return {
    savedSearches: new SqliteSavedSearchRepository(db),
    runs: new SqliteRunRepository(db),
    listings: new SqliteListingRepository(db),
    observations: new SqliteObservationRepository(db),
    evaluations: new SqliteEvaluationRepository(db),
    opportunities: new SqliteOpportunityRepository(db),
    feedback: new SqliteFeedbackRepository(db),
    rawArtifacts: new SqliteRawArtifactRepository(db),
    executionLock: new SqliteExecutionLock(db),
  };
}
