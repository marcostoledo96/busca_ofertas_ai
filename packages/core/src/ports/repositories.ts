import { SavedSearch } from '../domain/search/saved-search.js';
import { Listing } from '../domain/listing/listing.js';
import { Observation } from '../domain/listing/observation.js';
import { Opportunity } from '../domain/opportunity/opportunity.js';
import { Evaluation } from '../domain/evaluation/evaluation.js';
import { Feedback } from '../domain/opportunity/feedback.js';
import { Run } from '../domain/run/run.js';
import { SourceRun } from '../domain/run/source-run.js';
import { RawArtifact } from '../domain/artifact/raw-artifact.js';

export interface SavedSearchRevisionRecord {
  readonly id: string;
  readonly savedSearchId: string;
  readonly revisionNumber: number;
  readonly schemaVersion: number;
  readonly recordedAt: Date;
  readonly snapshot: SavedSearch;
}

export interface SavedSearchRepository {
  getById(id: string): Promise<SavedSearch | null>;
  listEnabled(): Promise<readonly SavedSearch[]>;
  save(savedSearch: SavedSearch): Promise<void>;
  listRevisions(savedSearchId: string): Promise<readonly SavedSearchRevisionRecord[]>;
}

export interface ListingRepository {
  getById(id: string): Promise<Listing | null>;
  getBySourceAndExternalId(sourceId: string, externalId: string): Promise<Listing | null>;
  save(listing: Listing): Promise<void>;
}

/**
 * Novelty classification of an observation relative to existing history.
 * - 'NEW': First observation ever recorded for this listing.
 * - 'REAPPEARED': Previous observation was REMOVED/SOLD and current is AVAILABLE/PENDING.
 * - 'PRICE_CHANGED': Semantically relevant price changed from the previous observation.
 * - 'UNCHANGED': No NEW, REAPPEARED, or PRICE_CHANGED condition occurred.
 *   Note: 'UNCHANGED' novelty does NOT mean no observation was stored; if non-price content
 *   (title, condition, location, imageUrls) changed, a new Observation is persisted (isNewObservation = true).
 */
export type ObservationChangeKind = 'NEW' | 'UNCHANGED' | 'PRICE_CHANGED' | 'REAPPEARED';

export interface RecordObservationParams {
  readonly listing: Listing;
  readonly observation: Observation;
}

export interface RecordObservationResult {
  readonly listing: Listing;
  readonly observation: Observation;
  readonly changeKind: ObservationChangeKind;
  readonly isNewObservation: boolean;
}

export interface ObservationRepository {
  getById(id: string): Promise<Observation | null>;
  listByListingId(listingId: string): Promise<readonly Observation[]>;
  listBySourceRunId(sourceRunId: string): Promise<readonly Observation[]>;
  save(observation: Observation): Promise<void>;
  recordObservation(params: RecordObservationParams): Promise<RecordObservationResult>;
}

export interface EvaluationRepository {
  getById(id: string): Promise<Evaluation | null>;
  save(evaluation: Evaluation): Promise<void>;
}

export interface OpportunityRepository {
  getById(id: string): Promise<Opportunity | null>;
  listBySavedSearchId(savedSearchId: string): Promise<readonly Opportunity[]>;
  listByRunId(runId: string): Promise<readonly Opportunity[]>;
  save(opportunity: Opportunity): Promise<void>;
}

export interface FeedbackRepository {
  getById(id: string): Promise<Feedback | null>;
  listByOpportunityId(opportunityId: string): Promise<readonly Feedback[]>;
  save(feedback: Feedback): Promise<void>;
}

export interface RunSummary {
  readonly runId: string;
  readonly totalSourceRuns: number;
  readonly successCount: number;
  readonly zeroResultsCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly totalItemsCount: number;
}

export type SourceRunStopReason =
  | 'ALL_PAGES_FETCHED'
  | 'MAX_PAGES_REACHED'
  | 'MAX_ITEMS_REACHED'
  | 'NO_MORE_RESULTS'
  | 'RATE_LIMIT_STOP'
  | 'USER_ABORTED'
  | 'DEADLINE_EXCEEDED';

export interface SourceRunMetrics {
  readonly pagesRequested?: number;
  readonly pagesCompleted?: number;
  readonly rawItemsCount?: number;
  readonly parsedItemsCount?: number;
  readonly rejectedItemsCount?: number;
  readonly stopReason?: SourceRunStopReason;
}

export interface CompleteSourceRunMetrics {
  readonly pagesRequested: number;
  readonly pagesCompleted: number;
  readonly rawItemsCount: number;
  readonly parsedItemsCount: number;
  readonly rejectedItemsCount: number;
  readonly stopReason: SourceRunStopReason;
}

export interface SourceRunExecutionMetadata {
  readonly adapterVersion: string;
  readonly collectorId?: string;
  readonly metrics?: SourceRunMetrics;
}

export interface RunRepository {
  getById(id: string): Promise<Run | null>;
  save(run: Run): Promise<void>;
  saveSourceRun(sourceRun: SourceRun, metadata: SourceRunExecutionMetadata): Promise<void>;
  listSourceRunsByRunId(runId: string): Promise<readonly SourceRun[]>;
  getSummaryByRunId(runId: string): Promise<RunSummary | null>;
  getSourceRunMetadata(sourceRunId: string): Promise<SourceRunExecutionMetadata | null>;
}

export interface RawArtifactRepository {
  save(artifact: RawArtifact): Promise<void>;
  getById(id: string): Promise<RawArtifact | null>;
  listByRunId(runId: string): Promise<readonly RawArtifact[]>;
  listBySourceRunId(sourceRunId: string): Promise<readonly RawArtifact[]>;
  listExpired(now: Date): Promise<readonly RawArtifact[]>;
  deleteById(id: string): Promise<boolean>;
  getTotalSizeBytesByRunId(runId: string): Promise<number>;
  getCountByRunId(runId: string): Promise<number>;
}
