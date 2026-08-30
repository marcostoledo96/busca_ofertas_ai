import type { OperationControl } from './context.js';

/**
 * Geographic search filters supported by capable adapters.
 */
export interface LocationFilter {
  readonly mode: 'POINT_RADIUS' | 'MULTI_POINT' | 'REGION' | 'COUNTRY';
  readonly radiusKm?: number;
  readonly sourceLocationIds?: readonly string[];
  readonly latitude?: number;
  readonly longitude?: number;
}

/**
 * Price hints passed to source search queries as an optimization filter.
 * Does NOT decide final match acceptance in core.
 */
export interface PriceHint {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly currency?: string;
}

export type SearchSortOrder = 'RELEVANCE' | 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC';

export interface SearchPaginationLimit {
  readonly maxPages: number;
  readonly maxItems: number;
}

/**
 * Neutral request payload for source search queries.
 */
export interface SourceSearchRequest {
  readonly savedSearchId: string;
  readonly queries: readonly string[];
  readonly pagination: SearchPaginationLimit;
  readonly location?: LocationFilter;
  readonly priceHint?: PriceHint;
  readonly sort?: SearchSortOrder;
  readonly sourceOptions?: Record<string, unknown>;
  readonly control: OperationControl;
}

/**
 * Request payload for adapter health checks.
 */
export interface HealthCheckRequest {
  readonly control: OperationControl;
  readonly sourceOptions?: Record<string, unknown>;
}

/**
 * Request payload for optional adapter authentication.
 */
export interface AuthenticationRequest {
  readonly control: OperationControl;
  readonly credentials?: Record<string, unknown>;
  readonly sourceOptions?: Record<string, unknown>;
}

/**
 * Minimal reference for fetching details of a specific external listing.
 */
export interface ListingReference {
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly sourceMetadata?: Record<string, unknown>;
}
