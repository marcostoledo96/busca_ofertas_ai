import { describe, it, expect } from 'vitest';
import { InvariantViolationError, createResolvedPrice } from '@busca-ofertas-ai/core';
import {
  STANDARD_PROFILES,
  PrecisionProfileRegistry,
  evaluateRules,
  PriceCurrencyRule,
  type PrecisionProfileConfig,
  type StandardPrecisionProfile,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Precision Profiles & Extensibility', () => {
  const baseContext = createMockRuleEvaluationContext();

  it('supports all four standard precision profiles (STRICT, BALANCED, PERMISSIVE, MIXED)', () => {
    const registry = new PrecisionProfileRegistry();
    const profiles = registry.list();

    expect(profiles.map((p) => p.name)).toEqual(
      expect.arrayContaining(['STRICT', 'BALANCED', 'PERMISSIVE', 'MIXED']),
    );

    // Verify configurations
    expect(STANDARD_PROFILES.STRICT.matchThresholdModifier).toBe(5);
    expect(STANDARD_PROFILES.STRICT.ambiguousPriceSeverity).toBe('HARD');

    expect(STANDARD_PROFILES.BALANCED.matchThresholdModifier).toBe(0);
    expect(STANDARD_PROFILES.BALANCED.ambiguousPriceSeverity).toBe('SOFT');

    expect(STANDARD_PROFILES.PERMISSIVE.matchThresholdModifier).toBe(-5);
    expect(STANDARD_PROFILES.PERMISSIVE.ambiguousPriceSeverity).toBe('INFO');

    expect(STANDARD_PROFILES.MIXED.matchThresholdModifier).toBe(0);
    expect(STANDARD_PROFILES.MIXED.ambiguousPriceSeverity).toBe('SOFT');
  });

  it('adjusts effective thresholds dynamically based on precision profile without hardcoding in evaluator', () => {
    // Score of 82 with policy matchThreshold = 80:
    // Under BALANCED: 82 >= 80 -> MATCH
    // Under STRICT (modifier +5, threshold 85): 82 < 85 -> REVIEW
    const rule = createMockRule('score_rule', {
      triggered: true,
      impact: 82,
      severity: 'SOFT',
    });

    const evalBalanced = evaluateRules(
      [rule],
      baseContext,
      { matchThreshold: 80, reviewThreshold: 40, precisionProfile: 'BALANCED' },
      { baseScore: 0 },
    );
    expect(evalBalanced.decision).toBe('MATCH');

    const evalStrict = evaluateRules(
      [rule],
      baseContext,
      { matchThreshold: 80, reviewThreshold: 40, precisionProfile: 'STRICT' },
      { baseScore: 0 },
    );
    expect(evalStrict.decision).toBe('REVIEW');
  });

  it('applies PERMISSIVE profile to lower the threshold and increase recall', () => {
    // Score of 76 with policy matchThreshold = 80:
    // Under BALANCED: 76 < 80 -> REVIEW
    // Under PERMISSIVE (modifier -5, threshold 75): 76 >= 75 -> MATCH
    const rule = createMockRule('score_rule', {
      triggered: true,
      impact: 76,
      severity: 'SOFT',
    });

    const evalBalanced = evaluateRules(
      [rule],
      baseContext,
      { matchThreshold: 80, reviewThreshold: 40, precisionProfile: 'BALANCED' },
      { baseScore: 0 },
    );
    expect(evalBalanced.decision).toBe('REVIEW');

    const evalPermissive = evaluateRules(
      [rule],
      baseContext,
      { matchThreshold: 80, reviewThreshold: 40, precisionProfile: 'PERMISSIVE' },
      { baseScore: 0 },
    );
    expect(evalPermissive.decision).toBe('MATCH');
  });

  it('demonstrates that ambiguous currency severity is governed by profile parameters', () => {
    // Context with ambiguous currency
    const ambiguousContext = createMockRuleEvaluationContext({
      observationOverrides: {
        price: createResolvedPrice({
          rawText: '$100',
          amount: 100,
          currency: 'UNKNOWN',
          resolution: 'AMBIGUOUS',
          confidence: 0.3,
          evidence: ['ambiguous price'],
        }),
      },
    });

    const strictRule = new PriceCurrencyRule({
      ambiguousSeverity: STANDARD_PROFILES.STRICT.ambiguousPriceSeverity,
    });
    const resultStrict = strictRule.evaluate(ambiguousContext);
    expect(resultStrict.severity).toBe('HARD');

    const balancedRule = new PriceCurrencyRule({
      ambiguousSeverity: STANDARD_PROFILES.BALANCED.ambiguousPriceSeverity,
    });
    const resultBalanced = balancedRule.evaluate(ambiguousContext);
    expect(resultBalanced.severity).toBe('SOFT');

    const permissiveRule = new PriceCurrencyRule({
      ambiguousSeverity: STANDARD_PROFILES.PERMISSIVE.ambiguousPriceSeverity,
    });
    const resultPermissive = permissiveRule.evaluate(ambiguousContext);
    expect(resultPermissive.severity).toBe('INFO');
  });

  it('demonstrates extending the engine with a custom domain profile without modifying generic evaluator', () => {
    const customRegistry = new PrecisionProfileRegistry();

    // A future issue can register a custom product profile, e.g. "CONSOLES_PORTABLE"
    const consolesProfile: PrecisionProfileConfig = {
      name: 'CONSOLES_PORTABLE',
      description: 'Custom domain profile for portable gaming consoles.',
      matchThresholdModifier: 2,
      reviewThresholdModifier: -2,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 5,
    };

    customRegistry.register(consolesProfile);

    expect(customRegistry.has('CONSOLES_PORTABLE')).toBe(true);
    expect(customRegistry.get('CONSOLES_PORTABLE').matchThresholdModifier).toBe(2);

    // Run evaluation with the custom registered profile
    const rule = createMockRule('dummy', { triggered: false });
    const evaluation = evaluateRules(
      [rule],
      baseContext,
      {
        matchThreshold: 80,
        reviewThreshold: 40,
        precisionProfile: 'CONSOLES_PORTABLE' as unknown as StandardPrecisionProfile,
      },
      { precisionProfileRegistry: customRegistry },
    );

    expect(evaluation.score).toBe(5); // Started at defaultBaseScore 5
    expect(evaluation.decision).toBe('REJECT');
  });

  it('fails closed when an unknown precision profile is requested', () => {
    const rule = createMockRule('dummy', { triggered: false });
    expect(() =>
      evaluateRules([rule], baseContext, {
        matchThreshold: 80,
        reviewThreshold: 40,
        precisionProfile: 'NON_EXISTENT' as unknown as StandardPrecisionProfile,
      }),
    ).toThrow(InvariantViolationError);
  });
});
