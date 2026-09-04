import { type RuleEvaluationContext } from './context.js';
import { type RuleResult } from './rule-result.js';

/**
 * Pure, deterministic evaluation rule contract.
 * Every rule inspects the context and returns a structured RuleResult.
 * Rules must not perform I/O, network requests, database queries, or mutate context.
 */
export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  evaluate(context: RuleEvaluationContext): RuleResult;
}
