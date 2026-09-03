import { describe, it, expect } from 'vitest';
import {
  type Clock,
  type IdGenerator,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
  type ListingRepository,
  type ObservationRepository,
  type OpportunityRepository,
  type FeedbackRepository,
  type RunRepository,
  type RunSummary,
  type SourceRunExecutionMetadata,
  type SavedSearch,
  type Listing,
  type Observation,
  type Opportunity,
  type Feedback,
  type Run,
  type SourceRun,
  createListing,
  createObservation,
  createOpportunity,
  createFeedback,
  createSavedSearch,
  createRun,
  createSourceRun,
  createResolvedPrice,
} from '@busca-ofertas-ai/core';

// Test Double / Fake for Clock
class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date) {
    this.currentTime = new Date(initialTime.getTime());
  }

  public now(): Date {
    return new Date(this.currentTime.getTime());
  }

  public advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

// Test Double / Fake for IdGenerator
class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  private readonly prefix: string;

  constructor(prefix = 'id') {
    this.prefix = prefix;
  }

  public generate(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

// In-memory fake implementations for domain repository ports
class InMemoryListingRepository implements ListingRepository {
  private readonly listings = new Map<string, Listing>();

  public getById(id: string): Promise<Listing | null> {
    return Promise.resolve(this.listings.get(id) ?? null);
  }

  public getBySourceAndExternalId(sourceId: string, externalId: string): Promise<Listing | null> {
    for (const listing of this.listings.values()) {
      if (listing.sourceId === sourceId && listing.externalId === externalId) {
        return Promise.resolve(listing);
      }
    }
    return Promise.resolve(null);
  }

  public save(listing: Listing): Promise<void> {
    this.listings.set(listing.id, listing);
    return Promise.resolve();
  }
}

class InMemoryObservationRepository implements ObservationRepository {
  private readonly observations = new Map<string, Observation>();

  public getById(id: string): Promise<Observation | null> {
    return Promise.resolve(this.observations.get(id) ?? null);
  }

  public listByListingId(listingId: string): Promise<readonly Observation[]> {
    const list: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.listingId === listingId) {
        list.push(obs);
      }
    }
    return Promise.resolve(list);
  }

  public save(observation: Observation): Promise<void> {
    this.observations.set(observation.id, observation);
    return Promise.resolve();
  }

  public recordObservation(
    params: import('@busca-ofertas-ai/core').RecordObservationParams,
  ): Promise<import('@busca-ofertas-ai/core').RecordObservationResult> {
    const existing = Array.from(this.observations.values()).filter(
      (o) => o.listingId === params.listing.id,
    );
    const changeKind: import('@busca-ofertas-ai/core').ObservationChangeKind =
      existing.length === 0 ? 'NEW' : 'UNCHANGED';
    this.observations.set(params.observation.id, params.observation);
    return Promise.resolve({
      listing: params.listing,
      observation: params.observation,
      changeKind,
      isNewObservation: true,
    });
  }
}

class InMemorySavedSearchRepository implements SavedSearchRepository {
  private readonly searches = new Map<string, SavedSearch>();
  private readonly revisions = new Map<string, SavedSearchRevisionRecord[]>();

  public getById(id: string): Promise<SavedSearch | null> {
    return Promise.resolve(this.searches.get(id) ?? null);
  }

  public listEnabled(): Promise<readonly SavedSearch[]> {
    const list: SavedSearch[] = [];
    for (const s of this.searches.values()) {
      if (s.enabled) {
        list.push(s);
      }
    }
    return Promise.resolve(list);
  }

  public save(savedSearch: SavedSearch): Promise<void> {
    this.searches.set(savedSearch.id, savedSearch);
    const existingRevs = this.revisions.get(savedSearch.id) ?? [];
    const nextRevNumber = existingRevs.length + 1;
    const record: SavedSearchRevisionRecord = {
      id: `${savedSearch.id}_rev_${nextRevNumber}`,
      savedSearchId: savedSearch.id,
      revisionNumber: nextRevNumber,
      schemaVersion: savedSearch.schemaVersion,
      recordedAt: savedSearch.updatedAt,
      snapshot: savedSearch,
    };
    this.revisions.set(savedSearch.id, [...existingRevs, record]);
    return Promise.resolve();
  }

  public listRevisions(savedSearchId: string): Promise<readonly SavedSearchRevisionRecord[]> {
    return Promise.resolve(this.revisions.get(savedSearchId) ?? []);
  }
}

class InMemoryOpportunityRepository implements OpportunityRepository {
  private readonly opportunities = new Map<string, Opportunity>();

  public getById(id: string): Promise<Opportunity | null> {
    return Promise.resolve(this.opportunities.get(id) ?? null);
  }

  public listBySavedSearchId(savedSearchId: string): Promise<readonly Opportunity[]> {
    const list: Opportunity[] = [];
    for (const opp of this.opportunities.values()) {
      if (opp.savedSearchId === savedSearchId) {
        list.push(opp);
      }
    }
    return Promise.resolve(list);
  }

  public save(opportunity: Opportunity): Promise<void> {
    this.opportunities.set(opportunity.id, opportunity);
    return Promise.resolve();
  }
}

class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly feedbacks = new Map<string, Feedback>();

  public getById(id: string): Promise<Feedback | null> {
    return Promise.resolve(this.feedbacks.get(id) ?? null);
  }

  public listByOpportunityId(opportunityId: string): Promise<readonly Feedback[]> {
    const list: Feedback[] = [];
    for (const fb of this.feedbacks.values()) {
      if (fb.opportunityId === opportunityId) {
        list.push(fb);
      }
    }
    return Promise.resolve(list);
  }

  public save(feedback: Feedback): Promise<void> {
    this.feedbacks.set(feedback.id, feedback);
    return Promise.resolve();
  }
}

class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();
  private readonly sourceRuns: SourceRun[] = [];
  private readonly metadataMap = new Map<string, SourceRunExecutionMetadata>();

  public getById(id: string): Promise<Run | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  public save(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  public saveSourceRun(sourceRun: SourceRun, metadata: SourceRunExecutionMetadata): Promise<void> {
    this.sourceRuns.push(sourceRun);
    this.metadataMap.set(sourceRun.id, metadata);
    return Promise.resolve();
  }

  public listSourceRunsByRunId(runId: string): Promise<readonly SourceRun[]> {
    return Promise.resolve(this.sourceRuns.filter((sr) => sr.runId === runId));
  }

  public getSourceRunMetadata(sourceRunId: string): Promise<SourceRunExecutionMetadata | null> {
    return Promise.resolve(this.metadataMap.get(sourceRunId) ?? null);
  }

  public getSummaryByRunId(runId: string): Promise<RunSummary | null> {
    if (!this.runs.has(runId)) {
      return Promise.resolve(null);
    }
    const matching = this.sourceRuns.filter((sr) => sr.runId === runId);
    const successCount = matching.filter((sr) => sr.status === 'SUCCESS').length;
    const zeroResultsCount = matching.filter((sr) => sr.status === 'ZERO_RESULTS_CONFIRMED').length;
    const cancelledCount = matching.filter((sr) => sr.status === 'CANCELLED').length;
    const failedCount = matching.filter(
      (sr) =>
        !['PENDING', 'RUNNING', 'SUCCESS', 'ZERO_RESULTS_CONFIRMED', 'CANCELLED'].includes(
          sr.status,
        ),
    ).length;
    const totalItemsCount = matching.reduce(
      (acc, sr) =>
        acc + ('itemsCount' in sr && typeof sr.itemsCount === 'number' ? sr.itemsCount : 0),
      0,
    );
    return Promise.resolve({
      runId,
      totalSourceRuns: matching.length,
      successCount,
      zeroResultsCount,
      failedCount,
      cancelledCount,
      totalItemsCount,
    });
  }
}

describe('Domain Ports, Clock and IdGenerator Injectability (BOAI-002)', () => {
  const baseDate = new Date('2026-08-30T12:00:00.000Z');

  it('allows injecting a controllable FakeClock without depending on system time', () => {
    const clock = new FakeClock(baseDate);

    expect(clock.now()).toEqual(baseDate);

    clock.advance(5000);
    expect(clock.now()).toEqual(new Date('2026-08-30T12:00:05.000Z'));
  });

  it('allows injecting a deterministic FakeIdGenerator without depending on UUID libraries or Node crypto', () => {
    const idGen = new FakeIdGenerator('test-entity');

    expect(idGen.generate()).toBe('test-entity-1');
    expect(idGen.generate()).toBe('test-entity-2');
    expect(idGen.generate()).toBe('test-entity-3');
  });

  it('satisfies all minimal repository port contracts with in-memory test doubles', async () => {
    const listingRepo: ListingRepository = new InMemoryListingRepository();
    const obsRepo: ObservationRepository = new InMemoryObservationRepository();
    const searchRepo: SavedSearchRepository = new InMemorySavedSearchRepository();
    const oppRepo: OpportunityRepository = new InMemoryOpportunityRepository();
    const feedbackRepo: FeedbackRepository = new InMemoryFeedbackRepository();
    const runRepo: RunRepository = new InMemoryRunRepository();

    const search = createSavedSearch({
      id: 'search-1',
      schemaVersion: 1,
      name: 'Search 1',
      enabled: true,
      category: 'PRODUCT',
      sourceConfigs: [{ id: 'src-1', enabled: true, queries: ['query'] }],
      query: { terms: ['query'] },
      evaluation: { matchThreshold: 80, reviewThreshold: 40 },
      ai: {
        enabled: false,
        evaluateOnlyReview: true,
        requireConfirmation: true,
        maxEvaluationsPerRun: 1,
      },
      retention: { rawArtifacts: 'ERRORS_AND_REVIEW', rawDataDays: 30 },
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    await searchRepo.save(search);
    const enabledSearches = await searchRepo.listEnabled();
    expect(enabledSearches).toHaveLength(1);

    const listing = createListing({
      id: 'listing-123',
      sourceId: 'facebook-marketplace',
      externalId: 'ext-999',
      canonicalUrl: 'https://example.com/items/999',
      firstSeenAt: baseDate,
      lastSeenAt: baseDate,
    });
    await listingRepo.save(listing);
    expect(await listingRepo.getById('listing-123')).toEqual(listing);

    const observation = createObservation({
      id: 'obs-1',
      listingId: listing.id,
      sourceRunId: 'sr-1',
      observedAt: baseDate,
      title: 'Console',
      price: createResolvedPrice({
        rawText: 'ARS 200000',
        amount: 200000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 1,
        evidence: [],
      }),
      rawFingerprint: 'fp-1',
    });
    await obsRepo.save(observation);
    const obsList = await obsRepo.listByListingId(listing.id);
    expect(obsList).toHaveLength(1);

    const opp = createOpportunity({
      id: 'opp-1',
      savedSearchId: search.id,
      observationId: observation.id,
      evaluationId: 'eval-1',
      novelty: 'NEW',
      createdAt: baseDate,
    });
    await oppRepo.save(opp);
    expect(await oppRepo.getById('opp-1')).toEqual(opp);

    const fb = createFeedback({
      id: 'fb-1',
      opportunityId: opp.id,
      decision: 'CONFIRMED_MATCH',
      createdAt: baseDate,
    });
    await feedbackRepo.save(fb);
    const fbList = await feedbackRepo.listByOpportunityId(opp.id);
    expect(fbList).toHaveLength(1);

    const run = createRun({
      id: 'run-1',
      savedSearchId: search.id,
      status: 'SUCCESS',
      startedAt: baseDate,
      finishedAt: baseDate,
    });
    await runRepo.save(run);
    const sourceRun = createSourceRun({
      id: 'sr-1',
      runId: run.id,
      sourceId: 'src-1',
      status: 'SUCCESS',
      startedAt: baseDate,
      finishedAt: baseDate,
      itemsCount: 1,
    });
    await runRepo.saveSourceRun(sourceRun, { adapterVersion: '1.0.0' });
    const srs = await runRepo.listSourceRunsByRunId('run-1');
    expect(srs).toHaveLength(1);

    const srMeta = await runRepo.getSourceRunMetadata('sr-1');
    expect(srMeta?.adapterVersion).toBe('1.0.0');

    const revs = await searchRepo.listRevisions(search.id);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.snapshot.name).toBe(search.name);
  });
});
