import { describe, it, expect } from 'vitest';
import { InvariantViolationError } from '@busca-ofertas-ai/core';
import { computeScore, evaluateRules } from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Score Calculation & Threshold Boundaries', () => {
  const context = createMockRuleEvaluationContext();

  describe('Pure Score Algebra & Clamping', () => {
    it('clamps score at inferior bound 0 and superior bound 100', () => {
      expect(computeScore(0, [-100])).toBe(0);
      expect(computeScore(0, [-10, -20, -50])).toBe(0);
      expect(computeScore(0, [-9999])).toBe(0);

      expect(computeScore(0, [150])).toBe(100);
      expect(computeScore(50, [60, 40])).toBe(100);
      expect(computeScore(0, [9999])).toBe(100);
    });

    it('accurately computes positive, negative and mixed multiple impacts', () => {
      expect(computeScore(0, [25, 35, 10])).toBe(70);
      expect(computeScore(50, [-15, 20, -5])).toBe(50);
      expect(computeScore(100, [-20, -30])).toBe(50);
    });

    it('strictly rejects NaN, Infinity, -Infinity and non-finite inputs', () => {
      expect(() => computeScore(NaN, [10])).toThrow(InvariantViolationError);
      expect(() => computeScore(Infinity, [10])).toThrow(InvariantViolationError);
      expect(() => computeScore(-Infinity, [10])).toThrow(InvariantViolationError);

      expect(() => computeScore(0, [NaN])).toThrow(InvariantViolationError);
      expect(() => computeScore(0, [Infinity])).toThrow(InvariantViolationError);
      expect(() => computeScore(0, [-Infinity])).toThrow(InvariantViolationError);
      expect(() => computeScore(0, [20, NaN, 10])).toThrow(InvariantViolationError);
    });

    it('demonstrates strict commutativity across impact permutations', () => {
      const impactsA = [12, -7, 45, -18, 33];
      const impactsB = [33, -18, 12, 45, -7];
      const impactsC = [-7, -18, 12, 33, 45];

      const scoreA = computeScore(10, impactsA);
      const scoreB = computeScore(10, impactsB);
      const scoreC = computeScore(10, impactsC);

      expect(scoreA).toBe(scoreB);
      expect(scoreB).toBe(scoreC);
    });
  });

  describe('Threshold Decision Mapping Matrix', () => {
    // Contractual policy with BALANCED profile (modifier 0)
    const policy = {
      matchThreshold: 80,
      reviewThreshold: 40,
      precisionProfile: 'BALANCED' as const,
    };

    const runThresholdTest = (scoreTarget: number) => {
      const rule = createMockRule('score_rule', {
        triggered: true,
        impact: scoreTarget,
        severity: 'SOFT',
      });
      return evaluateRules([rule], context, policy, { baseScore: 0 });
    };

    it('evaluates exactly score = 0 -> REJECT', () => {
      const result = runThresholdTest(0);
      expect(result.score).toBe(0);
      expect(result.decision).toBe('REJECT');
    });

    it('evaluates score just below reviewThreshold (reviewThreshold - 1) -> REJECT', () => {
      const result = runThresholdTest(39);
      expect(result.score).toBe(39);
      expect(result.decision).toBe('REJECT');
    });

    it('evaluates score exactly at reviewThreshold (40) -> REVIEW', () => {
      const result = runThresholdTest(40);
      expect(result.score).toBe(40);
      expect(result.decision).toBe('REVIEW');
    });

    it('evaluates score just above reviewThreshold (reviewThreshold + 1) -> REVIEW', () => {
      const result = runThresholdTest(41);
      expect(result.score).toBe(41);
      expect(result.decision).toBe('REVIEW');
    });

    it('evaluates score midway between thresholds (60) -> REVIEW', () => {
      const result = runThresholdTest(60);
      expect(result.score).toBe(60);
      expect(result.decision).toBe('REVIEW');
    });

    it('evaluates score just below matchThreshold (matchThreshold - 1 = 79) -> REVIEW', () => {
      const result = runThresholdTest(79);
      expect(result.score).toBe(79);
      expect(result.decision).toBe('REVIEW');
    });

    it('evaluates score exactly at matchThreshold (80) -> MATCH', () => {
      const result = runThresholdTest(80);
      expect(result.score).toBe(80);
      expect(result.decision).toBe('MATCH');
    });

    it('evaluates score just above matchThreshold (matchThreshold + 1 = 81) -> MATCH', () => {
      const result = runThresholdTest(81);
      expect(result.score).toBe(81);
      expect(result.decision).toBe('MATCH');
    });

    it('evaluates maximum clamped score = 100 -> MATCH', () => {
      const result = runThresholdTest(100);
      expect(result.score).toBe(100);
      expect(result.decision).toBe('MATCH');
    });

    it('evaluates beyond bounds (150 clamped to 100) -> MATCH', () => {
      const result = runThresholdTest(150);
      expect(result.score).toBe(100);
      expect(result.decision).toBe('MATCH');
    });
  });
});
