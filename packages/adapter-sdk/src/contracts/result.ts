import type { SourceDiagnostics } from './diagnostics.js';

/**
 * Boundary candidate representing a raw listing retrieved from an external source.
 * Preserves source evidence before domain normalization, money resolution, and matching.
 */
export interface RawListingCandidate {
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly description: string;
  readonly rawPriceText: string;
  readonly sourceCurrencyCode?: string | null | undefined;
  readonly rawLocationText?: string | null | undefined;
  readonly rawConditionText?: string | null | undefined;
  readonly rawAvailabilityText?: string | null | undefined;
  readonly imageUrls: readonly string[];
  readonly observedAt: Date;
  readonly sourceMetadata: Record<string, unknown>;
  readonly rawPayload?: unknown;
}

/**
 * Extended details for an individual listing candidate.
 */
export interface RawListingDetails {
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly description: string;
  readonly rawPriceText: string;
  readonly sourceCurrencyCode?: string | null | undefined;
  readonly rawLocationText?: string | null | undefined;
  readonly rawConditionText?: string | null | undefined;
  readonly rawAvailabilityText?: string | null | undefined;
  readonly imageUrls: readonly string[];
  readonly sellerInfo?: Record<string, unknown> | undefined;
  readonly attributes: Record<string, unknown>;
  readonly fetchedAt: Date;
  readonly sourceMetadata: Record<string, unknown>;
  readonly rawPayload?: unknown;
}

/**
 * Outcome of an optional adapter authentication operation.
 */
export type AuthenticationResult =
  | {
      readonly status: 'AUTHENTICATED';
      readonly sessionExpiresAt?: Date | undefined;
      readonly metadata?: Record<string, unknown> | undefined;
    }
  | {
      readonly status: 'AUTHENTICATION_REQUIRED';
      readonly reason: string;
      readonly loginUrl?: string | undefined;
    }
  | {
      readonly status: 'INTERVENTION_REQUIRED';
      readonly reason: string;
      readonly checkpointUrl?: string | undefined;
      readonly instructions?: string | undefined;
    };

/**
 * Successful search with at least one confirmed candidate item.
 */
export interface SuccessSearchResult {
  readonly status: 'SUCCESS';
  readonly sourceId: string;
  readonly items: readonly [RawListingCandidate, ...RawListingCandidate[]];
  readonly pagesRead: number;
  readonly hasMore: boolean;
  readonly diagnostics: SourceDiagnostics;
}

/**
 * Confirmed zero results search.
 * Distinct from a failure, error, or empty success without validation.
 */
export interface ZeroResultsConfirmedSearchResult {
  readonly status: 'ZERO_RESULTS_CONFIRMED';
  readonly sourceId: string;
  readonly items: readonly [];
  readonly pagesRead: number;
  readonly hasMore: boolean;
  readonly diagnostics: SourceDiagnostics;
}

/**
 * Discriminated union of search outcomes.
 * Enforces structurally that ZERO_RESULTS_CONFIRMED contains 0 items and SUCCESS contains >= 1 items.
 */
export type SourceSearchResult = SuccessSearchResult | ZeroResultsConfirmedSearchResult;

export interface CreateSuccessSearchResultParams {
  readonly sourceId: string;
  readonly items: readonly RawListingCandidate[];
  readonly pagesRead: number;
  readonly hasMore: boolean;
  readonly diagnostics: SourceDiagnostics;
}

export function createSuccessSearchResult(
  params: CreateSuccessSearchResultParams,
): SuccessSearchResult {
  if (!params.sourceId || params.sourceId.trim().length === 0) {
    throw new Error('sourceId cannot be empty in search result');
  }
  if (!params.items || params.items.length === 0) {
    throw new Error(
      'Cannot create SUCCESS search result with 0 items; use createZeroResultsConfirmedSearchResult instead',
    );
  }
  if (params.pagesRead < 0) {
    throw new Error('pagesRead cannot be negative');
  }

  return {
    status: 'SUCCESS',
    sourceId: params.sourceId,
    items: params.items as readonly [RawListingCandidate, ...RawListingCandidate[]],
    pagesRead: params.pagesRead,
    hasMore: params.hasMore,
    diagnostics: params.diagnostics,
  };
}

export interface CreateZeroResultsConfirmedSearchResultParams {
  readonly sourceId: string;
  readonly items?: readonly [] | undefined;
  readonly pagesRead: number;
  readonly hasMore: boolean;
  readonly diagnostics: SourceDiagnostics;
}

export function createZeroResultsConfirmedSearchResult(
  params: CreateZeroResultsConfirmedSearchResultParams,
): ZeroResultsConfirmedSearchResult {
  if (!params.sourceId || params.sourceId.trim().length === 0) {
    throw new Error('sourceId cannot be empty in search result');
  }
  if (params.items && params.items.length > 0) {
    throw new Error(
      'Cannot create ZERO_RESULTS_CONFIRMED search result with items > 0; use createSuccessSearchResult instead',
    );
  }
  if (params.pagesRead < 0) {
    throw new Error('pagesRead cannot be negative');
  }

  return {
    status: 'ZERO_RESULTS_CONFIRMED',
    sourceId: params.sourceId,
    items: [] as const,
    pagesRead: params.pagesRead,
    hasMore: params.hasMore,
    diagnostics: params.diagnostics,
  };
}
