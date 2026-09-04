import { describe, it, expect } from 'vitest';
import { InvariantViolationError } from '@busca-ofertas-ai/core';
import {
  type BooleanExpressionNode,
  type Rule,
  validateBooleanExpression,
  booleanExpressionToRuleExpression,
  ruleExpressionToBooleanExpression,
  evaluateBooleanExpression,
  EvaluationReasonCodes,
  createEngineReason,
} from '@busca-ofertas-ai/rules-engine';
import {
  createMockRuleEvaluationContext,
  createMockRule,
} from '@busca-ofertas-ai/rules-engine/testing';

describe('packages/rules-engine — Boolean Expressions & AST Validation', () => {
  const context = createMockRuleEvaluationContext();

  const ruleA = createMockRule('rule_a', {
    triggered: true,
    impact: 20,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
        message: 'Rule A triggered',
        impact: 20,
        severity: 'SOFT',
      }),
    ],
  });

  const ruleB = createMockRule('rule_b', {
    triggered: true,
    impact: 30,
    severity: 'SOFT',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.PRICE_WITHIN_LIMIT,
        message: 'Rule B triggered',
        impact: 30,
        severity: 'INFO',
      }),
    ],
  });

  const ruleC = createMockRule('rule_c', {
    triggered: false,
    impact: 0,
    severity: 'INFO',
    reasons: [],
  });

  const ruleHard = createMockRule('rule_hard', {
    triggered: true,
    impact: 0,
    severity: 'HARD',
    reasons: [
      createEngineReason({
        code: EvaluationReasonCodes.HARD_EXCLUSION,
        message: 'Rule Hard triggered',
        impact: 0,
        severity: 'HARD',
      }),
    ],
  });

  const rulesMap = new Map<string, Rule>([
    [ruleA.id, ruleA],
    [ruleB.id, ruleB],
    [ruleC.id, ruleC],
    [ruleHard.id, ruleHard],
  ]);

  const availableIds = new Set(['rule_a', 'rule_b', 'rule_c', 'rule_hard']);

  describe('AST Defensive Validation', () => {
    it('validates simple and nested expressions', () => {
      const validNested: BooleanExpressionNode = {
        kind: 'AND',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          {
            kind: 'OR',
            expressions: [
              { kind: 'RULE', ruleId: 'rule_b' },
              {
                kind: 'NOT',
                expression: { kind: 'RULE', ruleId: 'rule_c' },
              },
            ],
          },
        ],
      };

      const validated = validateBooleanExpression(validNested, availableIds);
      expect(validated).toEqual(validNested);
    });

    it('rejects invalid or unknown operator/kind', () => {
      expect(() =>
        validateBooleanExpression({ kind: 'XOR', expressions: [] }, availableIds),
      ).toThrow(InvariantViolationError);

      expect(() => validateBooleanExpression({ kind: 123 }, availableIds)).toThrow(
        InvariantViolationError,
      );
    });

    it('rejects unknown ruleId references', () => {
      expect(() =>
        validateBooleanExpression({ kind: 'RULE', ruleId: 'unknown_rule' }, availableIds),
      ).toThrow(InvariantViolationError);
    });

    it('rejects invalid arity in AND, OR, and NOT nodes', () => {
      // AND with <2 children
      expect(() =>
        validateBooleanExpression(
          { kind: 'AND', expressions: [{ kind: 'RULE', ruleId: 'rule_a' }] },
          availableIds,
        ),
      ).toThrow(InvariantViolationError);

      // OR with <2 children
      expect(() =>
        validateBooleanExpression({ kind: 'OR', expressions: [] }, availableIds),
      ).toThrow(InvariantViolationError);

      // NOT with arity != 1 (e.g. missing expression)
      expect(() => validateBooleanExpression({ kind: 'NOT' }, availableIds)).toThrow(
        InvariantViolationError,
      );

      // NOT with an array instead of single expression
      expect(() =>
        validateBooleanExpression(
          { kind: 'NOT', expression: [{ kind: 'RULE', ruleId: 'rule_a' }] },
          availableIds,
        ),
      ).toThrow(InvariantViolationError);
    });

    it('rejects empty nodes, non-objects, and null/undefined', () => {
      expect(() => validateBooleanExpression(null, availableIds)).toThrow(InvariantViolationError);
      expect(() => validateBooleanExpression(undefined, availableIds)).toThrow(
        InvariantViolationError,
      );
      expect(() => validateBooleanExpression({}, availableIds)).toThrow(InvariantViolationError);
      expect(() => validateBooleanExpression('not_an_object', availableIds)).toThrow(
        InvariantViolationError,
      );
    });

    it('detects and rejects circular runtime references', () => {
      interface MutableAndNode {
        kind: 'AND';
        expressions: unknown[];
      }
      const circularNode: MutableAndNode = {
        kind: 'AND',
        expressions: [{ kind: 'RULE', ruleId: 'rule_a' }],
      };
      circularNode.expressions.push(circularNode); // circular link

      expect(() => validateBooleanExpression(circularNode, availableIds)).toThrow(
        /Circular reference detected/,
      );
    });

    it('enforces exact depth boundary of DEFAULT_MAX_DEPTH = 5', () => {
      // Depth 1: root RULE
      const depth1: BooleanExpressionNode = { kind: 'RULE', ruleId: 'rule_a' };
      // Depth 2: NOT(RULE)
      const depth2: BooleanExpressionNode = { kind: 'NOT', expression: depth1 };
      // Depth 3: NOT(NOT(RULE))
      const depth3: BooleanExpressionNode = { kind: 'NOT', expression: depth2 };
      // Depth 4: NOT(NOT(NOT(RULE)))
      const depth4: BooleanExpressionNode = { kind: 'NOT', expression: depth3 };
      // Depth 5: exactly equal to DEFAULT_MAX_DEPTH (5)
      const depth5: BooleanExpressionNode = { kind: 'NOT', expression: depth4 };

      // Depth 5 must succeed
      expect(() => validateBooleanExpression(depth5, availableIds)).not.toThrow();
      const validated = validateBooleanExpression(depth5, availableIds);
      expect(validated.kind).toBe('NOT');

      // Depth 6: exceeds DEFAULT_MAX_DEPTH (5) -> must throw InvariantViolationError
      const depth6: BooleanExpressionNode = { kind: 'NOT', expression: depth5 };
      expect(() => validateBooleanExpression(depth6, availableIds)).toThrow(
        InvariantViolationError,
      );
      expect(() => validateBooleanExpression(depth6, availableIds)).toThrow(
        /exceeds maximum allowed depth of 5/,
      );

      // Custom maxDepth option: maxDepth = 3
      expect(() => validateBooleanExpression(depth3, availableIds, { maxDepth: 3 })).not.toThrow();
      expect(() => validateBooleanExpression(depth4, availableIds, { maxDepth: 3 })).toThrow(
        /exceeds maximum allowed depth of 3/,
      );
    });

    it('enforces exact node count boundary of DEFAULT_MAX_NODES = 50', () => {
      // Construct a wide, valid tree (depth 2) to test node count without tripping depth limit
      // 1 root AND node + 49 child RULE nodes = exactly 50 nodes
      const children49: BooleanExpressionNode[] = Array.from({ length: 49 }, () => ({
        kind: 'RULE' as const,
        ruleId: 'rule_a',
      }));
      const ast50: BooleanExpressionNode = {
        kind: 'AND',
        expressions: children49,
      };

      // Exactly 50 nodes must PASS
      expect(() => validateBooleanExpression(ast50, availableIds)).not.toThrow();
      const validated = validateBooleanExpression(ast50, availableIds);
      expect(validated.kind).toBe('AND');

      // 1 root AND node + 50 child RULE nodes = exactly 51 nodes
      const children50: BooleanExpressionNode[] = Array.from({ length: 50 }, () => ({
        kind: 'RULE' as const,
        ruleId: 'rule_a',
      }));
      const ast51: BooleanExpressionNode = {
        kind: 'AND',
        expressions: children50,
      };

      // 51 nodes must FAIL
      expect(() => validateBooleanExpression(ast51, availableIds)).toThrow(InvariantViolationError);
      expect(() => validateBooleanExpression(ast51, availableIds)).toThrow(
        /exceeds maximum allowed node count of 50/,
      );

      // Custom maxNodes option: maxNodes = 4
      const ast4Nodes: BooleanExpressionNode = {
        kind: 'AND',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          { kind: 'RULE', ruleId: 'rule_b' },
          { kind: 'RULE', ruleId: 'rule_c' },
        ],
      }; // 1 root + 3 children = 4 nodes
      expect(() =>
        validateBooleanExpression(ast4Nodes, availableIds, { maxNodes: 4 }),
      ).not.toThrow();
      expect(() => validateBooleanExpression(ast50, availableIds, { maxNodes: 4 })).toThrow(
        /exceeds maximum allowed node count of 4/,
      );
    });
  });

  describe('Boolean Evaluation Semantics', () => {
    it('evaluates AND node: satisfied only when all children trigger', () => {
      // Both trigger -> satisfied, impacts sum (20 + 30 = 50)
      const andPassing: BooleanExpressionNode = {
        kind: 'AND',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          { kind: 'RULE', ruleId: 'rule_b' },
        ],
      };
      const resultPassing = evaluateBooleanExpression(andPassing, rulesMap, context);
      expect(resultPassing.triggered).toBe(true);
      expect(resultPassing.impact).toBe(50);
      expect(resultPassing.reasons).toHaveLength(2);

      // One does not trigger -> unsatisfied, impact = 0, emits failure reason
      const andFailing: BooleanExpressionNode = {
        kind: 'AND',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          { kind: 'RULE', ruleId: 'rule_c' },
        ],
      };
      const resultFailing = evaluateBooleanExpression(andFailing, rulesMap, context);
      expect(resultFailing.triggered).toBe(false);
      expect(resultFailing.impact).toBe(0);
      expect(
        resultFailing.reasons.some((r) => r.code === EvaluationReasonCodes.BOOLEAN_AND_UNSATISFIED),
      ).toBe(true);
    });

    it('evaluates OR node: satisfied when at least one child triggers', () => {
      // One triggers, one doesn't -> satisfied, impact is max(satisfied)
      const orMixed: BooleanExpressionNode = {
        kind: 'OR',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          { kind: 'RULE', ruleId: 'rule_c' },
        ],
      };
      const resultMixed = evaluateBooleanExpression(orMixed, rulesMap, context);
      expect(resultMixed.triggered).toBe(true);
      expect(resultMixed.impact).toBe(20);

      // Neither triggers -> unsatisfied
      const orNone: BooleanExpressionNode = {
        kind: 'OR',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_c' },
          { kind: 'RULE', ruleId: 'rule_c' },
        ],
      };
      const resultNone = evaluateBooleanExpression(orNone, rulesMap, context);
      expect(resultNone.triggered).toBe(false);
      expect(resultNone.impact).toBe(0);
      expect(
        resultNone.reasons.some((r) => r.code === EvaluationReasonCodes.BOOLEAN_OR_UNSATISFIED),
      ).toBe(true);
    });

    it('evaluates NOT node: inverts satisfaction', () => {
      // Child rule_c did NOT trigger -> NOT is satisfied
      const notSatisfied: BooleanExpressionNode = {
        kind: 'NOT',
        expression: { kind: 'RULE', ruleId: 'rule_c' },
      };
      const resultSatisfied = evaluateBooleanExpression(notSatisfied, rulesMap, context);
      expect(resultSatisfied.triggered).toBe(true);
      expect(
        resultSatisfied.reasons.some((r) => r.code === EvaluationReasonCodes.BOOLEAN_NOT_SATISFIED),
      ).toBe(true);

      // Child rule_a DID trigger -> NOT is unsatisfied
      const notUnsatisfied: BooleanExpressionNode = {
        kind: 'NOT',
        expression: { kind: 'RULE', ruleId: 'rule_a' },
      };
      const resultUnsatisfied = evaluateBooleanExpression(notUnsatisfied, rulesMap, context);
      expect(resultUnsatisfied.triggered).toBe(false);
      expect(
        resultUnsatisfied.reasons.some(
          (r) => r.code === EvaluationReasonCodes.BOOLEAN_NOT_UNSATISFIED,
        ),
      ).toBe(true);
    });

    it('strictly preserves HARD severity when inside NOT expression', () => {
      // Child has HARD rejection. NOT must not negate or drop the HARD rejection!
      const notHard: BooleanExpressionNode = {
        kind: 'NOT',
        expression: { kind: 'RULE', ruleId: 'rule_hard' },
      };
      const result = evaluateBooleanExpression(notHard, rulesMap, context);

      expect(result.triggered).toBe(false);
      expect(result.severity).toBe('HARD');
      expect(result.reasons.some((r) => r.severity === 'HARD')).toBe(true);
    });
  });

  describe('SavedSearch RuleExpression Roundtrip Compatibility', () => {
    it('projects BooleanExpressionNode to RuleExpression and back without data loss', () => {
      const ast: BooleanExpressionNode = {
        kind: 'AND',
        expressions: [
          { kind: 'RULE', ruleId: 'rule_a' },
          { kind: 'RULE', ruleId: 'rule_b' },
        ],
      };

      const domainRuleExpr = booleanExpressionToRuleExpression('composite_test_1', ast);
      expect(domainRuleExpr.id).toBe('composite_test_1');
      expect(domainRuleExpr.type).toBe('COMPOSITE_BOOLEAN');

      const reconstructedAst = ruleExpressionToBooleanExpression(domainRuleExpr, availableIds);
      expect(reconstructedAst).toEqual(ast);
    });
  });
});
