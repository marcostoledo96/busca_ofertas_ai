import { describe, it, expect } from 'vitest';
import {
  type ReviewItem,
  detectRuleSuggestions,
  createObservation,
  createResolvedPrice,
  createListing,
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  createFeedback,
} from '@busca-ofertas-ai/core';

describe('detectRuleSuggestions (BOAI-015)', () => {
  function makeMockReviewItem(
    oppId: string,
    searchId: string,
    reasonCode: string,
    feedbackDecision: 'CONFIRMED_MATCH' | 'FALSE_POSITIVE' | 'NOT_INTERESTED',
  ): ReviewItem {
    const opp = createOpportunity({
      id: oppId,
      savedSearchId: searchId,
      observationId: `obs-${oppId}`,
      evaluationId: `eval-${oppId}`,
      novelty: 'NEW',
      createdAt: new Date('2026-09-03T12:00:00.000Z'),
    });

    const obs = createObservation({
      id: `obs-${oppId}`,
      listingId: `list-${oppId}`,
      sourceRunId: 'sr-1',
      observedAt: new Date('2026-09-03T12:00:00.000Z'),
      title: `Item ${oppId}`,
      price: createResolvedPrice({
        rawText: '$100.000',
        amount: 100000,
        currency: 'ARS',
        resolution: 'EXPLICIT',
        confidence: 1.0,
        evidence: ['$100.000'],
        kind: 'TOTAL',
      }),
      location: { rawText: 'Palermo' },
      availability: 'AVAILABLE',
      imageUrls: [],
      rawFingerprint: `fp-${oppId}`,
    });

    const listing = createListing({
      id: `list-${oppId}`,
      sourceId: 'synth',
      externalId: `ext-${oppId}`,
      canonicalUrl: `https://example.com/${oppId}`,
      firstSeenAt: new Date('2026-09-03T12:00:00.000Z'),
      lastSeenAt: new Date('2026-09-03T12:00:00.000Z'),
    });

    const evaluation = createEvaluation({
      id: `eval-${oppId}`,
      decision: 'REVIEW',
      score: 65,
      reasons: [
        createEvaluationReason({
          code: reasonCode,
          message: 'Doubtful listing',
          severity: 'SOFT',
          impact: -35,
        }),
      ],
      evaluatedBy: ['RULES'],
      policyVersion: 'v1.0.0',
      createdAt: new Date('2026-09-03T12:00:00.000Z'),
    });

    const fb = createFeedback({
      id: `fb-${oppId}`,
      opportunityId: oppId,
      previousEvaluationId: `eval-${oppId}`,
      actor: 'LOCAL_USER',
      decision: feedbackDecision,
      createdAt: new Date('2026-09-03T12:10:00.000Z'),
    });

    return {
      opportunity: opp,
      observation: obs,
      listing,
      evaluation,
      feedbackHistory: [fb],
    };
  }

  it('detects pattern when 3 or more opportunities have identical feedback and reasonCode', () => {
    const items: ReviewItem[] = [
      makeMockReviewItem('opp-1', 'search-1', 'PRICE_AMBIGUOUS', 'CONFIRMED_MATCH'),
      makeMockReviewItem('opp-2', 'search-1', 'PRICE_AMBIGUOUS', 'CONFIRMED_MATCH'),
      makeMockReviewItem('opp-3', 'search-1', 'PRICE_AMBIGUOUS', 'CONFIRMED_MATCH'),
    ];

    const suggestions = detectRuleSuggestions(items);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]?.pattern.savedSearchId).toBe('search-1');
    expect(suggestions[0]?.pattern.occurrences).toBe(3);
    expect(suggestions[0]?.pattern.reasonCode).toBe('PRICE_AMBIGUOUS');
    expect(suggestions[0]?.pattern.feedbackDecision).toBe('CONFIRMED_MATCH');
    expect(suggestions[0]?.applicable).toBe(false);
    expect(suggestions[0]?.message).toContain('Se registraron 3 decisiones');
    expect(suggestions[0]?.message).toContain('PRICE_AMBIGUOUS');
  });

  it('does not emit suggestions when occurrences are below threshold of 3', () => {
    const items: ReviewItem[] = [
      makeMockReviewItem('opp-1', 'search-1', 'PRICE_AMBIGUOUS', 'CONFIRMED_MATCH'),
      makeMockReviewItem('opp-2', 'search-1', 'PRICE_AMBIGUOUS', 'CONFIRMED_MATCH'),
      makeMockReviewItem('opp-3', 'search-1', 'DIFFERENT_REASON', 'CONFIRMED_MATCH'),
    ];

    const suggestions = detectRuleSuggestions(items);
    expect(suggestions).toEqual([]);
  });

  it('isolates patterns across different savedSearchIds', () => {
    const items: ReviewItem[] = [
      makeMockReviewItem('opp-1', 'search-1', 'PRICE_AMBIGUOUS', 'FALSE_POSITIVE'),
      makeMockReviewItem('opp-2', 'search-1', 'PRICE_AMBIGUOUS', 'FALSE_POSITIVE'),
      makeMockReviewItem('opp-3', 'search-2', 'PRICE_AMBIGUOUS', 'FALSE_POSITIVE'), // different search
    ];

    const suggestions = detectRuleSuggestions(items);
    expect(suggestions).toEqual([]);
  });
});
