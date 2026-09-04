import { type Rule } from '../domain/rule.js';
import {
  type RuleResult,
  createNotTriggeredResult,
  createRuleResult,
} from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';

export interface RequiredTermsRuleOptions {
  readonly id?: string;
  readonly name?: string;
  readonly terms?: readonly string[];
  readonly impactPerTerm?: number;
  readonly caseSensitive?: boolean;
}

/**
 * Generic rule that evaluates whether required search terms are present in the listing title or description.
 */
export class RequiredTermsRule implements Rule {
  public readonly id: string;
  public readonly name: string;
  private readonly explicitTerms?: readonly string[] | undefined;
  private readonly impactPerTerm: number;
  private readonly caseSensitive: boolean;

  constructor(options?: RequiredTermsRuleOptions) {
    this.id = options?.id ?? 'rule_required_terms';
    this.name = options?.name ?? 'Required Search Terms Rule';
    this.explicitTerms = options?.terms;
    this.impactPerTerm = options?.impactPerTerm ?? 30;
    this.caseSensitive = options?.caseSensitive ?? false;
  }

  public evaluate(context: RuleEvaluationContext): RuleResult {
    const termsToMatch = this.explicitTerms ?? context.savedSearch.query.terms;
    if (!termsToMatch || termsToMatch.length === 0) {
      return createNotTriggeredResult(this.id);
    }

    const title = context.observation.title;
    const description = context.observation.description ?? '';
    const searchableText = `${title} ${description}`;
    const targetText = this.caseSensitive ? searchableText : searchableText.toLowerCase();

    const matchedTerms: string[] = [];
    for (const term of termsToMatch) {
      const normalizedTerm = this.caseSensitive ? term : term.toLowerCase();
      if (normalizedTerm.length > 0 && targetText.includes(normalizedTerm)) {
        matchedTerms.push(term);
      }
    }

    if (matchedTerms.length === 0) {
      return createNotTriggeredResult(this.id);
    }

    const totalImpact = matchedTerms.length * this.impactPerTerm;
    const reason = createEngineReason({
      code: EvaluationReasonCodes.REQUIRED_TERM_MATCH,
      message: `Términos requeridos encontrados: ${matchedTerms.join(', ')}.`,
      impact: totalImpact,
      severity: 'SOFT',
      evidence: `Coincidencias: [${matchedTerms.join(', ')}]`,
    });

    return createRuleResult({
      ruleId: this.id,
      triggered: true,
      impact: totalImpact,
      severity: 'SOFT',
      reasons: [reason],
    });
  }
}
