export function compareBinary(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortSources<T extends { readonly sourceId: string; readonly sourceRunId: string }>(
  sources: readonly T[],
): T[] {
  return [...sources].sort((a, b) => {
    const sCmp = compareBinary(a.sourceId, b.sourceId);
    if (sCmp !== 0) return sCmp;
    return compareBinary(a.sourceRunId, b.sourceRunId);
  });
}

export function sortResults<
  T extends {
    readonly sourceId: string;
    readonly listingId: string;
    readonly observedAt: string;
    readonly observationId: string;
  },
>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => {
    const sCmp = compareBinary(a.sourceId, b.sourceId);
    if (sCmp !== 0) return sCmp;
    const lCmp = compareBinary(a.listingId, b.listingId);
    if (lCmp !== 0) return lCmp;
    const oCmp = compareBinary(a.observedAt, b.observedAt);
    if (oCmp !== 0) return oCmp;
    return compareBinary(a.observationId, b.observationId);
  });
}
