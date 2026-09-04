import {
  InvariantViolationError,
  type EvaluationReason,
  type EvaluationSeverity,
} from '@busca-ofertas-ai/core';
import { type BooleanExpressionNode } from '../domain/expression.js';
import { type Rule } from '../domain/rule.js';
import { type RuleResult, createRuleResult } from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

const SEVERITY_LEVEL: Record<EvaluationSeverity, number> = {
  HARD: 2,
  SOFT: 1,
  INFO: 0,
};

const maxSeverity = (a: EvaluationSeverity, b: EvaluationSeverity): EvaluationSeverity => {
  return SEVERITY_LEVEL[a] >= SEVERITY_LEVEL[b] ? a : b;
};

/**
 * Evaluates a validated BooleanExpression AST against a set of registered rules and context.
 *
 * Semantic Guarantees:
 * - AND: Satisified iff ALL child expressions are satisfied.
 * - OR: Satisfied iff AT LEAST ONE child expression is satisfied.
 * - NOT: Satisfied iff the child expression is NOT satisfied.
 * - HARD INVARIANT: Any child that produces a HARD rejection will ALWAYS propagate its HARD reason
 *   and enforce HARD severity, ensuring a boolean combinator never masks a deterministic HARD rejection.
 */
export const evaluateBooleanExpression = (
  node: BooleanExpressionNode,
  rulesById: ReadonlyMap<string, Rule>,
  context: RuleEvaluationContext,
): RuleResult => {
  switch (node.kind) {
    case 'RULE': {
      const rule = rulesById.get(node.ruleId);
      if (!rule) {
        throw new InvariantViolationError(
          `Rule with id '${node.ruleId}' not found in registered rules`,
        );
      }
      return rule.evaluate(context);
    }

    case 'AND': {
      const childResults = node.expressions.map((expr) =>
        evaluateBooleanExpression(expr, rulesById, context),
      );

      const allTriggered = childResults.every((res) => res.triggered);
      const allReasons: EvaluationReason[] = [];
      let overallSeverity: EvaluationSeverity = 'INFO';

      for (const res of childResults) {
        allReasons.push(...res.reasons);
        overallSeverity = maxSeverity(overallSeverity, res.severity);
      }

      // Check if any child had HARD reason
      const hasHard = allReasons.some((r) => r.severity === 'HARD');
      if (hasHard) {
        overallSeverity = 'HARD';
      }

      if (allTriggered) {
        const totalImpact = childResults.reduce((acc, res) => acc + res.impact, 0);
        return createRuleResult({
          ruleId: 'composite_and',
          triggered: true,
          impact: totalImpact,
          severity: overallSeverity,
          reasons: allReasons,
        });
      }

      // Unsatisfied AND
      allReasons.push(
        createEngineReason({
          code: EvaluationReasonCodes.BOOLEAN_AND_UNSATISFIED,
          message:
            'Expresión lógica AND no satisfecha: una o más condiciones requeridas no se cumplieron.',
          impact: 0,
          severity: hasHard ? 'HARD' : 'INFO',
        }),
      );

      return createRuleResult({
        ruleId: 'composite_and',
        triggered: false,
        impact: 0,
        severity: hasHard ? 'HARD' : 'INFO',
        reasons: allReasons,
      });
    }

    case 'OR': {
      const childResults = node.expressions.map((expr) =>
        evaluateBooleanExpression(expr, rulesById, context),
      );

      const satisfiedChildren = childResults.filter((res) => res.triggered);
      const anyTriggered = satisfiedChildren.length > 0;

      // Extract all HARD reasons from ALL children (even unsatisfied ones!)
      // A HARD rejection must NEVER be hidden by an OR branch.
      const hardReasonsFromAnyChild: EvaluationReason[] = [];
      for (const res of childResults) {
        for (const r of res.reasons) {
          if (r.severity === 'HARD') {
            hardReasonsFromAnyChild.push(r);
          }
        }
      }
      const hasHard = hardReasonsFromAnyChild.length > 0;

      if (anyTriggered) {
        // Impact is the maximum impact among satisfied branches
        const maxImpact = Math.max(...satisfiedChildren.map((c) => c.impact));
        const combinedReasons: EvaluationReason[] = [];
        let overallSeverity: EvaluationSeverity = 'INFO';

        for (const res of satisfiedChildren) {
          combinedReasons.push(...res.reasons);
          overallSeverity = maxSeverity(overallSeverity, res.severity);
        }

        // Propagate any HARD reasons if encountered
        if (hasHard) {
          for (const hr of hardReasonsFromAnyChild) {
            if (!combinedReasons.some((r) => r.code === hr.code && r.message === hr.message)) {
              combinedReasons.push(hr);
            }
          }
          overallSeverity = 'HARD';
        }

        return createRuleResult({
          ruleId: 'composite_or',
          triggered: true,
          impact: maxImpact,
          severity: overallSeverity,
          reasons: combinedReasons,
        });
      }

      // Unsatisfied OR
      const allReasons: EvaluationReason[] = [];
      for (const res of childResults) {
        allReasons.push(...res.reasons);
      }
      allReasons.push(
        createEngineReason({
          code: EvaluationReasonCodes.BOOLEAN_OR_UNSATISFIED,
          message: 'Expresión lógica OR no satisfecha: ninguna de las alternativas se cumplió.',
          impact: 0,
          severity: hasHard ? 'HARD' : 'INFO',
        }),
      );

      return createRuleResult({
        ruleId: 'composite_or',
        triggered: false,
        impact: 0,
        severity: hasHard ? 'HARD' : 'INFO',
        reasons: allReasons,
      });
    }

    case 'NOT': {
      const childResult = evaluateBooleanExpression(node.expression, rulesById, context);

      // Check if child had a HARD rejection
      const hasHard = childResult.reasons.some((r) => r.severity === 'HARD');

      if (!childResult.triggered) {
        // Condition was NOT triggered, so NOT expression is SATISFIED
        const reasons: EvaluationReason[] = [
          createEngineReason({
            code: EvaluationReasonCodes.BOOLEAN_NOT_SATISFIED,
            message: 'Expresión lógica NOT satisfecha: la condición evaluada no se activó.',
            impact: 0,
            severity: hasHard ? 'HARD' : 'INFO',
          }),
        ];

        // If child had a HARD reason, preserve it fail-closed
        if (hasHard) {
          for (const r of childResult.reasons) {
            if (r.severity === 'HARD') {
              reasons.push(r);
            }
          }
        }

        return createRuleResult({
          ruleId: 'composite_not',
          triggered: true,
          impact: 0,
          severity: hasHard ? 'HARD' : 'INFO',
          reasons,
        });
      }

      // Child WAS triggered, so NOT expression is UNSATISFIED
      const reasons: EvaluationReason[] = [...childResult.reasons];
      reasons.push(
        createEngineReason({
          code: EvaluationReasonCodes.BOOLEAN_NOT_UNSATISFIED,
          message: 'Expresión lógica NOT no satisfecha: la condición excluida se activó.',
          impact: 0,
          severity: hasHard ? 'HARD' : 'INFO',
        }),
      );

      return createRuleResult({
        ruleId: 'composite_not',
        triggered: false,
        impact: childResult.impact < 0 ? childResult.impact : -childResult.impact,
        severity: hasHard ? 'HARD' : childResult.severity,
        reasons,
      });
    }
  }
};
