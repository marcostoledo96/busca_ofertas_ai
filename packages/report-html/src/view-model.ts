/**
 * View model contract for Busca Ofertas AI local HTML report.
 *
 * Contract guarantees:
 * - Readonly, explicit whitelisting.
 * - Free of internal SQLite entities, secrets, raw HTTP payloads, cookies, session paths or stack traces.
 * - Single authority for source errors (ReportViewModel.sourceErrors).
 * - Honest absence representation: missing values (prices, scores, conversion) remain undefined,
 *   never synthesized as zero or arbitrary placeholders.
 */

export type GlobalRunStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export type SourceStatus =
  | 'SUCCESS'
  | 'ZERO_RESULTS_CONFIRMED'
  | 'AUTHENTICATION_REQUIRED'
  | 'MANUAL_INTERVENTION_REQUIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SOURCE_UNAVAILABLE'
  | 'CONTRACT_CHANGED'
  | 'PARSER_FAILED'
  | 'TIMEOUT'
  | 'CONFIGURATION_UNSUPPORTED'
  | 'CANCELLED';

export type ItemNovelty = 'NEW' | 'UNCHANGED' | 'PRICE_CHANGED' | 'REAPPEARED';

export type ItemDecision = 'MATCH' | 'REVIEW' | 'REJECT';

export type ReasonSeverity = 'INFO' | 'SOFT' | 'HARD';

export interface ReportReason {
  readonly code: string;
  readonly message: string;
  readonly severity: ReasonSeverity;
  readonly impact?: number | undefined;
  readonly evidence?: string | undefined;
}

export interface ReportSourceError {
  readonly sourceId: string;
  readonly sourceStatus: SourceStatus;
  readonly errorCode: string;
  readonly message: string;
  readonly suggestedAction: string;
  readonly collector?: string | undefined;
  readonly partialCount?: number | undefined;
}

export interface ReportSourceSummary {
  readonly sourceId: string;
  readonly sourceStatus: SourceStatus;
  readonly collector?: string | undefined;
  readonly itemsCount?: number | undefined;
}

export interface ReportRunMetrics {
  readonly totalCollected: number;
  readonly totalNormalized: number;
  readonly durationMs?: number | undefined;
}

export interface ReportResolvedPrice {
  readonly amount: number;
  readonly currency: string;
  readonly display: string;
}

export interface ReportCurrencyConversion {
  readonly amount: number;
  readonly display: string;
}

export interface ReportItem {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly url?: string | undefined;
  readonly rawPrice?: string | undefined;
  readonly resolvedPrice?: ReportResolvedPrice | undefined;
  readonly conversionArs?: ReportCurrencyConversion | undefined;
  readonly location?: string | undefined;
  readonly condition?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly observedAt?: string | undefined;
  readonly novelty: ItemNovelty;
  readonly decision: ItemDecision;
  readonly score?: number | undefined;
  readonly reasons: readonly ReportReason[];
  readonly imageUrl?: string | undefined;
  readonly effectivePriceSortKey?: number | undefined;
}

export interface ReportRunSummary {
  readonly runId: string;
  readonly searchName: string;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly globalStatus: GlobalRunStatus;
  readonly sources: readonly ReportSourceSummary[];
  readonly manualExchangeRate?: string | undefined;
  readonly warnings: readonly string[];
  readonly metrics: ReportRunMetrics;
}

export interface ReportViewModel {
  readonly run: ReportRunSummary;
  readonly items: readonly ReportItem[];
  readonly sourceErrors: readonly ReportSourceError[];
}
