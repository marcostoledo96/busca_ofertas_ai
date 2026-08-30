import { describe, it, expect } from 'vitest';
import {
  createResolvedPrice,
  createEvaluationReason,
  createEvaluation,
  createListing,
  createObservation,
  createOpportunity,
  createFeedback,
  createSavedSearch,
  createRun,
  createSourceRun,
  createSourceHealth,
} from '@busca-ofertas-ai/core';

describe('Domain Construction & Value Objects (BOAI-002)', () => {
  const baseDate = new Date('2026-08-30T20:00:00.000Z');

  it('should construct a valid ResolvedPrice with explicit currency', () => {
    const price = createResolvedPrice({
      rawText: 'ARS 250.000',
      amount: 250000,
      currency: 'ARS',
      resolution: 'EXPLICIT',
      confidence: 1.0,
      evidence: ['explicit currency code in text'],
      kind: 'TOTAL',
    });

    expect(price.rawText).toBe('ARS 250.000');
    expect(price.amount).toBe(250000);
    expect(price.currency).toBe('ARS');
    expect(price.resolution).toBe('EXPLICIT');
    expect(price.confidence).toBe(1.0);
    expect(price.evidence).toEqual(['explicit currency code in text']);
    expect(price.kind).toBe('TOTAL');
    expect(price.converted).toBeUndefined();
  });

  it('should construct a valid ResolvedPrice with USD and manual conversion', () => {
    const price = createResolvedPrice({
      rawText: 'USD 300',
      amount: 300,
      currency: 'USD',
      resolution: 'EXPLICIT',
      confidence: 0.95,
      evidence: ['explicit USD prefix'],
      kind: 'TOTAL',
      converted: {
        amount: 390000,
        currency: 'ARS',
        exchangeRate: 1300,
        exchangeRateOrigin: 'MANUAL',
        convertedAt: baseDate,
      },
    });

    expect(price.currency).toBe('USD');
    expect(price.converted?.amount).toBe(390000);
    expect(price.converted?.currency).toBe('ARS');
    expect(price.converted?.exchangeRate).toBe(1300);
  });

  it('should construct a valid Evaluation with reasons and valid score', () => {
    const reason = createEvaluationReason({
      code: 'PRICE_WITHIN_RANGE',
      message: 'The price is below the maximum configured threshold',
      impact: 20,
      severity: 'INFO',
      evidence: 'amount=250000 <= max=300000',
    });

    const evaluation = createEvaluation({
      id: 'eval-1',
      decision: 'MATCH',
      score: 85,
      reasons: [reason],
      evaluatedBy: ['RULES'],
      policyVersion: 'v1.0.0',
      createdAt: baseDate,
    });

    expect(evaluation.id).toBe('eval-1');
    expect(evaluation.decision).toBe('MATCH');
    expect(evaluation.score).toBe(85);
    expect(evaluation.reasons).toHaveLength(1);
    expect(evaluation.reasons[0]?.code).toBe('PRICE_WITHIN_RANGE');
    expect(evaluation.evaluatedBy).toEqual(['RULES']);
  });

  it('should construct a canonical Listing and preserve identity', () => {
    const listing = createListing({
      id: 'list-1',
      sourceId: 'facebook-marketplace',
      externalId: '1234567890',
      canonicalUrl: 'https://www.facebook.com/marketplace/item/1234567890',
      firstSeenAt: baseDate,
      lastSeenAt: new Date(baseDate.getTime() + 3600000),
    });

    expect(listing.id).toBe('list-1');
    expect(listing.sourceId).toBe('facebook-marketplace');
    expect(listing.externalId).toBe('1234567890');
    expect(listing.lastSeenAt.getTime()).toBeGreaterThan(listing.firstSeenAt.getTime());
  });

  it('should construct an Observation referencing a Listing and SourceRun', () => {
    const price = createResolvedPrice({
      rawText: '$ 250.000',
      amount: 250000,
      currency: 'ARS',
      resolution: 'SOURCE_METADATA',
      confidence: 0.9,
      evidence: ['metadata currency ARS'],
    });

    const observation = createObservation({
      id: 'obs-1',
      listingId: 'list-1',
      sourceRunId: 'src-run-1',
      observedAt: baseDate,
      title: 'Nintendo Switch Lite Turquesa impecable',
      description: 'Caja original y cargador oficial.',
      price,
      location: {
        rawText: 'Palermo, CABA',
        region: 'AMBA',
        city: 'Buenos Aires',
        neighborhood: 'Palermo',
      },
      condition: 'LIKE_NEW',
      availability: 'AVAILABLE',
      imageUrls: ['https://example.com/img1.jpg'],
      rawFingerprint: 'sha256-fingerprint-abc',
    });

    expect(observation.id).toBe('obs-1');
    expect(observation.listingId).toBe('list-1');
    expect(observation.sourceRunId).toBe('src-run-1');
    expect(observation.title).toBe('Nintendo Switch Lite Turquesa impecable');
    expect(observation.condition).toBe('LIKE_NEW');
    expect(observation.availability).toBe('AVAILABLE');
    expect(observation.imageUrls).toHaveLength(1);
  });

  it('should construct an Opportunity linking SavedSearch, Observation and Evaluation', () => {
    const opportunity = createOpportunity({
      id: 'opp-1',
      savedSearchId: 'search-switch-lite',
      observationId: 'obs-1',
      evaluationId: 'eval-1',
      novelty: 'NEW',
      createdAt: baseDate,
    });

    expect(opportunity.id).toBe('opp-1');
    expect(opportunity.savedSearchId).toBe('search-switch-lite');
    expect(opportunity.observationId).toBe('obs-1');
    expect(opportunity.evaluationId).toBe('eval-1');
    expect(opportunity.novelty).toBe('NEW');
  });

  it('should construct a Feedback for an evaluated opportunity', () => {
    const feedback = createFeedback({
      id: 'fb-1',
      opportunityId: 'opp-1',
      decision: 'CONFIRMED_MATCH',
      notes: 'Excellent deal, purchased.',
      createdAt: baseDate,
    });

    expect(feedback.id).toBe('fb-1');
    expect(feedback.opportunityId).toBe('opp-1');
    expect(feedback.decision).toBe('CONFIRMED_MATCH');
    expect(feedback.notes).toBe('Excellent deal, purchased.');
  });

  it('should construct a SavedSearch aggregate with complete policies', () => {
    const savedSearch = createSavedSearch({
      id: 'search-switch-lite',
      schemaVersion: 1,
      name: 'Nintendo Switch Lite en AMBA',
      enabled: true,
      category: 'PRODUCT',
      sourceConfigs: [
        {
          id: 'facebook-marketplace',
          enabled: true,
          queries: ['Nintendo Switch Lite', 'Switch Lite'],
        },
      ],
      query: {
        terms: ['Nintendo Switch Lite', 'Switch Lite'],
        excludedTerms: ['funda', 'carcasa'],
      },
      price: {
        targetCurrency: 'ARS',
        maximum: 250000,
        minimumPlausible: 100000,
        foreignCurrency: {
          mode: 'MANUAL_RATE',
          onUnknown: 'REVIEW',
        },
      },
      location: {
        mode: 'REGION',
        region: 'AMBA',
        radiusKm: 80,
      },
      condition: {
        accepted: ['NEW', 'LIKE_NEW', 'GOOD'],
      },
      evaluation: {
        matchThreshold: 80,
        reviewThreshold: 40,
        precisionProfile: 'MIXED',
      },
      ai: {
        enabled: false,
        evaluateOnlyReview: true,
        requireConfirmation: true,
        maxEvaluationsPerRun: 5,
      },
      retention: {
        rawArtifacts: 'ERRORS_AND_REVIEW',
        rawDataDays: 30,
      },
      createdAt: baseDate,
      updatedAt: baseDate,
    });

    expect(savedSearch.id).toBe('search-switch-lite');
    expect(savedSearch.category).toBe('PRODUCT');
    expect(savedSearch.sourceConfigs).toHaveLength(1);
    expect(savedSearch.evaluation.matchThreshold).toBe(80);
    expect(savedSearch.evaluation.reviewThreshold).toBe(40);
  });

  it('should construct Run and SourceRun instances with valid states', () => {
    const run = createRun({
      id: 'run-1',
      savedSearchId: 'search-switch-lite',
      status: 'RUNNING',
      startedAt: baseDate,
    });

    const sourceRun = createSourceRun({
      id: 'src-run-1',
      runId: 'run-1',
      sourceId: 'facebook-marketplace',
      collectorId: 'facebook-graphql',
      status: 'SUCCESS',
      startedAt: baseDate,
      finishedAt: new Date(baseDate.getTime() + 5000),
      itemsCount: 15,
    });

    expect(run.status).toBe('RUNNING');
    expect(sourceRun.runId).toBe('run-1');
    expect(sourceRun.status).toBe('SUCCESS');
    if (sourceRun.status === 'SUCCESS') {
      expect(sourceRun.itemsCount).toBe(15);
    }
  });

  it('should construct SourceHealth check evidence', () => {
    const health = createSourceHealth({
      sourceId: 'facebook-marketplace',
      status: 'HEALTHY',
      checkedAt: baseDate,
      evidence: ['marketplace endpoint responded 200 OK', 'session valid'],
    });

    expect(health.sourceId).toBe('facebook-marketplace');
    expect(health.status).toBe('HEALTHY');
    expect(health.evidence).toHaveLength(2);
  });
});
