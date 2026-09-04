import { describe, it, expect } from 'vitest';
import { InvariantViolationError } from '@busca-ofertas-ai/core';
import {
  createRuleResult,
  createNotTriggeredResult,
  createRuleEvaluationContext,
  EvaluationReasonCodes,
  createEngineReason,
  evaluateRules,
  RequiredTermsRule,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Contract & Reason Code Stability', () => {
  const context = createMockRuleEvaluationContext();
  const defaultPolicy = context.savedSearch.evaluation;

  it('validates RuleResult creation invariants', () => {
    // Valid triggered result
    const result = createRuleResult({
      ruleId: 'rule_1',
      triggered: true,
      impact: 25,
      severity: 'SOFT',
      reasons: [
        createEngineReason({
          code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
          message: 'Match detected',
          impact: 25,
          severity: 'SOFT',
        }),
      ],
    });
    expect(result.ruleId).toBe('rule_1');
    expect(result.triggered).toBe(true);
    expect(result.impact).toBe(25);
    expect(result.severity).toBe('SOFT');
    expect(result.reasons).toHaveLength(1);

    // Rejects empty ruleId
    expect(() =>
      createRuleResult({
        ruleId: '  ',
        triggered: true,
        impact: 10,
        severity: 'INFO',
      }),
    ).toThrow(InvariantViolationError);

    // Rejects non-finite impact
    expect(() =>
      createRuleResult({
        ruleId: 'rule_1',
        triggered: true,
        impact: NaN,
        severity: 'INFO',
      }),
    ).toThrow(InvariantViolationError);

    // Rejects severity mismatch when reason is HARD but result severity is SOFT
    expect(() =>
      createRuleResult({
        ruleId: 'rule_1',
        triggered: true,
        impact: -50,
        severity: 'SOFT',
        reasons: [
          createEngineReason({
            code: EvaluationReasonCodes.HARD_EXCLUSION,
            message: 'Hard exclusion',
            impact: -50,
            severity: 'HARD',
          }),
        ],
      }),
    ).toThrow(InvariantViolationError);
  });

  it('creates clean not-triggered result with zero impact and empty reasons', () => {
    const notTriggered = createNotTriggeredResult('test_rule');
    expect(notTriggered.ruleId).toBe('test_rule');
    expect(notTriggered.triggered).toBe(false);
    expect(notTriggered.impact).toBe(0);
    expect(notTriggered.severity).toBe('INFO');
    expect(notTriggered.reasons).toEqual([]);
  });

  it('validates RuleEvaluationContext creation invariants and relational integrity', () => {
    // Coherent context
    const validContext = createMockRuleEvaluationContext();
    expect(validContext.listing.id).toBe(validContext.observation.listingId);

    // Incoherent listingId mismatch between Listing and Observation fails closed
    const badListing = { ...validContext.listing, id: 'listing_diff' };
    expect(() =>
      createRuleEvaluationContext({
        listing: badListing,
        observation: validContext.observation,
        savedSearch: validContext.savedSearch,
      }),
    ).toThrow(InvariantViolationError);
  });

  it('ensures every Evaluation is explainable with at least 1 reason even when zero rules trigger', () => {
    // Zero rules
    const evalZero = evaluateRules([], context, defaultPolicy);
    expect(evalZero.reasons.length).toBeGreaterThanOrEqual(1);
    expect(evalZero.reasons[0]?.code).toBe(EvaluationReasonCodes.DEFAULT_BASELINE);
    expect(evalZero.evaluatedBy).toEqual(['RULES']);

    // Multiple non-triggered rules
    const nonTriggeringRule1 = createMockRule('nt_1', { triggered: false, reasons: [] });
    const nonTriggeringRule2 = createMockRule('nt_2', { triggered: false, reasons: [] });
    const evalNonTriggered = evaluateRules(
      [nonTriggeringRule1, nonTriggeringRule2],
      context,
      defaultPolicy,
    );

    expect(evalNonTriggered.reasons.length).toBeGreaterThanOrEqual(1);
    expect(evalNonTriggered.reasons[0]?.code).toBe(EvaluationReasonCodes.DEFAULT_BASELINE);
    expect(evalNonTriggered.evaluatedBy).toEqual(['RULES']);
  });

  it('strictly fixes and preserves the contract catalog of reason codes', () => {
    // Contractually required constant codes
    expect(EvaluationReasonCodes.DEFAULT_BASELINE).toBe('RULES_DEFAULT_BASELINE');
    expect(EvaluationReasonCodes.NO_RULES_TRIGGERED).toBe('RULES_NO_RULES_TRIGGERED');
    expect(EvaluationReasonCodes.REQUIRED_TERM_MATCH).toBe('RULES_REQUIRED_TERM_MATCH');
    expect(EvaluationReasonCodes.REQUIRED_TERM_MISSING).toBe('RULES_REQUIRED_TERM_MISSING');
    expect(EvaluationReasonCodes.EXCLUDED_TERM_MATCH).toBe('RULES_EXCLUDED_TERM_MATCH');
    expect(EvaluationReasonCodes.PRICE_WITHIN_LIMIT).toBe('RULES_PRICE_WITHIN_LIMIT');
    expect(EvaluationReasonCodes.PRICE_EXCEEDS_MAXIMUM).toBe('RULES_PRICE_EXCEEDS_MAXIMUM');
    expect(EvaluationReasonCodes.PRICE_BELOW_MINIMUM_PLAUSIBLE).toBe(
      'RULES_PRICE_BELOW_MINIMUM_PLAUSIBLE',
    );
    expect(EvaluationReasonCodes.PRICE_AMBIGUOUS_CURRENCY).toBe('RULES_PRICE_AMBIGUOUS_CURRENCY');
    expect(EvaluationReasonCodes.PRICE_MISSING).toBe('RULES_PRICE_MISSING');
    expect(EvaluationReasonCodes.CONDITION_ACCEPTED).toBe('RULES_CONDITION_ACCEPTED');
    expect(EvaluationReasonCodes.CONDITION_REJECTED).toBe('RULES_CONDITION_REJECTED');
    expect(EvaluationReasonCodes.CONDITION_UNKNOWN).toBe('RULES_CONDITION_UNKNOWN');
    expect(EvaluationReasonCodes.BOOLEAN_AND_SATISFIED).toBe('RULES_BOOLEAN_AND_SATISFIED');
    expect(EvaluationReasonCodes.BOOLEAN_AND_UNSATISFIED).toBe('RULES_BOOLEAN_AND_UNSATISFIED');
    expect(EvaluationReasonCodes.BOOLEAN_OR_SATISFIED).toBe('RULES_BOOLEAN_OR_SATISFIED');
    expect(EvaluationReasonCodes.BOOLEAN_OR_UNSATISFIED).toBe('RULES_BOOLEAN_OR_UNSATISFIED');
    expect(EvaluationReasonCodes.BOOLEAN_NOT_SATISFIED).toBe('RULES_BOOLEAN_NOT_SATISFIED');
    expect(EvaluationReasonCodes.BOOLEAN_NOT_UNSATISFIED).toBe('RULES_BOOLEAN_NOT_UNSATISFIED');
    expect(EvaluationReasonCodes.HARD_EXCLUSION).toBe('RULES_HARD_EXCLUSION');
  });

  it('demonstrates that changing human-readable copy does NOT alter reason code identity', () => {
    const reasonV1 = createEngineReason({
      code: EvaluationReasonCodes.PRICE_EXCEEDS_MAXIMUM,
      message: 'Precio excede el presupuesto.',
      impact: -40,
      severity: 'HARD',
    });

    const reasonV2 = createEngineReason({
      code: EvaluationReasonCodes.PRICE_EXCEEDS_MAXIMUM,
      message: 'El importe solicitado supera el umbral máximo de compra configurado.',
      impact: -40,
      severity: 'HARD',
    });

    // Reason code is the primary key identity
    expect(reasonV1.code).toBe(reasonV2.code);
    expect(reasonV1.message).not.toBe(reasonV2.message);
  });

  it('enforces that EvaluationReasonCodes is runtime immutable (frozen) and immune to mutation attempts', () => {
    // 1. Runtime freeze check
    expect(Object.isFrozen(EvaluationReasonCodes)).toBe(true);

    // 2. Attempting to mutate REQUIRED_TERM_MATCH throws in strict mode
    expect(() => {
      // @ts-expect-error - testing runtime immutability against mutation
      EvaluationReasonCodes.REQUIRED_TERM_MATCH = 'MUTATED_CODE';
    }).toThrow(TypeError);

    // 3. Create a RequiredTermsRule with fixed inputs and evaluate
    const rule = new RequiredTermsRule({
      terms: ['Nintendo'],
      impactPerTerm: 30,
    });
    const evalContext = createMockRuleEvaluationContext({
      observationOverrides: {
        title: 'Nintendo Switch Lite Azul',
        description: 'Impecable estado con cargador',
      },
    });

    const eval1 = evaluateRules([rule], evalContext, defaultPolicy);
    expect(eval1.reasons[0]?.code).toBe(EvaluationReasonCodes.REQUIRED_TERM_MATCH);
    expect(eval1.reasons[0]?.code).toBe('RULES_REQUIRED_TERM_MATCH');

    // 4. Attempt to mutate the catalog again
    expect(() => {
      // @ts-expect-error - testing runtime immutability against mutation
      EvaluationReasonCodes.DEFAULT_BASELINE = 'MUTATED_BASELINE';
    }).toThrow(TypeError);

    // 5. Re-evaluate with exact same inputs
    const eval2 = evaluateRules([rule], evalContext, defaultPolicy);

    // 6. Complete semantic identity
    expect(eval2.decision).toBe(eval1.decision);
    expect(eval2.score).toBe(eval1.score);
    expect(eval2.reasons).toEqual(eval1.reasons);
    expect(eval2.evaluatedBy).toEqual(eval1.evaluatedBy);
    expect(eval2.policyVersion).toBe(eval1.policyVersion);
    expect(eval2.policyVersion).toBe('1.0.0');

    // 7. Contractual strings preserved
    expect(EvaluationReasonCodes.REQUIRED_TERM_MATCH).toBe('RULES_REQUIRED_TERM_MATCH');
    expect(EvaluationReasonCodes.DEFAULT_BASELINE).toBe('RULES_DEFAULT_BASELINE');
  });
});
