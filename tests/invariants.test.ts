import { describe, it, expect } from 'vitest';
import {
  createResolvedPrice,
  createEvaluationReason,
  createEvaluation,
  applySubsequentEvaluation,
  hasHardRejection,
  canPromoteToMatch,
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

  describe('Hard Reject Invariant & IA Override Protection', () => {
    it('should detect hard rejection severity from structured reasons', () => {
      const softReason = createEvaluationReason({
        code: 'BOX_MISSING',
        message: 'No original box included',
        impact: -10,
        severity: 'SOFT',
      });
      const hardReason = createEvaluationReason({
        code: 'ACCESSORY_ONLY_DETECTED',
        message: 'The listing is only a case/cover, not the console itself',
        impact: -100,
        severity: 'HARD',
      });

      expect(hasHardRejection([softReason])).toBe(false);
      expect(hasHardRejection([softReason, hardReason])).toBe(true);
    });

    it('should not allow promoting a HARD rejection to MATCH', () => {
      const hardReason = createEvaluationReason({
        code: 'BROKEN_SCREEN',
        message: 'Console has broken screen, fails functional requirement',
        impact: -100,
        severity: 'HARD',
      });

      const initialRejection = createEvaluation({
        id: 'eval-rules-reject',
        decision: 'REJECT',
        score: 0,
        reasons: [hardReason],
        evaluatedBy: ['RULES'],
        policyVersion: '1.0.0',
        createdAt: baseDate,
      });

      expect(canPromoteToMatch(initialRejection)).toBe(false);

      expect(() =>
        applySubsequentEvaluation(initialRejection, {
          id: 'eval-ai-override-attempt',
          decision: 'MATCH',
          score: 95,
          reasons: [
            createEvaluationReason({
              code: 'AI_OVERRULE',
              message: 'AI hallucinated that the console is intact',
              impact: 95,
              severity: 'INFO',
            }),
          ],
          evaluatedBy: ['AI'],
          policyVersion: '1.0.0',
          createdAt: new Date(baseDate.getTime() + 1000),
        }),
      ).toThrow(InvariantViolationError);
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

  describe('Run & SourceRun Invariants', () => {
    it('should reject finishedAt earlier than startedAt', () => {
      expect(() =>
        createRun({
          id: 'run-1',
          savedSearchId: 'search-1',
          startedAt: new Date('2026-08-30T22:00:00.000Z'),
          finishedAt: new Date('2026-08-30T20:00:00.000Z'),
        }),
      ).toThrow(InvariantViolationError);

      expect(() =>
        createSourceRun({
          id: 'src-run-1',
          runId: 'run-1',
          sourceId: 'facebook',
          startedAt: new Date('2026-08-30T22:00:00.000Z'),
          finishedAt: new Date('2026-08-30T20:00:00.000Z'),
        }),
      ).toThrow(InvariantViolationError);
    });

    it('should reject ZERO_RESULTS_CONFIRMED with itemsCount > 0', () => {
      expect(() =>
        createSourceRun({
          id: 'src-run-1',
          runId: 'run-1',
          sourceId: 'facebook',
          status: 'ZERO_RESULTS_CONFIRMED',
          startedAt: baseDate,
          itemsCount: 5,
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
