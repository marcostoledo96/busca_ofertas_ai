/**
 * @busca-ofertas-ai/adapter-sdk
 *
 * Stable, versionable, and zero-external-dependency seam between Busca Ofertas AI
 * core domain and external listing sources (Facebook Marketplace, Mercado Libre, custom stores, URL watchers).
 */

// Version & Compatibility
export {
  ADAPTER_SDK_VERSION,
  type SdkCompatibilityResult,
  checkAdapterCompatibility,
} from './contracts/version.js';

// Context & Operation Control
export {
  type OperationControl,
  isAbortedOrExpired,
  type LogEventContext,
  type StructuredLogger,
  createSanitizedLogger,
  type SecretProvider,
  type WriteArtifactParams,
  type RawArtifactWriter,
  createSanitizedArtifactWriter,
  type AdapterContext,
  createSanitizedAdapterContext,
} from './contracts/context.js';

// Adapter & Capabilities
export {
  type SourceCapabilities,
  type CapabilityCheckResult,
  validateCapabilities,
  type MethodCoherenceResult,
  validateAdapterMethodCoherence,
  type SourceAdapter,
} from './contracts/adapter.js';

// Requests
export {
  type LocationFilter,
  type PriceHint,
  type SearchSortOrder,
  type SearchPaginationLimit,
  type SourceSearchRequest,
  type HealthCheckRequest,
  type AuthenticationRequest,
  type ListingReference,
} from './contracts/request.js';

// Results & Candidates
export {
  type RawListingCandidate,
  type RawListingDetails,
  type AuthenticationResult,
  type SuccessSearchResult,
  type ZeroResultsConfirmedSearchResult,
  type SourceSearchResult,
  type CreateSuccessSearchResultParams,
  createSuccessSearchResult,
  type CreateZeroResultsConfirmedSearchResultParams,
  createZeroResultsConfirmedSearchResult,
} from './contracts/result.js';

// Diagnostics
export {
  type DiagnosticsStopReason,
  type SourceDiagnostics,
  type CreateSourceDiagnosticsParams,
  createSourceDiagnostics,
} from './contracts/diagnostics.js';

// Errors & Sanitization
export {
  SOURCE_ERROR_CODES,
  type SourceErrorCode,
  isSourceErrorCode,
  DEFAULT_RETRYABLE_BY_CODE,
} from './errors/error-codes.js';

export {
  REDACTED_PLACEHOLDER,
  MAX_SANITIZATION_DEPTH,
  sanitizeString,
  sanitizeEvidence,
  sanitizeData,
} from './errors/sanitization.js';

export {
  type SourceAdapterErrorParams,
  type SerializedSourceAdapterError,
  SourceAdapterError,
  isSourceAdapterError,
} from './errors/source-adapter-error.js';

// Package Metadata
export const ADAPTER_SDK_PACKAGE_NAME = '@busca-ofertas-ai/adapter-sdk' as const;

export interface AdapterSdkPackageMetadata {
  readonly name: typeof ADAPTER_SDK_PACKAGE_NAME;
  readonly version: string;
  readonly initialized: boolean;
}

export const getAdapterSdkPackageMetadata = (): AdapterSdkPackageMetadata => ({
  name: ADAPTER_SDK_PACKAGE_NAME,
  version: '0.1.0',
  initialized: true,
});
