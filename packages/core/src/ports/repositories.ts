import { SavedSearch } from '../domain/search/saved-search.js';
import { Listing } from '../domain/listing/listing.js';
import { Observation } from '../domain/listing/observation.js';
import { Opportunity } from '../domain/opportunity/opportunity.js';
import { Feedback } from '../domain/opportunity/feedback.js';
import { Run } from '../domain/run/run.js';
import { SourceRun } from '../domain/run/source-run.js';

export interface SavedSearchRepository {
  getById(id: string): Promise<SavedSearch | null>;
  listEnabled(): Promise<readonly SavedSearch[]>;
  save(savedSearch: SavedSearch): Promise<void>;
}

export interface ListingRepository {
  getById(id: string): Promise<Listing | null>;
  getBySourceAndExternalId(sourceId: string, externalId: string): Promise<Listing | null>;
  save(listing: Listing): Promise<void>;
}

export interface ObservationRepository {
  getById(id: string): Promise<Observation | null>;
  listByListingId(listingId: string): Promise<readonly Observation[]>;
  save(observation: Observation): Promise<void>;
}

export interface OpportunityRepository {
  getById(id: string): Promise<Opportunity | null>;
  listBySavedSearchId(savedSearchId: string): Promise<readonly Opportunity[]>;
  save(opportunity: Opportunity): Promise<void>;
}

export interface FeedbackRepository {
  getById(id: string): Promise<Feedback | null>;
  listByOpportunityId(opportunityId: string): Promise<readonly Feedback[]>;
  save(feedback: Feedback): Promise<void>;
}

export interface RunRepository {
  getById(id: string): Promise<Run | null>;
  save(run: Run): Promise<void>;
  saveSourceRun(sourceRun: SourceRun): Promise<void>;
  listSourceRunsByRunId(runId: string): Promise<readonly SourceRun[]>;
}
