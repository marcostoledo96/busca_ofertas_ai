import { describe, it, expect } from 'vitest';
import {
  evaluateRules,
  EvaluationReasonCodes,
  createEngineReason,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Determinism & Immutability', () => {
  const context = createMockRuleEvaluationContext();
  const policy = context.savedSearch.evaluation;

  const ruleA = createMockRule('rule_alpha', {
    triggered: true,
    impact: 25,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
        message: 'Coincidencia de término alfa',
        impact: 25,
        severity: 'SOFT',
        evidence: 'alfa',
      }),
    ],
  });

  const ruleB = createMockRule('rule_beta', {
    triggered: true,
    impact: 35,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.PRICE_WITHIN_LIMIT,
        message: 'Precio beta adecuado',
        impact: 35,
        severity: 'INFO',
        evidence: 'beta',
      }),
    ],
  });

  const ruleC = createMockRule('rule_gamma', {
    triggered: true,
    impact: -10,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.CONDITION_UNKNOWN,
        message: 'Condición gamma desconocida',
        impact: -10,
        severity: 'INFO',
        evidence: 'gamma',
      }),
    ],
  });

  it('produces identical evaluation output across multiple repeated executions with the same input', () => {
    const rules = [ruleA, ruleB, ruleC];

    const eval1 = evaluateRules(rules, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });
    const eval2 = evaluateRules(rules, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });
    const eval3 = evaluateRules(rules, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });

    expect(eval1).toEqual(eval2);
    expect(eval2).toEqual(eval3);
  });

  it('guarantees strict permutation invariance across independent rules: same score, decision, and canonical reason ordering', () => {
    const perm1 = [ruleA, ruleB, ruleC];
    const perm2 = [ruleC, ruleA, ruleB];
    const perm3 = [ruleB, ruleC, ruleA];
    const perm4 = [ruleC, ruleB, ruleA];

    const res1 = evaluateRules(perm1, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });
    const res2 = evaluateRules(perm2, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });
    const res3 = evaluateRules(perm3, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });
    const res4 = evaluateRules(perm4, context, policy, {
      baseScore: 0,
      evaluationId: 'eval_fixed',
      createdAt: new Date(1000),
    });

    // Compare decision
    expect(res1.decision).toBe(res2.decision);
    expect(res2.decision).toBe(res3.decision);
    expect(res3.decision).toBe(res4.decision);

    // Compare score
    expect(res1.score).toBe(res2.score);
    expect(res2.score).toBe(res3.score);
    expect(res3.score).toBe(res4.score);

    // Compare reasons order
    expect(res1.reasons).toEqual(res2.reasons);
    expect(res2.reasons).toEqual(res3.reasons);
    expect(res3.reasons).toEqual(res4.reasons);

    // Full object equivalence
    expect(res1).toEqual(res2);
    expect(res2).toEqual(res3);
    expect(res3).toEqual(res4);
  });

  it('proves that evaluating rules NEVER mutates input Listing, Observation, SavedSearch, or Policy', () => {
    // Deep freeze input objects to guarantee immutability at runtime
    const frozenContext = createMockRuleEvaluationContext();
    Object.freeze(frozenContext.listing);
    Object.freeze(frozenContext.observation);
    if (frozenContext.observation.price) {
      Object.freeze(frozenContext.observation.price);
    }
    Object.freeze(frozenContext.savedSearch);
    Object.freeze(frozenContext.savedSearch.query);
    Object.freeze(frozenContext.savedSearch.evaluation);

    const frozenPolicy = { ...policy };
    Object.freeze(frozenPolicy);

    const snapshotListing = JSON.stringify(frozenContext.listing);
    const snapshotObservation = JSON.stringify(frozenContext.observation);
    const snapshotSearch = JSON.stringify(frozenContext.savedSearch);
    const snapshotPolicy = JSON.stringify(frozenPolicy);

    // Run evaluation
    const evaluation = evaluateRules([ruleA, ruleB, ruleC], frozenContext, frozenPolicy);
    expect(evaluation).toBeDefined();

    // Verify bitwise JSON equivalence after evaluation
    expect(JSON.stringify(frozenContext.listing)).toBe(snapshotListing);
    expect(JSON.stringify(frozenContext.observation)).toBe(snapshotObservation);
    expect(JSON.stringify(frozenContext.savedSearch)).toBe(snapshotSearch);
    expect(JSON.stringify(frozenPolicy)).toBe(snapshotPolicy);
  });
});
