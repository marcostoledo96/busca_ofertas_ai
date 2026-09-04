import { describe, it, expect } from 'vitest';
import { InvariantViolationError, createEvaluationReason } from '@busca-ofertas-ai/core';
import {
  evaluateRules,
  reconcilePostAiEvaluation,
  EvaluationReasonCodes,
  createEngineReason,
  evaluateBooleanExpression,
  type BooleanExpressionNode,
  type Rule,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Hard Rejection Absolute Invariant', () => {
  const context = createMockRuleEvaluationContext();
  const defaultPolicy = context.savedSearch.evaluation;

  const hardRule = createMockRule('rule_hard_rejection', {
    triggered: true,
    impact: 0,
    severity: 'HARD',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.HARD_EXCLUSION,
        message: 'Artículo expresamente prohibido por reglas deterministas.',
        impact: 0,
        severity: 'HARD',
      }),
    ],
  });

  const positiveRule1 = createMockRule('rule_pos_1', {
    triggered: true,
    impact: 50,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
        message: 'Gran coincidencia de título',
        impact: 50,
        severity: 'SOFT',
      }),
    ],
  });

  const positiveRule2 = createMockRule('rule_pos_2', {
    triggered: true,
    impact: 50,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.PRICE_WITHIN_LIMIT,
        message: 'Precio excelente',
        impact: 50,
        severity: 'INFO',
      }),
    ],
  });

  it('forces decision = REJECT even when score reaches 100 and multiple positive signals trigger', () => {
    // Score would be 50 + 50 = 100 (which ordinarily is MATCH), but HARD rejection is present
    const evaluation = evaluateRules(
      [positiveRule1, positiveRule2, hardRule],
      context,
      defaultPolicy,
    );

    expect(evaluation.score).toBe(100);
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.some((r) => r.severity === 'HARD')).toBe(true);
  });

  it('guarantees decision = REJECT regardless of rule execution order (order invariance of HARD)', () => {
    // Order 1: Positive, Positive, HARD
    const evalOrder1 = evaluateRules(
      [positiveRule1, positiveRule2, hardRule],
      context,
      defaultPolicy,
    );
    expect(evalOrder1.decision).toBe('REJECT');

    // Order 2: HARD, Positive, Positive
    const evalOrder2 = evaluateRules(
      [hardRule, positiveRule1, positiveRule2],
      context,
      defaultPolicy,
    );
    expect(evalOrder2.decision).toBe('REJECT');

    // Order 3: Positive, HARD, Positive
    const evalOrder3 = evaluateRules(
      [positiveRule1, hardRule, positiveRule2],
      context,
      defaultPolicy,
    );
    expect(evalOrder3.decision).toBe('REJECT');

    // All evaluations must be semantically identical
    expect(evalOrder1.score).toBe(evalOrder2.score);
    expect(evalOrder2.score).toBe(evalOrder3.score);
    expect(evalOrder1.reasons.map((r) => r.code)).toEqual(evalOrder2.reasons.map((r) => r.code));
  });

  it('strictly prevents post-AI evaluation from promoting a deterministic HARD rejection to MATCH or REVIEW', () => {
    const deterministicEvaluation = evaluateRules(
      [positiveRule1, hardRule],
      context,
      defaultPolicy,
    );
    expect(deterministicEvaluation.decision).toBe('REJECT');

    // AI tries to promote to MATCH
    expect(() =>
      reconcilePostAiEvaluation(deterministicEvaluation, {
        id: 'ai_eval_1',
        decision: 'MATCH',
        score: 95,
        reasons: [
          createEvaluationReason({
            code: 'AI_MODEL_CONFIRMED',
            message: 'AI hallucinated that the item is valid',
            impact: 95,
            severity: 'INFO',
          }),
        ],
        createdAt: new Date(3000),
      }),
    ).toThrow(InvariantViolationError);

    // AI tries to promote to REVIEW
    expect(() =>
      reconcilePostAiEvaluation(deterministicEvaluation, {
        id: 'ai_eval_2',
        decision: 'REVIEW',
        score: 60,
        reasons: [
          createEvaluationReason({
            code: 'AI_MODEL_UNCERTAIN',
            message: 'AI wants review',
            impact: 60,
            severity: 'INFO',
          }),
        ],
        createdAt: new Date(3000),
      }),
    ).toThrow(InvariantViolationError);
  });

  it('ensures HARD rejection is preserved under boolean composite expressions (never masked by OR)', () => {
    // Boolean expression: OR(rule_pos_1, rule_hard_rejection)
    // Even though rule_pos_1 is triggered and satisfied, rule_hard_rejection has a HARD rejection.
    const rulesMap = new Map<string, Rule>([
      [positiveRule1.id, positiveRule1],
      [hardRule.id, hardRule],
    ]);

    const orNode: BooleanExpressionNode = {
      kind: 'OR',
      expressions: [
        { kind: 'RULE', ruleId: positiveRule1.id },
        { kind: 'RULE', ruleId: hardRule.id },
      ],
    };

    const compositeResult = evaluateBooleanExpression(orNode, rulesMap, context);

    expect(compositeResult.triggered).toBe(true);
    expect(compositeResult.severity).toBe('HARD');
    expect(compositeResult.reasons.some((r) => r.severity === 'HARD')).toBe(true);
  });
});
