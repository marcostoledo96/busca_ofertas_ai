import { type EvaluationReason, type EvaluationSeverity } from '@busca-ofertas-ai/core';

const SEVERITY_ORDER: Record<EvaluationSeverity, number> = {
  HARD: 0,
  SOFT: 1,
  INFO: 2,
};

/**
 * Deterministically orders evaluation reasons:
 * 1. Severity: HARD > SOFT > INFO
 * 2. Reason code lexicographically ascending
 * 3. Message lexicographically ascending
 * 4. Evidence lexicographically ascending
 */
export const sortReasonsCanonically = (
  reasons: readonly EvaluationReason[],
): readonly EvaluationReason[] => {
  return [...reasons].sort((a, b) => {
    // 1. Severity
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) {
      return sevDiff;
    }

    // 2. Code
    const codeDiff = a.code.localeCompare(b.code);
    if (codeDiff !== 0) {
      return codeDiff;
    }

    // 3. Message
    const msgDiff = a.message.localeCompare(b.message);
    if (msgDiff !== 0) {
      return msgDiff;
    }

    // 4. Evidence
    const evA = a.evidence ?? '';
    const evB = b.evidence ?? '';
    return evA.localeCompare(evB);
  });
};
