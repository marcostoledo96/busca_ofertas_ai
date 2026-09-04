import {
  type Evaluation,
  type EvaluationDecision,
  type EvaluationPolicy,
  type EvaluationReason,
  type Clock,
  type IdGenerator,
  createEvaluation,
  hasHardRejection,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';
import { type Rule } from '../domain/rule.js';
import { type RuleResult } from '../domain/rule-result.js';
import { type RuleEvaluationContext } from '../domain/context.js';
import { EvaluationReasonCodes, createEngineReason } from '../domain/reason-codes.js';
import {
  type PrecisionProfileRegistry,
  type PrecisionProfileConfig,
  resolveStandardPrecisionProfile,
} from '../domain/precision-profile.js';
import { computeScore } from './score-calculator.js';
import { sortReasonsCanonically } from './reason-aggregator.js';

export const DEFAULT_RULES_POLICY_VERSION = '1.0.0' as const;

export interface EvaluateRulesOptions {
  readonly evaluationId?: string;
  readonly createdAt?: Date;
  readonly policyVersion?: string;
  readonly baseScore?: number;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
  readonly precisionProfileRegistry?: PrecisionProfileRegistry;
}

/**
 * Pure, deterministic evaluation engine.
 *
 * Enforces:
 * 1. HARD Rejection: Any HARD severity reason forces decision = REJECT unconditionally.
 * 2. Deterministic Score: 0 <= score <= 100, clamped integer, order-invariant.
 * 3. Thresholds: matchThreshold > reviewThreshold, mapping to MATCH / REVIEW / REJECT.
 * 4. At least one reason per decision.
 * 5. Deterministic, canonical ordering of reasons.
 * 6. Pure execution without un-injected ambient side effects.
 */
const isReadonlyArray = (val: unknown): val is readonly unknown[] => Array.isArray(val);

export const evaluateRules = (
  rules: readonly Rule[],
  context: RuleEvaluationContext,
  policy: EvaluationPolicy,
  options?: EvaluateRulesOptions,
): Evaluation => {
  if (!isReadonlyArray(rules)) {
    throw new InvariantViolationError('evaluateRules requires a rules array');
  }
  if (!context || typeof context !== 'object') {
    throw new InvariantViolationError('evaluateRules requires a valid RuleEvaluationContext');
  }
  if (!policy || typeof policy !== 'object') {
    throw new InvariantViolationError('evaluateRules requires a valid EvaluationPolicy');
  }

  // 1. Resolve precision profile & enforce canonical explicit versioning for custom profiles
  const profileName = policy.precisionProfile ?? 'MIXED';
  let profile: PrecisionProfileConfig;

  const rawPolicyVersion = options?.policyVersion;
  const canonicalPolicyVersion =
    typeof rawPolicyVersion === 'string' ? rawPolicyVersion.trim() : undefined;

  if (options?.precisionProfileRegistry) {
    if (!canonicalPolicyVersion || canonicalPolicyVersion === DEFAULT_RULES_POLICY_VERSION) {
      throw new InvariantViolationError(
        `Evaluating with a custom precision profile registry requires an explicit 'policyVersion' distinct from default '${DEFAULT_RULES_POLICY_VERSION}' to prevent semantic drift`,
      );
    }
    profile = options.precisionProfileRegistry.get(profileName);
  } else {
    // Pure, stateless resolver reading from deeply frozen STANDARD_PROFILES
    profile = resolveStandardPrecisionProfile(profileName);
  }

  // 2. Compute effective thresholds based on profile
  const rawMatchThreshold = policy.matchThreshold + profile.matchThresholdModifier;
  const rawReviewThreshold = policy.reviewThreshold + profile.reviewThresholdModifier;

  const effectiveMatchThreshold = Math.max(1, Math.min(100, Math.round(rawMatchThreshold)));
  const effectiveReviewThreshold = Math.max(
    0,
    Math.min(effectiveMatchThreshold - 1, Math.round(rawReviewThreshold)),
  );

  // 3. Evaluate all rules
  // To ensure absolute independence and order invariance, we sort rules by id before execution
  // so any minor execution difference or side-effect is strictly mitigated.
  const canonicalRules: Rule[] = rules.slice().sort((a, b) => a.id.localeCompare(b.id));

  const results: RuleResult[] = canonicalRules.map((rule) => rule.evaluate(context));

  // 4. Collect impacts and reasons
  const impacts: number[] = [];
  const rawReasons: EvaluationReason[] = [];

  for (const res of results) {
    if (res.triggered) {
      impacts.push(res.impact);
    }
    // Collect all reasons from the result
    if (res.reasons.length > 0) {
      rawReasons.push(...res.reasons);
    }
  }

  // 5. If no reasons were emitted by any rule, provide a canonical baseline reason
  if (rawReasons.length === 0) {
    rawReasons.push(
      createEngineReason({
        code: EvaluationReasonCodes.DEFAULT_BASELINE,
        message: 'Evaluación determinista completada sin reglas específicas activadas.',
        impact: 0,
        severity: 'INFO',
      }),
    );
  }

  // 6. Deterministic, canonical sorting of reasons
  const canonicallySortedReasons = sortReasonsCanonically(rawReasons);

  // 7. Calculate score
  const baseScore = options?.baseScore ?? profile.defaultBaseScore;
  const finalScore = computeScore(baseScore, impacts);

  // 8. Determine decision
  let decision: EvaluationDecision;

  if (hasHardRejection(canonicallySortedReasons)) {
    // HARD rejection invariant: REJECT is terminal and cannot be compensated
    decision = 'REJECT';
  } else if (finalScore >= effectiveMatchThreshold) {
    decision = 'MATCH';
  } else if (finalScore >= effectiveReviewThreshold) {
    decision = 'REVIEW';
  } else {
    decision = 'REJECT';
  }

  // 9. Generate identity and timestamp cleanly
  const evaluationId =
    options?.evaluationId ??
    options?.idGenerator?.generate() ??
    `eval_rules_${context.listing.id}_${context.observation.id}`;

  const createdAt = options?.createdAt ?? options?.clock?.now() ?? new Date(0);

  const policyVersion =
    canonicalPolicyVersion && canonicalPolicyVersion.length > 0
      ? canonicalPolicyVersion
      : DEFAULT_RULES_POLICY_VERSION;

  return createEvaluation({
    id: evaluationId,
    decision,
    score: finalScore,
    reasons: canonicallySortedReasons,
    evaluatedBy: ['RULES'],
    policyVersion,
    createdAt,
  });
};
