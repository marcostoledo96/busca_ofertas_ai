import { type EvaluationSeverity } from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import {
  type RuleResult,
  createNotTriggeredResult,
  createRuleResult,
} from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

export interface PriceRangeRuleOptions {
  readonly id?: string;
  readonly name?: string;
  readonly exceedsMaxSeverity?: EvaluationSeverity;
  readonly belowMinSeverity?: EvaluationSeverity;
}

/**
 * Generic rule evaluating listing price against search price policy boundaries.
 */
export class PriceRangeRule implements Rule {
  public readonly id: string;
  public readonly name: string;
  private readonly exceedsMaxSeverity: EvaluationSeverity;
  private readonly belowMinSeverity: EvaluationSeverity;

  constructor(options?: PriceRangeRuleOptions) {
    this.id = options?.id ?? 'rule_price_range';
    this.name = options?.name ?? 'Price Policy Range Rule';
    this.exceedsMaxSeverity = options?.exceedsMaxSeverity ?? 'HARD';
    this.belowMinSeverity = options?.belowMinSeverity ?? 'SOFT';
  }

  public evaluate(context: RuleEvaluationContext): RuleResult {
    const pricePolicy = context.savedSearch.price;
    if (!pricePolicy) {
      return createNotTriggeredResult(this.id);
    }

    const price = context.observation.price;
    if (!price || price.amount === null) {
      const reason = createEngineReason({
        code: EvaluationReasonCodes.PRICE_MISSING,
        message: 'No se pudo determinar un importe numérico para la publicación.',
        impact: -20,
        severity: 'SOFT',
      });
      return createRuleResult({
        ruleId: this.id,
        triggered: true,
        impact: -20,
        severity: 'SOFT',
        reasons: [reason],
      });
    }

    // Check maximum budget
    if (pricePolicy.maximum !== undefined && pricePolicy.maximum !== null) {
      if (price.amount > pricePolicy.maximum) {
        const reason = createEngineReason({
          code: EvaluationReasonCodes.PRICE_EXCEEDS_MAXIMUM,
          message: `El precio (${price.amount} ${price.currency}) excede el presupuesto máximo establecido (${pricePolicy.maximum} ${pricePolicy.targetCurrency}).`,
          impact: this.exceedsMaxSeverity === 'HARD' ? 0 : -50,
          severity: this.exceedsMaxSeverity,
          evidence: `amount: ${price.amount}, maximum: ${pricePolicy.maximum}`,
        });
        return createRuleResult({
          ruleId: this.id,
          triggered: true,
          impact: this.exceedsMaxSeverity === 'HARD' ? 0 : -50,
          severity: this.exceedsMaxSeverity,
          reasons: [reason],
        });
      }
    }

    // Check minimum plausible price (filter out suspiciously low amounts, e.g. accessories, fake quotes)
    if (pricePolicy.minimumPlausible !== undefined && pricePolicy.minimumPlausible !== null) {
      if (price.amount < pricePolicy.minimumPlausible) {
        const reason = createEngineReason({
          code: EvaluationReasonCodes.PRICE_BELOW_MINIMUM_PLAUSIBLE,
          message: `El precio (${price.amount} ${price.currency}) es inferior al mínimo plausible (${pricePolicy.minimumPlausible} ${pricePolicy.targetCurrency}). Posible seña, accesorio o precio señuelo.`,
          impact: -30,
          severity: this.belowMinSeverity,
          evidence: `amount: ${price.amount}, minimumPlausible: ${pricePolicy.minimumPlausible}`,
        });
        return createRuleResult({
          ruleId: this.id,
          triggered: true,
          impact: -30,
          severity: this.belowMinSeverity,
          reasons: [reason],
        });
      }
    }

    // Price is within acceptable range
    const reason = createEngineReason({
      code: EvaluationReasonCodes.PRICE_WITHIN_LIMIT,
      message: `El precio (${price.amount} ${price.currency}) se encuentra dentro del rango aceptable.`,
      impact: 25,
      severity: 'INFO',
      evidence: `amount: ${price.amount}`,
    });

    return createRuleResult({
      ruleId: this.id,
      triggered: true,
      impact: 25,
      severity: 'INFO',
      reasons: [reason],
    });
  }
}
