import { type EvaluationSeverity } from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import {
  type RuleResult,
  createNotTriggeredResult,
  createRuleResult,
} from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

export interface ExcludedTermsRuleOptions {
  readonly id?: string;
  readonly name?: string;
  readonly terms?: readonly string[];
  readonly severity?: EvaluationSeverity;
  readonly impact?: number;
  readonly caseSensitive?: boolean;
}

/**
 * Generic exclusion rule inspired by deterministic exclusion patterns in busca_empleos.
 * Rejects items matching excluded patterns unconditionally before AI evaluation.
 */
export class ExcludedTermsRule implements Rule {
  public readonly id: string;
  public readonly name: string;
  private readonly explicitTerms?: readonly string[] | undefined;
  private readonly severity: EvaluationSeverity;
  private readonly impact: number;
  private readonly caseSensitive: boolean;

  constructor(options?: ExcludedTermsRuleOptions) {
    this.id = options?.id ?? 'rule_excluded_terms';
    this.name = options?.name ?? 'Excluded Terms Rule';
    this.explicitTerms = options?.terms;
    this.severity = options?.severity ?? 'HARD';
    this.impact = options?.impact ?? (this.severity === 'HARD' ? 0 : -50);
    this.caseSensitive = options?.caseSensitive ?? false;
  }

  public evaluate(context: RuleEvaluationContext): RuleResult {
    const termsToCheck = this.explicitTerms ?? context.savedSearch.query.excludedTerms ?? [];
    if (termsToCheck.length === 0) {
      return createNotTriggeredResult(this.id);
    }

    const title = context.observation.title;
    const description = context.observation.description ?? '';
    const searchableText = `${title} ${description}`;
    const targetText = this.caseSensitive ? searchableText : searchableText.toLowerCase();

    const matchedExcluded: string[] = [];
    for (const term of termsToCheck) {
      const normalizedTerm = this.caseSensitive ? term : term.toLowerCase();
      if (normalizedTerm.length > 0 && targetText.includes(normalizedTerm)) {
        matchedExcluded.push(term);
      }
    }

    if (matchedExcluded.length === 0) {
      return createNotTriggeredResult(this.id);
    }

    const reason = createEngineReason({
      code: EvaluationReasonCodes.EXCLUDED_TERM_MATCH,
      message: `Término excluido detectado: ${matchedExcluded.join(', ')}.`,
      impact: this.impact,
      severity: this.severity,
      evidence: `Coincidencias excluidas: [${matchedExcluded.join(', ')}]`,
    });

    return createRuleResult({
      ruleId: this.id,
      triggered: true,
      impact: this.impact,
      severity: this.severity,
      reasons: [reason],
    });
  }
}
