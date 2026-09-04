import { describe, it, expect } from 'vitest';
import {
  computeScore,
  evaluateRules,
  EvaluationReasonCodes,
  createEngineReason,
  type Rule,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

/**
 * Deterministic Linear Congruential Generator (LCG) for reproducible property-based testing
 * without introducing external non-standard dependencies.
 */
class DeterministicRng {
  private state: number;

  constructor(seed = 42) {
    this.state = seed >>> 0;
  }

  public nextFloat(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  public shuffle<T>(array: readonly T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }
}

describe('packages/rules-engine — Property-Based Invariant Verification', () => {
  const context = createMockRuleEvaluationContext();
  const policy = {
    matchThreshold: 80,
    reviewThreshold: 40,
    precisionProfile: 'BALANCED' as const,
  };

  it('Property 1: score is strictly clamped in [0, 100] across 200 random impact sequences', () => {
    const rng = new DeterministicRng(1001);

    for (let iteration = 0; iteration < 200; iteration++) {
      const baseScore = rng.nextInt(-200, 200);
      const impactCount = rng.nextInt(1, 30);
      const impacts: number[] = [];

      for (let i = 0; i < impactCount; i++) {
        impacts.push(rng.nextInt(-250, 250));
      }

      const score = computeScore(baseScore, impacts);

      expect(Number.isFinite(score)).toBe(true);
      expect(Number.isNaN(score)).toBe(false);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('Property 2: HARD severity reason unconditionally implies decision === REJECT across 100 random combinations', () => {
    const rng = new DeterministicRng(2002);

    for (let iteration = 0; iteration < 100; iteration++) {
      const ruleCount = rng.nextInt(2, 10);
      const hardPosition = rng.nextInt(0, ruleCount - 1);
      const rules: Rule[] = [];

      for (let i = 0; i < ruleCount; i++) {
        if (i === hardPosition) {
          rules.push(
            createMockRule(`rule_hard_${iteration}_${i}`, {
              triggered: true,
              impact: 0,
              severity: 'HARD',
              reasons: [
                createEngineReason({
                  code: EvaluationReasonCodes.HARD_EXCLUSION,
                  message: `Rechazo duro en posición ${i}`,
                  impact: 0,
                  severity: 'HARD',
                }),
              ],
            }),
          );
        } else {
          // Add heavy positive soft scores
          rules.push(
            createMockRule(`rule_soft_${iteration}_${i}`, {
              triggered: true,
              impact: rng.nextInt(10, 100),
              severity: 'SOFT',
              reasons: [
                createEngineReason({
                  code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
                  message: `Match suave en posición ${i}`,
                  impact: 50,
                  severity: 'SOFT',
                }),
              ],
            }),
          );
        }
      }

      const evaluation = evaluateRules(rules, context, policy, { baseScore: rng.nextInt(0, 100) });

      // Invariant: MUST be REJECT
      expect(evaluation.decision).toBe('REJECT');
      expect(evaluation.reasons.some((r) => r.severity === 'HARD')).toBe(true);
    }
  });

  it('Property 3: Rule permutation invariance holds across 100 arbitrary shuffles', () => {
    const rng = new DeterministicRng(3003);

    const baseRules: Rule[] = [
      createMockRule('rule_1', {
        triggered: true,
        impact: 15,
        severity: 'SOFT',
        reasons: [
          createEngineReason({
            code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
            message: 'R1',
            impact: 15,
            severity: 'SOFT',
          }),
        ],
      }),
      createMockRule('rule_2', {
        triggered: true,
        impact: 30,
        severity: 'SOFT',
        reasons: [
          createEngineReason({
            code: EvaluationReasonCodes.PRICE_WITHIN_LIMIT,
            message: 'R2',
            impact: 30,
            severity: 'INFO',
          }),
        ],
      }),
      createMockRule('rule_3', {
        triggered: false,
        impact: 0,
        severity: 'INFO',
        reasons: [],
      }),
      createMockRule('rule_4', {
        triggered: true,
        impact: -10,
        severity: 'SOFT',
        reasons: [
          createEngineReason({
            code: EvaluationReasonCodes.CONDITION_UNKNOWN,
            message: 'R4',
            impact: -10,
            severity: 'INFO',
          }),
        ],
      }),
      createMockRule('rule_5', {
        triggered: true,
        impact: 20,
        severity: 'SOFT',
        reasons: [
          createEngineReason({
            code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
            message: 'R5',
            impact: 20,
            severity: 'SOFT',
          }),
        ],
      }),
    ];

    const baselineResult = evaluateRules(baseRules, context, policy, {
      baseScore: 10,
      evaluationId: 'eval_fixed_prop',
      createdAt: new Date(1000),
    });

    for (let iteration = 0; iteration < 100; iteration++) {
      const shuffledRules = rng.shuffle(baseRules);
      const result = evaluateRules(shuffledRules, context, policy, {
        baseScore: 10,
        evaluationId: 'eval_fixed_prop',
        createdAt: new Date(1000),
      });

      expect(result.score).toBe(baselineResult.score);
      expect(result.decision).toBe(baselineResult.decision);
      expect(result.reasons).toEqual(baselineResult.reasons);
    }
  });
});
