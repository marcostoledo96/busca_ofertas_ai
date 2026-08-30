import { describe, it, expect } from 'vitest';
import {
  createListing,
  createObservation,
  createOpportunity,
  createResolvedPrice,
  createRun,
  createSourceRun,
} from '@busca-ofertas-ai/core';

describe('Domain Ubiquitous Language & Semantics (BOAI-002)', () => {
  const t0 = new Date('2026-08-30T18:00:00.000Z');
  const t1 = new Date('2026-08-30T19:00:00.000Z');
  const t2 = new Date('2026-08-30T20:00:00.000Z');

  describe('Listing vs Observation', () => {
    it('preserves canonical Listing identity across multiple Observations representing price and condition updates', () => {
      // 1. Canonical Listing is created when first discovered
      const listing = createListing({
        id: 'canonical-listing-fb-9988',
        sourceId: 'facebook-marketplace',
        externalId: 'item-fb-9988',
        canonicalUrl: 'https://www.facebook.com/marketplace/item/9988',
        firstSeenAt: t0,
        lastSeenAt: t2,
      });

      // 2. Initial Observation at t0 (Price $250.000)
      const observationT0 = createObservation({
        id: 'obs-t0',
        listingId: listing.id,
        sourceRunId: 'source-run-1',
        observedAt: t0,
        title: 'Nintendo Switch Lite Coral',
        description: 'En caja con cargador',
        price: createResolvedPrice({
          rawText: 'ARS 250000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1.0,
          evidence: ['explicit ARS'],
        }),
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        rawFingerprint: 'fp-t0',
      });

      // 3. Subsequent Observation at t1 (Price dropped to $220.000)
      const observationT1 = createObservation({
        id: 'obs-t1',
        listingId: listing.id,
        sourceRunId: 'source-run-2',
        observedAt: t1,
        title: 'Nintendo Switch Lite Coral - REBAJADA',
        description: 'Rebajada hoy por viaje!',
        price: createResolvedPrice({
          rawText: 'ARS 220000',
          amount: 220000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1.0,
          evidence: ['explicit ARS'],
        }),
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        rawFingerprint: 'fp-t1',
      });

      // Assertions
      expect(listing.id).toBe('canonical-listing-fb-9988');
      expect(observationT0.listingId).toBe(listing.id);
      expect(observationT1.listingId).toBe(listing.id);
      expect(observationT0.id).not.toBe(observationT1.id);
      expect(observationT0.price?.amount).toBe(250000);
      expect(observationT1.price?.amount).toBe(220000);
      expect(observationT0.observedAt).toEqual(t0);
      expect(observationT1.observedAt).toEqual(t1);
    });
  });

  describe('Opportunity vs Listing & SavedSearch Context', () => {
    it('allows the same Observation/Listing to be evaluated under distinct SavedSearches with separate Opportunity entities', () => {
      const listing = createListing({
        id: 'list-switch-100',
        sourceId: 'facebook-marketplace',
        externalId: '100',
        canonicalUrl: 'https://example.com/100',
        firstSeenAt: t0,
        lastSeenAt: t0,
      });

      const observation = createObservation({
        id: 'obs-switch-100',
        listingId: listing.id,
        sourceRunId: 'src-run-1',
        observedAt: t0,
        title: 'Nintendo Switch Lite Gray with Pokemon Sword',
        price: createResolvedPrice({
          rawText: 'ARS 240000',
          amount: 240000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1.0,
          evidence: ['explicit ARS'],
        }),
        condition: 'GOOD',
        availability: 'AVAILABLE',
        rawFingerprint: 'fp-100',
      });

      // Search A: General Switch Lite search
      const opportunitySearchA = createOpportunity({
        id: 'opp-search-general-1',
        savedSearchId: 'saved-search-general',
        observationId: observation.id,
        evaluationId: 'eval-search-general-1',
        novelty: 'NEW',
        createdAt: t0,
      });

      // Search B: Search specifically for Coral/Turquoise (different criteria)
      const opportunitySearchB = createOpportunity({
        id: 'opp-search-colors-1',
        savedSearchId: 'saved-search-colors',
        observationId: observation.id,
        evaluationId: 'eval-search-colors-1',
        novelty: 'NEW',
        createdAt: t0,
      });

      expect(opportunitySearchA.observationId).toBe(observation.id);
      expect(opportunitySearchB.observationId).toBe(observation.id);
      expect(opportunitySearchA.savedSearchId).not.toBe(opportunitySearchB.savedSearchId);
      expect(opportunitySearchA.id).not.toBe(opportunitySearchB.id);
    });
  });

  describe('Run vs SourceRun', () => {
    it('distinguishes global Run execution from granular SourceRun outcomes (e.g. ZERO_RESULTS_CONFIRMED vs RATE_LIMITED)', () => {
      const globalRun = createRun({
        id: 'run-global-10',
        savedSearchId: 'search-switch-lite',
        status: 'PARTIAL_SUCCESS',
        startedAt: t0,
        finishedAt: t1,
      });

      // Source 1 succeeded with zero results confirmed (not an error)
      const sourceRun1 = createSourceRun({
        id: 'source-run-fb',
        runId: globalRun.id,
        sourceId: 'facebook-marketplace',
        collectorId: 'facebook-graphql',
        status: 'ZERO_RESULTS_CONFIRMED',
        startedAt: t0,
        finishedAt: new Date(t0.getTime() + 2000),
        itemsCount: 0,
      });

      // Source 2 encountered rate limit
      const sourceRun2 = createSourceRun({
        id: 'source-run-ml',
        runId: globalRun.id,
        sourceId: 'mercadolibre',
        collectorId: 'ml-rest-api',
        status: 'RATE_LIMITED',
        startedAt: t0,
        finishedAt: new Date(t0.getTime() + 1000),
        error: 'HTTP 429 Too Many Requests: Rate limit exceeded',
      });

      expect(globalRun.status).toBe('PARTIAL_SUCCESS');
      expect(sourceRun1.status).toBe('ZERO_RESULTS_CONFIRMED');
      expect(sourceRun1.itemsCount).toBe(0);
      expect(sourceRun2.status).toBe('RATE_LIMITED');
      expect(sourceRun2.error).toContain('HTTP 429');
    });
  });
});
