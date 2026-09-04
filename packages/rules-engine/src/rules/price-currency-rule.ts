import { type EvaluationSeverity } from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import {
  type RuleResult,
  createNotTriggeredResult,
  createRuleResult,
} from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

export interface PriceCurrencyRuleOptions {
  readonly id?: string;
  readonly name?: string;
  readonly ambiguousSeverity?: EvaluationSeverity;
}

/**
 * Generic rule evaluating price currency confidence and alignment.
 */
export class PriceCurrencyRule implements Rule {
  public readonly id: string;
  public readonly name: string;
  private readonly ambiguousSeverity: EvaluationSeverity;

  constructor(options?: PriceCurrencyRuleOptions) {
    this.id = options?.id ?? 'rule_price_currency';
    this.name = options?.name ?? 'Price Currency Rule';
    this.ambiguousSeverity = options?.ambiguousSeverity ?? 'SOFT';
  }

  public evaluate(context: RuleEvaluationContext): RuleResult {
    const price = context.observation.price;
    if (!price) {
      return createNotTriggeredResult(this.id);
    }

    if (price.currency === 'UNKNOWN' || price.resolution === 'AMBIGUOUS') {
      const reason = createEngineReason({
        code: EvaluationReasonCodes.PRICE_AMBIGUOUS_CURRENCY,
        message:
          'La moneda o el importe del precio es ambiguo y no pudo resolverse con certeza suficiente.',
        impact: this.ambiguousSeverity === 'HARD' ? 0 : -35,
        severity: this.ambiguousSeverity,
        evidence: `rawText: "${price.rawText}", currency: ${price.currency}`,
      });

      return createRuleResult({
        ruleId: this.id,
        triggered: true,
        impact: this.ambiguousSeverity === 'HARD' ? 0 : -35,
        severity: this.ambiguousSeverity,
        reasons: [reason],
      });
    }

    return createNotTriggeredResult(this.id);
  }
}
