/**
 * @busca-ofertas-ai/core
 *
 * Core domain entities, value objects, invariants, and ports for Busca Ofertas AI.
 * Free of frameworks, browser, filesystem, database, or external I/O dependencies.
 */

// Common & Environment Abstractions
export {
  DomainError,
  InvariantViolationError,
  type Clock,
  type IdGenerator,
  SystemClock,
  UuidIdGenerator,
} from './domain/common/index.js';

export { type Hasher } from './domain/common/hasher.js';

// Price & Currency Value Objects
export {
  type PriceCurrency,
  type PriceResolution,
  type PriceKind,
  type ExchangeRateOrigin,
  type ConvertedPrice,
  type ResolvedPrice,
  type CreateResolvedPriceParams,
  createResolvedPrice,
} from './domain/price/resolved-price.js';

// Evaluation & Reasons
export {
  type EvaluationSeverity,
  type EvaluationReason,
  type CreateEvaluationReasonParams,
  createEvaluationReason,
} from './domain/evaluation/evaluation-reason.js';

export {
  type EvaluationDecision,
  type EvaluatorType,
  type Evaluation,
  type CreateEvaluationParams,
  hasHardRejection,
  canPromoteToMatch,
  canPromoteToReview,
  createEvaluation,
  applySubsequentEvaluation,
} from './domain/evaluation/evaluation.js';

// Listing & Observation
export {
  type ListingCondition,
  type Availability,
  type ResolvedLocation,
} from './domain/listing/types.js';

export { type Listing, type CreateListingParams, createListing } from './domain/listing/listing.js';

export {
  type Observation,
  type CreateObservationParams,
  createObservation,
} from './domain/listing/observation.js';

export {
  FALLBACK_EXTERNAL_ID_NAMESPACE,
  isFallbackExternalId,
  createFallbackExternalId,
  type NormalizeGenericUrlOptions,
  normalizeGenericUrl,
  type SourceUrlCanonicalizer,
  UrlCanonicalizerRegistry,
} from './domain/listing/url-canonicalizer.js';

export {
  type ObservationFingerprintParams,
  buildCanonicalObservationPayload,
  computeObservationFingerprint,
} from './domain/listing/fingerprint.js';

// Opportunity & Feedback
export {
  type OpportunityNovelty,
  type Opportunity,
  type CreateOpportunityParams,
  createOpportunity,
} from './domain/opportunity/opportunity.js';

export {
  type FeedbackDecision,
  type FeedbackActor,
  type Feedback,
  type CreateFeedbackParams,
  createFeedback,
} from './domain/opportunity/feedback.js';

// Search & Policies
export {
  type SearchCategory,
  type SourceSearchConfig,
  type QueryPolicy,
  type PricePolicy,
  type LocationPolicy,
  type ConditionPolicy,
  type RuleExpression,
  type EvaluationPolicy,
  type AiPolicy,
  type RetentionPolicy,
  type RawArtifactRetentionPolicy,
  type SavedSearch,
  type CreateSavedSearchParams,
  createSavedSearch,
} from './domain/search/saved-search.js';

// Run & SourceRun (Discriminated Unions)
export {
  type RunStatus,
  type CreatedRun,
  type RunningRun,
  type SuccessRun,
  type PartialSuccessRun,
  type FailedRun,
  type CancelledRun,
  type Run,
  type CreateRunParams,
  createRun,
} from './domain/run/run.js';

export {
  type SourceRunStatus,
  type PendingSourceRun,
  type RunningSourceRun,
  type SuccessSourceRun,
  type ZeroResultsConfirmedSourceRun,
  type AuthenticationRequiredSourceRun,
  type ManualInterventionRequiredSourceRun,
  type RateLimitedSourceRun,
  type NetworkErrorSourceRun,
  type SourceUnavailableSourceRun,
  type ContractChangedSourceRun,
  type ParserFailedSourceRun,
  type TimeoutSourceRun,
  type ConfigurationUnsupportedSourceRun,
  type CancelledSourceRun,
  type SourceRun,
  type CreateSourceRunParams,
  createSourceRun,
} from './domain/run/source-run.js';

// Health
export {
  type SourceHealthStatus,
  type SourceHealth,
  type CreateSourceHealthParams,
  createSourceHealth,
} from './domain/health/source-health.js';

// Ports
export {
  type SavedSearchRevisionRecord,
  type SavedSearchRepository,
  type ListingRepository,
  type ObservationChangeKind,
  type RecordObservationParams,
  type RecordObservationResult,
  type ObservationRepository,
  type EvaluationRepository,
  type OpportunityRepository,
  type FeedbackRepository,
  type RunSummary,
  type SourceRunStopReason,
  type SourceRunMetrics,
  type CompleteSourceRunMetrics,
  type SourceRunExecutionMetadata,
  type RunRepository,
} from './ports/repositories.js';

export { type RawArtifactRepository } from './ports/repositories.js';

export {
  type ExecutionLockInfo,
  type ExecutionLockHandle,
  type ExecutionLockPort,
} from './ports/execution-lock.js';

export { type ExternalUrlOpenerPort } from './ports/external-url-opener.js';

// Raw Artifacts (Domain, Ports, Errors, Service)
export {
  type RawArtifactReason,
  type RawArtifact,
  type CreateRawArtifactParams,
  VALID_RAW_ARTIFACT_REASONS,
  DEFAULT_RAW_ARTIFACT_RETENTION_DAYS,
  validateRelativeArtifactPath,
  createRawArtifact,
  isArtifactRetainable,
  calculateArtifactExpirationDate,
} from './domain/artifact/raw-artifact.js';

export { type ArtifactSanitizerPort } from './domain/artifact/sanitizer-port.js';

export {
  ArtifactStorageError,
  ArtifactSizeLimitExceededError,
  RunArtifactBudgetExceededError,
  ArtifactPathTraversalError,
  ArtifactSymlinkEscapeError,
  ArtifactIdentityCollisionError,
  ArtifactNotFoundError,
  DiskFullError,
  UnsupportedArtifactContentError,
  type ArtifactFileSystemPort,
} from './ports/artifact-storage-port.js';

export {
  type RawArtifactLimits,
  DEFAULT_RAW_ARTIFACT_LIMITS,
  type RawArtifactServiceOptions,
  type StoreArtifactParams,
  type CleanupSummary,
  RawArtifactService,
} from './domain/artifact/raw-artifact-service.js';

// Review Use Cases, Queue Services & Rule Suggestions
export * from './review/index.js';

// Package Metadata
export const CORE_PACKAGE_NAME = '@busca-ofertas-ai/core' as const;

export interface CorePackageMetadata {
  readonly name: typeof CORE_PACKAGE_NAME;
  readonly initialized: boolean;
}

export const getCorePackageMetadata = (): CorePackageMetadata => ({
  name: CORE_PACKAGE_NAME,
  initialized: true,
});
