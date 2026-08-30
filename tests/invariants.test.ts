import { describe, it, expect } from 'vitest';
import {
  createResolvedPrice,
  createEvaluationReason,
  createEvaluation,
  applySubsequentEvaluation,
  hasHardRejection,
  canPromoteToMatch,
  canPromoteToReview,
  createListing,
  createObservation,
  createSavedSearch,
  createRun,
  createSourceRun,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';

describe('Domain Invariants & Rejection Contracts (BOAI-002)', () => {
  const baseDate = new Date('2026-08-30T20:00:00.000Z');

  describe('Evaluation Score Invariants (0 <= score <= 100)', () => {
    const validReason = createEvaluationReason({
      code: 'VALID_REASON',
      message: 'A valid reason',
      impact: 10,
      severity: 'INFO',
    });

    it('should reject score < 0', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-invalid-score',
          decision: 'REJECT',
          score: -1,
          reasons: [validReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject score > 100', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-invalid-score',
          decision: 'MATCH',
          score: 101,
          reasons: [validReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject non-finite scores (NaN, Infinity, -Infinity)', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-nan',
          decision: 'MATCH',
          score: Number.NaN,
          reasons: [validReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createEvaluation({
          id: 'eval-inf',
          decision: 'MATCH',
          score: Number.POSITIVE_INFINITY,
          reasons: [validReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject evaluation without at least one structured reason', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-no-reasons',
          decision: 'MATCH',
          score: 90,
          reasons: [],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject evaluation without declared evaluators', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-no-evaluators',
          decision: 'MATCH',
          score: 90,
          reasons: [validReason],
          evaluatedBy: [],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('Hard Reject Invariant & Decision Coherence', () => {
    const hardReason = createEvaluationReason({
      code: 'BROKEN_SCREEN',
      message: 'Console has broken screen, fails functional requirement',
      impact: -100,
      severity: 'HARD',
    });

    const softReason = createEvaluationReason({
      code: 'BOX_MISSING',
      message: 'No original box included',
      impact: -10,
      severity: 'SOFT',
    });

    it('should reject constructing MATCH or REVIEW when a reason has HARD severity', () => {
      expect(() =>
        createEvaluation({
          id: 'eval-match-with-hard',
          decision: 'MATCH',
          score: 90,
          reasons: [hardReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createEvaluation({
          id: 'eval-review-with-hard',
          decision: 'REVIEW',
          score: 50,
          reasons: [hardReason],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should allow constructing valid REJECT with HARD reasons', () => {
      const evaluation = createEvaluation({
        id: 'eval-valid-hard-reject',
        decision: 'REJECT',
        score: 0,
        reasons: [hardReason],
        evaluatedBy: ['RULES'],
        policyVersion: '1.0.0',
        createdAt: baseDate,
      });

      expect(evaluation.decision).toBe('REJECT');
      expect(hasHardRejection(evaluation.reasons)).toBe(true);
      expect(canPromoteToMatch(evaluation)).toBe(false);
      expect(canPromoteToReview(evaluation)).toBe(false);
    });

    it('should block both REJECT(HARD) -> MATCH and REJECT(HARD) -> REVIEW in subsequent evaluations', () => {
      const initialHardRejection = createEvaluation({
        id: 'eval-initial-hard-reject',
        decision: 'REJECT',
        score: 0,
        reasons: [hardReason],
        evaluatedBy: ['RULES'],
        policyVersion: '1.0.0',
        createdAt: baseDate,
      });

      // Attempt REJECT(HARD) -> MATCH
      expect(() =>
        applySubsequentEvaluation(initialHardRejection, {
          id: 'eval-override-match',
          decision: 'MATCH',
          score: 95,
          reasons: [
            createEvaluationReason({
              code: 'AI_OVERRULE',
              message: 'Attempting to promote to MATCH',
              impact: 95,
              severity: 'INFO',
            }),
          ],
          evaluatedBy: ['AI'],
          policyVersion: '1.0.0',
          createdAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);

      // Attempt REJECT(HARD) -> REVIEW
      expect(() =>
        applySubsequentEvaluation(initialHardRejection, {
          id: 'eval-override-review',
          decision: 'REVIEW',
          score: 50,
          reasons: [
            createEvaluationReason({
              code: 'AI_OVERRULE',
              message: 'Attempting to promote to REVIEW',
              impact: 50,
              severity: 'INFO',
            }),
          ],
          evaluatedBy: ['AI'],
          policyVersion: '1.0.0',
          createdAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should allow valid subsequent updates when reasons are SOFT and not hard-rejected', () => {
      const initialReview = createEvaluation({
        id: 'eval-initial-soft-review',
        decision: 'REVIEW',
        score: 60,
        reasons: [softReason],
        evaluatedBy: ['RULES'],
        policyVersion: '1.0.0',
        createdAt: baseDate,
      });

      const updatedToMatch = applySubsequentEvaluation(initialReview, {
        id: 'eval-updated-match',
        decision: 'MATCH',
        score: 85,
        reasons: [
          softReason,
          createEvaluationReason({
            code: 'AI_VERIFIED',
            message: 'AI verified bundle value justifies price',
            impact: 25,
            severity: 'INFO',
          }),
        ],
        evaluatedBy: ['RULES', 'AI'],
        policyVersion: '1.0.0',
        createdAt: new Date(baseDate.getTime() + 1000),
      });

      expect(updatedToMatch.decision).toBe('MATCH');
      expect(updatedToMatch.score).toBe(85);
    });
  });

  describe('Price & Currency Ambiguity Invariants', () => {
    it('should reject converting UNKNOWN currency to ARS automatically', () => {
      expect(() =>
        createResolvedPrice({
          rawText: '$300',
          amount: 300,
          currency: 'UNKNOWN',
          resolution: 'AMBIGUOUS',
          confidence: 0.3,
          evidence: ['isolated dollar sign'],
          converted: {
            amount: 300,
            currency: 'ARS',
            exchangeRate: 1,
            exchangeRateOrigin: 'MANUAL',
            convertedAt: baseDate,
          },
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject confidence outside [0, 1] or non-finite', () => {
      expect(() =>
        createResolvedPrice({
          rawText: 'ARS 250000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: -0.1,
          evidence: [],
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createResolvedPrice({
          rawText: 'ARS 250000',
          amount: 250000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1.5,
          evidence: [],
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject negative amount or non-integer amount', () => {
      expect(() =>
        createResolvedPrice({
          rawText: 'ARS -100',
          amount: -100,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1,
          evidence: [],
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createResolvedPrice({
          rawText: 'ARS 250.50',
          amount: 250.5,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1,
          evidence: [],
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('Listing & Observation Invariants', () => {
    it('should reject listing when lastSeenAt is earlier than firstSeenAt', () => {
      expect(() =>
        createListing({
          id: 'list-invalid-dates',
          sourceId: 'facebook',
          externalId: 'ext-1',
          canonicalUrl: 'https://example.com/1',
          firstSeenAt: new Date('2026-08-30T22:00:00.000Z'),
          lastSeenAt: new Date('2026-08-30T20:00:00.000Z'),
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject empty identifier in listing or observation', () => {
      expect(() =>
        createListing({
          id: '   ',
          sourceId: 'facebook',
          externalId: 'ext-1',
          canonicalUrl: 'https://example.com/1',
          firstSeenAt: baseDate,
          lastSeenAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createObservation({
          id: 'obs-1',
          listingId: '',
          sourceRunId: 'src-1',
          observedAt: baseDate,
          title: 'Title',
          rawFingerprint: 'fp',
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('Run Discriminated State Invariants', () => {
    it('should reject SUCCESS or PARTIAL_SUCCESS without finishedAt', () => {
      expect(() =>
        createRun({
          id: 'run-1',
          savedSearchId: 'search-1',
          status: 'SUCCESS',
          startedAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createRun({
          id: 'run-2',
          savedSearchId: 'search-1',
          status: 'PARTIAL_SUCCESS',
          startedAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject SUCCESS with error', () => {
      expect(() =>
        createRun({
          id: 'run-1',
          savedSearchId: 'search-1',
          status: 'SUCCESS',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
          error: 'unexpected error',
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject FAILED without finishedAt or without error', () => {
      expect(() =>
        createRun({
          id: 'run-1',
          savedSearchId: 'search-1',
          status: 'FAILED',
          startedAt: baseDate,
          error: 'Some failure',
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createRun({
          id: 'run-2',
          savedSearchId: 'search-1',
          status: 'FAILED',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject CREATED or RUNNING with finishedAt or error', () => {
      expect(() =>
        createRun({
          id: 'run-1',
          savedSearchId: 'search-1',
          status: 'CREATED',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createRun({
          id: 'run-2',
          savedSearchId: 'search-1',
          status: 'RUNNING',
          startedAt: baseDate,
          error: 'Premature error',
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('SourceRun Discriminated State Invariants', () => {
    it('should reject PENDING or RUNNING with finishedAt or itemsCount or error', () => {
      expect(() =>
        createSourceRun({
          id: 'src-1',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'PENDING',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createSourceRun({
          id: 'src-2',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'RUNNING',
          startedAt: baseDate,
          itemsCount: 10,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject SUCCESS without finishedAt or without itemsCount', () => {
      expect(() =>
        createSourceRun({
          id: 'src-1',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'SUCCESS',
          startedAt: baseDate,
          itemsCount: 5,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createSourceRun({
          id: 'src-2',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'SUCCESS',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject ZERO_RESULTS_CONFIRMED without finishedAt or with itemsCount != 0', () => {
      expect(() =>
        createSourceRun({
          id: 'src-1',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createSourceRun({
          id: 'src-2',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
          itemsCount: 5,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject error states without finishedAt or without diagnostic error', () => {
      expect(() =>
        createSourceRun({
          id: 'src-1',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'RATE_LIMITED',
          startedAt: baseDate,
          error: 'Rate limit',
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createSourceRun({
          id: 'src-2',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'NETWORK_ERROR',
          startedAt: baseDate,
          finishedAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('SavedSearch Policy Invariants', () => {
    it('should reject matchThreshold <= reviewThreshold', () => {
      expect(() =>
        createSavedSearch({
          id: 'search-1',
          schemaVersion: 1,
          name: 'Invalid thresholds',
          enabled: true,
          category: 'PRODUCT',
          sourceConfigs: [{ id: 'src-1', enabled: true, queries: ['query'] }],
          query: { terms: ['query'] },
          evaluation: {
            matchThreshold: 50,
            reviewThreshold: 60,
          },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 1,
          },
          retention: {
            rawArtifacts: 'ERRORS_AND_REVIEW',
            rawDataDays: 30,
          },
          createdAt: baseDate,
          updatedAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject maximum price less than minimumPlausible', () => {
      expect(() =>
        createSavedSearch({
          id: 'search-1',
          schemaVersion: 1,
          name: 'Invalid prices',
          enabled: true,
          category: 'PRODUCT',
          sourceConfigs: [{ id: 'src-1', enabled: true, queries: ['query'] }],
          query: { terms: ['query'] },
          price: {
            targetCurrency: 'ARS',
            maximum: 50000,
            minimumPlausible: 100000,
          },
          evaluation: {
            matchThreshold: 80,
            reviewThreshold: 40,
          },
          ai: {
            enabled: false,
            evaluateOnlyReview: true,
            requireConfirmation: true,
            maxEvaluationsPerRun: 1,
          },
          retention: {
            rawArtifacts: 'ERRORS_AND_REVIEW',
            rawDataDays: 30,
          },
          createdAt: baseDate,
          updatedAt: baseDate,
        }),
      ).toThrow(InvariantViolationError);
    });
  });
});
