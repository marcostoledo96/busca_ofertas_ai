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

    // Run evaluation with the custom registered profile and explicit policyVersion
    const rule = createMockRule('dummy', { triggered: false });
    const evaluation = evaluateRules(
      [rule],
      baseContext,
      {
        matchThreshold: 80,
        reviewThreshold: 40,
        precisionProfile: 'CONSOLES_PORTABLE' as unknown as StandardPrecisionProfile,
      },
      {
        precisionProfileRegistry: customRegistry,
        policyVersion: '2.0.0-consoles-portable',
      },
    );

    expect(evaluation.score).toBe(5); // Started at defaultBaseScore 5
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.policyVersion).toBe('2.0.0-consoles-portable');
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

  it('guarantees referential determinism and complete absence of global mutable state (HIGH-01)', () => {
    const fixedRule = createMockRule('test_rule', {
      triggered: true,
      impact: 80,
      severity: 'SOFT',
    });

    const fixedPolicy = {
      matchThreshold: 80,
      reviewThreshold: 40,
      precisionProfile: 'BALANCED' as const,
    };

    // 1. Initial standard evaluation
    const eval1 = evaluateRules([fixedRule], baseContext, fixedPolicy);
    expect(eval1.decision).toBe('MATCH');
    expect(eval1.score).toBe(80);
    expect(eval1.policyVersion).toBe('1.0.0');

    // 2. Verify runtime immutability of STANDARD_PROFILES
    expect(Object.isFrozen(STANDARD_PROFILES)).toBe(true);
    expect(Object.isFrozen(STANDARD_PROFILES.BALANCED)).toBe(true);
    expect(() => {
      // @ts-expect-error - testing runtime freeze protection against mutation
      STANDARD_PROFILES.BALANCED.matchThresholdModifier = 50;
    }).toThrow();

    // 3. Instantiate an isolated custom registry and register an aggressive BALANCED override
    const isolatedRegistry = new PrecisionProfileRegistry();
    isolatedRegistry.register({
      name: 'BALANCED',
      description: 'Modified BALANCED inside isolated custom registry',
      matchThresholdModifier: 20, // would raise threshold to 100
      reviewThresholdModifier: 20,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    });

    // Custom evaluation using isolated registry with explicit policyVersion
    const evalCustom = evaluateRules([fixedRule], baseContext, fixedPolicy, {
      precisionProfileRegistry: isolatedRegistry,
      policyVersion: 'custom-isolated-v1',
    });
    expect(evalCustom.decision).toBe('REVIEW'); // 80 < (80 + 20)
    expect(evalCustom.policyVersion).toBe('custom-isolated-v1');

    // 4. Re-evaluate with the exact same contractual inputs as Step 1 (standard path)
    const eval2 = evaluateRules([fixedRule], baseContext, fixedPolicy);

    // Verify complete semantic identity between eval1 and eval2
    expect(eval2.decision).toBe(eval1.decision);
    expect(eval2.score).toBe(eval1.score);
    expect(eval2.reasons).toEqual(eval1.reasons);
    expect(eval2.evaluatedBy).toEqual(eval1.evaluatedBy);
    expect(eval2.policyVersion).toBe(eval1.policyVersion);
    expect(eval2.policyVersion).toBe('1.0.0');
  });

  it('strictly enforces explicit policyVersion when using custom profile registries', () => {
    const customRegistry = new PrecisionProfileRegistry();
    customRegistry.register({
      name: 'CUSTOM_STRICT',
      matchThresholdModifier: 10,
      reviewThresholdModifier: 10,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    });

    const rule = createMockRule('dummy', { triggered: false });
    const customPolicy = {
      matchThreshold: 80,
      reviewThreshold: 40,
      precisionProfile: 'CUSTOM_STRICT' as unknown as StandardPrecisionProfile,
    };

    // 1. Omitting policyVersion when using a custom registry must fail closed
    expect(() =>
      evaluateRules([rule], baseContext, customPolicy, {
        precisionProfileRegistry: customRegistry,
      }),
    ).toThrow(InvariantViolationError);
    expect(() =>
      evaluateRules([rule], baseContext, customPolicy, {
        precisionProfileRegistry: customRegistry,
      }),
    ).toThrow(/requires an explicit 'policyVersion'/);

    // 2. Passing the default policyVersion ('1.0.0') with a custom registry must also fail closed
    expect(() =>
      evaluateRules([rule], baseContext, customPolicy, {
        precisionProfileRegistry: customRegistry,
        policyVersion: '1.0.0',
      }),
    ).toThrow(InvariantViolationError);

    // 3. Supplying an explicit custom policyVersion succeeds
    const evalCustom = evaluateRules([rule], baseContext, customPolicy, {
      precisionProfileRegistry: customRegistry,
      policyVersion: '2.0.0-custom-strict',
    });
    expect(evalCustom.policyVersion).toBe('2.0.0-custom-strict');
  });

  it('guarantees that two distinct custom profile semantics cannot silently share or masquerade under the default policyVersion', () => {
    const registryA = new PrecisionProfileRegistry();
    registryA.register({
      name: 'CUSTOM_VARIANT',
      matchThresholdModifier: 10,
      reviewThresholdModifier: 10,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    });

    const registryB = new PrecisionProfileRegistry();
    registryB.register({
      name: 'CUSTOM_VARIANT',
      matchThresholdModifier: -10,
      reviewThresholdModifier: -10,
      ambiguousPriceSeverity: 'INFO',
      missingPriceSeverity: 'INFO',
      defaultBaseScore: 0,
    });

    const rule = createMockRule('rule_75', {
      triggered: true,
      impact: 75,
      severity: 'SOFT',
    });
    const policy = {
      matchThreshold: 80,
      reviewThreshold: 40,
      precisionProfile: 'CUSTOM_VARIANT' as unknown as StandardPrecisionProfile,
    };

    // Neither can run under default version without explicit versioning
    expect(() =>
      evaluateRules([rule], baseContext, policy, { precisionProfileRegistry: registryA }),
    ).toThrow(InvariantViolationError);
    expect(() =>
      evaluateRules([rule], baseContext, policy, { precisionProfileRegistry: registryB }),
    ).toThrow(InvariantViolationError);

    // With explicit distinct versions, their semantic differences and identities are fully traceable
    const evalA = evaluateRules([rule], baseContext, policy, {
      precisionProfileRegistry: registryA,
      policyVersion: 'custom-variant-a.1',
    });
    const evalB = evaluateRules([rule], baseContext, policy, {
      precisionProfileRegistry: registryB,
      policyVersion: 'custom-variant-b.1',
    });

    expect(evalA.decision).toBe('REVIEW'); // 75 < (80 + 10 = 90)
    expect(evalA.policyVersion).toBe('custom-variant-a.1');

    expect(evalB.decision).toBe('MATCH'); // 75 >= (80 - 10 = 70)
    expect(evalB.policyVersion).toBe('custom-variant-b.1');

    expect(evalA.policyVersion).not.toBe(evalB.policyVersion);
    expect(evalA.decision).not.toBe(evalB.decision);
  });

  it('ensures PrecisionProfileRegistry enforces defensive copies and runtime immutability', () => {
    const registry = new PrecisionProfileRegistry({ includeStandardProfiles: false });
    const mutableProfile: PrecisionProfileConfig = {
      name: 'DEFENSIVE_TEST',
      matchThresholdModifier: 5,
      reviewThresholdModifier: 5,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    };

    registry.register(mutableProfile);

    // 1. Mutating external object after register does NOT affect the registry
    (mutableProfile as { matchThresholdModifier: number }).matchThresholdModifier = 99;
    expect(registry.get('DEFENSIVE_TEST').matchThresholdModifier).toBe(5);

    // 2. get() returns a frozen object
    const retrieved = registry.get('DEFENSIVE_TEST');
    expect(Object.isFrozen(retrieved)).toBe(true);
    expect(() => {
      // @ts-expect-error - testing runtime freeze
      retrieved.matchThresholdModifier = 100;
    }).toThrow();

    // 3. list() returns a frozen array of frozen objects
    const list = registry.list();
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
  });
});
