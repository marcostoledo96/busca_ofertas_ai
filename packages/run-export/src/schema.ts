export const RUN_EXPORT_SCHEMA_VERSION = 1 as const;

export type RunExportSchemaVersion = typeof RUN_EXPORT_SCHEMA_VERSION;

export type RunExportSearchCategory = 'PRODUCT' | 'REAL_ESTATE' | 'VEHICLE';

export type RunExportRunStatus =
  'CREATED' | 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export type RunExportSourceStatus =
  | 'PENDING'
  | 'RUNNING'
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

export type RunExportSourceStopReason =
  | 'ALL_PAGES_FETCHED'
  | 'MAX_PAGES_REACHED'
  | 'MAX_ITEMS_REACHED'
  | 'NO_MORE_RESULTS'
  | 'RATE_LIMIT_STOP'
  | 'USER_ABORTED'
  | 'DEADLINE_EXCEEDED';

export type RunExportListingCondition =
  'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS' | 'UNKNOWN';

export type RunExportAvailability = 'AVAILABLE' | 'PENDING' | 'SOLD' | 'REMOVED' | 'UNKNOWN';

export type RunExportPriceCurrency = 'ARS' | 'USD' | 'UNKNOWN';

export type RunExportPriceResolution =
  'EXPLICIT' | 'SOURCE_METADATA' | 'TEXT_INFERENCE' | 'AMBIGUOUS';

export type RunExportPriceKind = 'TOTAL' | 'DEPOSIT' | 'INSTALLMENT' | 'FROM_PRICE' | 'UNKNOWN';

export type RunExportItemNovelty = 'NEW' | 'UNCHANGED' | 'PRICE_CHANGED' | 'REAPPEARED';

export type RunExportEvaluationDecision = 'MATCH' | 'REVIEW' | 'REJECT';

export type RunExportEvaluationSeverity = 'INFO' | 'SOFT' | 'HARD';

export type RunExportEvaluatorType = 'RULES' | 'AI' | 'USER';

export interface RunExportRunError {
  readonly code: string | null;
  readonly message: string | null;
}

export interface RunExportRun {
  readonly id: string;
  readonly savedSearchId: string;
  readonly status: RunExportRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly error: RunExportRunError | null;
}

export interface RunExportSearch {
  readonly savedSearchId: string;
  readonly revisionNumber: number;
  readonly schemaVersion: number;
  readonly name: string;
  readonly category: RunExportSearchCategory;
}

export interface RunExportSourceMetrics {
  readonly pagesRequested: number | null;
  readonly pagesCompleted: number | null;
  readonly rawItemsCount: number | null;
  readonly parsedItemsCount: number | null;
  readonly rejectedItemsCount: number | null;
  readonly stopReason: RunExportSourceStopReason | null;
}

export interface RunExportSourceError {
  readonly code: string | null;
  readonly message: string | null;
}

export interface RunExportSource {
  readonly sourceRunId: string;
  readonly sourceId: string;
  readonly collectorId: string | null;
  readonly adapterVersion: string;
  readonly status: RunExportSourceStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly itemsCount: number | null;
  readonly metrics: RunExportSourceMetrics | null;
  readonly error: RunExportSourceError | null;
}

export interface RunExportConvertedPrice {
  readonly amount: number;
  readonly currency: 'ARS';
  readonly exchangeRate: number;
  readonly exchangeRateOrigin: 'MANUAL';
  readonly convertedAt: string;
}

export interface RunExportPrice {
  readonly rawText: string;
  readonly amount: number | null;
  readonly currency: RunExportPriceCurrency;
  readonly resolution: RunExportPriceResolution;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly kind: RunExportPriceKind;
  readonly converted: RunExportConvertedPrice | null;
}

export interface RunExportLocation {
  readonly rawText: string;
  readonly region: string | null;
  readonly city: string | null;
  readonly neighborhood: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface RunExportReason {
  readonly code: string;
  readonly message: string;
  readonly impact: number;
  readonly severity: RunExportEvaluationSeverity;
  readonly evidence?: string | null | undefined;
}

export interface RunExportEvaluation {
  readonly decision: RunExportEvaluationDecision;
  readonly score: number;
  readonly reasons: readonly RunExportReason[];
  readonly evaluatedBy: readonly RunExportEvaluatorType[];
  readonly policyVersion: string;
  readonly createdAt: string;
}

export interface RunExportResult {
  readonly listingId: string;
  readonly observationId: string;
  readonly sourceRunId: string;
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly observedAt: string;
  readonly publishedAt: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly condition: RunExportListingCondition | null;
  readonly availability: RunExportAvailability;
  readonly imageUrls: readonly string[];
  readonly rawFingerprint: string;
  readonly price: RunExportPrice | null;
  readonly location: RunExportLocation | null;
  readonly novelty: RunExportItemNovelty | null;
  readonly evaluation: RunExportEvaluation | null;
}

export interface RunExportSnapshot {
  readonly schemaVersion: typeof RUN_EXPORT_SCHEMA_VERSION;
  readonly run: RunExportRun;
  readonly search: RunExportSearch;
  readonly manualExchangeRate: number | null;
  readonly sources: readonly RunExportSource[];
  readonly results: readonly RunExportResult[];
}
