import { describe, it, expect } from 'vitest';
import { createResolvedPrice } from '@busca-ofertas-ai/core';
import {
  evaluateRules,
  RequiredTermsRule,
  ExcludedTermsRule,
  PriceRangeRule,
  PriceCurrencyRule,
  ConditionRule,
  EvaluationReasonCodes,
} from '@busca-ofertas-ai/rules-engine';
import { createMockRuleEvaluationContext } from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Standard Generic Rules & False Positive Defenses', () => {
  const policy = {
    matchThreshold: 80,
    reviewThreshold: 40,
    precisionProfile: 'BALANCED' as const,
  };

  const standardRules = [
    new RequiredTermsRule(),
    new ExcludedTermsRule(),
    new PriceRangeRule(),
    new PriceCurrencyRule(),
    new ConditionRule(),
  ];

  it('evaluates a valid genuine opportunity to MATCH', () => {
    const validContext = createMockRuleEvaluationContext({
      observationOverrides: {
        title: 'Producto original completo en caja',
        description: 'Venta de producto oficial en impecable estado de funcionamiento.',
        price: createResolvedPrice({
          rawText: '$120000',
          amount: 120000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 1,
          evidence: ['explicit amount'],
        }),
        condition: 'LIKE_NEW',
      },
      savedSearchOverrides: {
        query: {
          terms: ['producto'],
          excludedTerms: ['roto', 'repuesto', 'falla'],
        },
        price: {
          targetCurrency: 'ARS',
          maximum: 200000,
          minimumPlausible: 50000,
        },
        condition: {
          accepted: ['NEW', 'LIKE_NEW', 'GOOD'],
        },
      },
    });

    const evaluation = evaluateRules(standardRules, validContext, policy, { baseScore: 25 });
    expect(evaluation.score).toBeGreaterThanOrEqual(80);
    expect(evaluation.decision).toBe('MATCH');
    expect(
      evaluation.reasons.some((r) => r.code === EvaluationReasonCodes.REQUIRED_TERM_MATCH),
    ).toBe(true);
  });

  describe('Deceptive False Positive Scenarios (Ensuring Non-Matches)', () => {
    it('Scenario 1: Genuine-looking title but description mentions a fatal defect (Excluded term in description)', () => {
      // Deceptive listing: Title has perfect search term, but description reveals "para repuesto o falla"
      const deceptiveContext = createMockRuleEvaluationContext({
        observationOverrides: {
          title: 'Producto excelente estado estético como nuevo',
          description: 'No enciende, se vende exclusivamente para repuesto o desarme.',
          price: createResolvedPrice({
            rawText: '$70000',
            amount: 70000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 1,
            evidence: ['70000'],
          }),
          condition: 'FOR_PARTS',
        },
        savedSearchOverrides: {
          query: {
            terms: ['producto'],
            excludedTerms: ['repuesto', 'desarme', 'roto'],
          },
          price: {
            targetCurrency: 'ARS',
            maximum: 200000,
            minimumPlausible: 50000,
          },
          condition: {
            accepted: ['NEW', 'LIKE_NEW', 'GOOD'],
          },
        },
      });

      const evaluation = evaluateRules(standardRules, deceptiveContext, policy, { baseScore: 25 });

      // HARD exclusion from ExcludedTermsRule must force REJECT
      expect(evaluation.decision).toBe('REJECT');
      expect(
        evaluation.reasons.some(
          (r) => r.code === EvaluationReasonCodes.EXCLUDED_TERM_MATCH && r.severity === 'HARD',
        ),
      ).toBe(true);
    });

    it('Scenario 2: Low decoy price below plausible minimum (Fake quote / accessory / deposit)', () => {
      // Deceptive listing: Item listed at $5000 when market minimum is $50000 (typical deposit/seña decoy)
      const decoyContext = createMockRuleEvaluationContext({
        observationOverrides: {
          title: 'Producto impecable consultar stock',
          description: 'Seña inicial de reserva, consultar valor total en privado.',
          price: createResolvedPrice({
            rawText: '$5000',
            amount: 5000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 1,
            evidence: ['5000'],
          }),
        },
        savedSearchOverrides: {
          query: {
            terms: ['producto'],
            excludedTerms: ['roto'],
          },
          price: {
            targetCurrency: 'ARS',
            maximum: 200000,
            minimumPlausible: 50000,
          },
        },
      });

      const evaluation = evaluateRules(standardRules, decoyContext, policy, { baseScore: 25 });

      // Soft penalty pushes evaluation down to REVIEW or REJECT, preventing false MATCH
      expect(evaluation.decision).not.toBe('MATCH');
      expect(
        evaluation.reasons.some(
          (r) => r.code === EvaluationReasonCodes.PRICE_BELOW_MINIMUM_PLAUSIBLE,
        ),
      ).toBe(true);
    });

    it('Scenario 3: Ambiguous currency "$100" which could be USD 100 or ARS 100', () => {
      // Deceptive listing: "$100" without currency declaration
      const ambiguousPriceContext = createMockRuleEvaluationContext({
        observationOverrides: {
          title: 'Producto nuevo importado',
          description: 'Envío a todo el país.',
          price: createResolvedPrice({
            rawText: '$100',
            amount: 100,
            currency: 'UNKNOWN',
            resolution: 'AMBIGUOUS',
            confidence: 0.2,
            evidence: ['ambiguous text $100'],
          }),
        },
        savedSearchOverrides: {
          query: {
            terms: ['producto'],
            excludedTerms: ['roto'],
          },
          price: {
            targetCurrency: 'ARS',
            maximum: 200000,
            minimumPlausible: 50000,
          },
        },
      });

      const evaluation = evaluateRules(standardRules, ambiguousPriceContext, policy, {
        baseScore: 25,
      });

      // Ambiguity prevents MATCH
      expect(evaluation.decision).not.toBe('MATCH');
      expect(
        evaluation.reasons.some((r) => r.code === EvaluationReasonCodes.PRICE_AMBIGUOUS_CURRENCY),
      ).toBe(true);
    });

    it('Scenario 4: Price exceeds maximum threshold (Overpriced item)', () => {
      const overpricedContext = createMockRuleEvaluationContext({
        observationOverrides: {
          title: 'Producto edición especial',
          description: 'En caja sellada de colección.',
          price: createResolvedPrice({
            rawText: '$350000',
            amount: 350000,
            currency: 'ARS',
            resolution: 'EXPLICIT',
            confidence: 1,
            evidence: ['350000'],
          }),
        },
        savedSearchOverrides: {
          query: {
            terms: ['producto'],
            excludedTerms: ['roto'],
          },
          price: {
            targetCurrency: 'ARS',
            maximum: 200000,
            minimumPlausible: 50000,
          },
        },
      });

      const evaluation = evaluateRules(standardRules, overpricedContext, policy, { baseScore: 25 });

      expect(evaluation.decision).toBe('REJECT');
      expect(
        evaluation.reasons.some((r) => r.code === EvaluationReasonCodes.PRICE_EXCEEDS_MAXIMUM),
      ).toBe(true);
    });
  });
});
