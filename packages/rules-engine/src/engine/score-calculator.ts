import { InvariantViolationError } from '@busca-ofertas-ai/core';

/**
 * Pure, deterministic score calculation and clamping.
 * Invariants:
 * - 0 <= score <= 100
 * - Never NaN, Infinity, or -Infinity
 * - Commutative: Independent rule impact ordering does not alter the resulting score.
 */
export const computeScore = (baseScore: number, impacts: readonly number[]): number => {
  if (typeof baseScore !== 'number' || !Number.isFinite(baseScore)) {
    throw new InvariantViolationError(
      `baseScore must be a finite number, got ${String(baseScore)}`,
    );
  }

  // Defensively validate all impacts
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i];
    if (typeof impact !== 'number' || !Number.isFinite(impact)) {
      throw new InvariantViolationError(
        `impact at index ${i} must be a finite number, got ${String(impact)}`,
      );
    }
  }

  // Canonical sorting of impacts before summation guarantees strict bitwise commutativity
  // regardless of execution/traversal order.
  const sortedImpacts = [...impacts].sort((a, b) => a - b);

  const rawSum = sortedImpacts.reduce((acc, val) => acc + val, baseScore);

  if (!Number.isFinite(rawSum) || Number.isNaN(rawSum)) {
    throw new InvariantViolationError(`Calculated raw sum is not finite: ${String(rawSum)}`);
  }

  // Clamping to [0, 100] integer scale
  const clamped = Math.max(0, Math.min(100, Math.round(rawSum)));

  return clamped;
};
