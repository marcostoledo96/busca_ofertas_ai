import { type EvaluationSeverity } from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import {
  type RuleResult,
  createNotTriggeredResult,
  createRuleResult,
} from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

export interface ConditionRuleOptions {
  readonly id?: string;
  readonly name?: string;
  readonly rejectedSeverity?: EvaluationSeverity;
}

/**
 * Generic rule evaluating listing condition against search condition policy.
 */
export class ConditionRule implements Rule {
  public readonly id: string;
  public readonly name: string;
  private readonly rejectedSeverity: EvaluationSeverity;

  constructor(options?: ConditionRuleOptions) {
    this.id = options?.id ?? 'rule_condition';
    this.name = options?.name ?? 'Listing Condition Rule';
    this.rejectedSeverity = options?.rejectedSeverity ?? 'SOFT';
  }

  public evaluate(context: RuleEvaluationContext): RuleResult {
    const conditionPolicy = context.savedSearch.condition;
    if (!conditionPolicy || conditionPolicy.accepted.length === 0) {
      return createNotTriggeredResult(this.id);
    }

    const condition = context.observation.condition;
    if (!condition) {
      const reason = createEngineReason({
        code: EvaluationReasonCodes.CONDITION_UNKNOWN,
        message: 'La condición de la publicación no está declarada ni pudo inferirse.',
        impact: -10,
        severity: 'INFO',
      });
      return createRuleResult({
        ruleId: this.id,
        triggered: true,
        impact: -10,
        severity: 'INFO',
        reasons: [reason],
      });
    }

    if (!conditionPolicy.accepted.includes(condition)) {
      const reason = createEngineReason({
        code: EvaluationReasonCodes.CONDITION_REJECTED,
        message: `La condición observada (${condition}) no figura entre las aceptadas (${conditionPolicy.accepted.join(', ')}).`,
        impact: this.rejectedSeverity === 'HARD' ? 0 : -40,
        severity: this.rejectedSeverity,
        evidence: `condition: ${condition}, accepted: [${conditionPolicy.accepted.join(', ')}]`,
      });
      return createRuleResult({
        ruleId: this.id,
        triggered: true,
        impact: this.rejectedSeverity === 'HARD' ? 0 : -40,
        severity: this.rejectedSeverity,
        reasons: [reason],
      });
    }

    const reason = createEngineReason({
      code: EvaluationReasonCodes.CONDITION_ACCEPTED,
      message: `La condición (${condition}) coincide con las aceptadas por la búsqueda.`,
      impact: 15,
      severity: 'INFO',
      evidence: `condition: ${condition}`,
    });

    return createRuleResult({
      ruleId: this.id,
      triggered: true,
      impact: 15,
      severity: 'INFO',
      reasons: [reason],
    });
  }
}
