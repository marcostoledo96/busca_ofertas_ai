import type {
  ReportItem,
  ReportSourceError,
  ReportSourceSummary,
  ItemNovelty,
} from './view-model.js';

const NOVELTY_ORDER: Record<ItemNovelty, number> = {
  NEW: 1,
  PRICE_CHANGED: 2,
  REAPPEARED: 3,
  UNCHANGED: 4,
};

export function sortMatchItems(items: readonly ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => {
    // 1. Score descending (undefined last)
    const aScore = a.score;
    const bScore = b.score;
    if (aScore !== undefined && bScore !== undefined) {
      if (bScore !== aScore) {
        return bScore - aScore;
      }
    } else if (aScore !== undefined && bScore === undefined) {
      return -1;
    } else if (aScore === undefined && bScore !== undefined) {
      return 1;
    }

    // 2. Novelty ranking (NEW > PRICE_CHANGED > REAPPEARED > UNCHANGED)
    const aNoveltyRank = NOVELTY_ORDER[a.novelty] ?? 99;
    const bNoveltyRank = NOVELTY_ORDER[b.novelty] ?? 99;
    if (aNoveltyRank !== bNoveltyRank) {
      return aNoveltyRank - bNoveltyRank;
    }

    // 3. Effective price ascending (provided by upstream, undefined last)
    const aEffective = a.effectivePriceSortKey;
    const bEffective = b.effectivePriceSortKey;
    if (aEffective !== undefined && bEffective !== undefined) {
      if (aEffective !== bEffective) {
        return aEffective - bEffective;
      }
    } else if (aEffective !== undefined && bEffective === undefined) {
      return -1;
    } else if (aEffective === undefined && bEffective !== undefined) {
      return 1;
    }

    // 4. Stable tie-breaker: id
    return a.id.localeCompare(b.id);
  });
}

export function sortReviewItems(items: readonly ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => {
    // 1. Novelty ranking
    const aNoveltyRank = NOVELTY_ORDER[a.novelty] ?? 99;
    const bNoveltyRank = NOVELTY_ORDER[b.novelty] ?? 99;
    if (aNoveltyRank !== bNoveltyRank) {
      return aNoveltyRank - bNoveltyRank;
    }

    // 2. Score descending if available
    const aScore = a.score;
    const bScore = b.score;
    if (aScore !== undefined && bScore !== undefined) {
      if (bScore !== aScore) {
        return bScore - aScore;
      }
    } else if (aScore !== undefined && bScore === undefined) {
      return -1;
    } else if (aScore === undefined && bScore !== undefined) {
      return 1;
    }

    // 3. Stable tie-breaker: id
    return a.id.localeCompare(b.id);
  });
}

export function sortRejectItems(items: readonly ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => {
    // 1. Primary reason code ascending
    const aReason = a.reasons[0]?.code ?? '';
    const bReason = b.reasons[0]?.code ?? '';
    const reasonDiff = aReason.localeCompare(bReason);
    if (reasonDiff !== 0) {
      return reasonDiff;
    }

    // 2. Stable tie-breaker: id
    return a.id.localeCompare(b.id);
  });
}

export function sortSourceErrors(errors: readonly ReportSourceError[]): ReportSourceError[] {
  return [...errors].sort((a, b) => {
    const srcDiff = a.sourceId.localeCompare(b.sourceId);
    if (srcDiff !== 0) return srcDiff;
    return a.errorCode.localeCompare(b.errorCode);
  });
}

export function sortSources(sources: readonly ReportSourceSummary[]): ReportSourceSummary[] {
  return [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
