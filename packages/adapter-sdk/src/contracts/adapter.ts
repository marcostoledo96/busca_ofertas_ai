import type { SourceHealth } from '@busca-ofertas-ai/core';
import type { AdapterContext, OperationControl } from './context.js';
import type {
  AuthenticationRequest,
  HealthCheckRequest,
  ListingReference,
  SourceSearchRequest,
} from './request.js';
import type { AuthenticationResult, RawListingDetails, SourceSearchResult } from './result.js';

/**
 * Explicit capabilities declared by a SourceAdapter.
 * Checked by the orchestrator prior to dispatching queries.
 */
export interface SourceCapabilities {
  readonly textSearch: boolean;
  readonly exactUrlWatch: boolean;
  readonly listingDetails: boolean;
  readonly authentication: boolean;
  readonly pagination: boolean;
  readonly geographicSearch: boolean;
  readonly priceAndCurrency: boolean;
  readonly stock: boolean;
  readonly advertisedDiscount: boolean;
}

export type CapabilityCheckResult =
  | {
      readonly compatible: true;
      readonly missing: readonly [];
    }
  | {
      readonly compatible: false;
      readonly missing: readonly (keyof SourceCapabilities)[];
    };

/**
 * Pure function verifying whether adapter capabilities satisfy required query capabilities.
 */
export function validateCapabilities(
  required: Partial<SourceCapabilities>,
  actual: SourceCapabilities,
): CapabilityCheckResult {
  const missing: (keyof SourceCapabilities)[] = [];

  for (const key of Object.keys(required) as (keyof SourceCapabilities)[]) {
    if (required[key] === true && actual[key] !== true) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      compatible: false,
      missing,
    };
  }

  return {
    compatible: true,
    missing: [],
  };
}

export interface MethodCoherenceResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates that optional methods exist on the adapter when their corresponding capabilities are enabled.
 */
export function validateAdapterMethodCoherence(adapter: SourceAdapter): MethodCoherenceResult {
  const errors: string[] = [];

  if (adapter.capabilities.listingDetails && typeof adapter.getDetails !== 'function') {
    errors.push(
      `Adapter '${adapter.id}' declares capability 'listingDetails=true' but does not implement 'getDetails' method`,
    );
  }

  if (adapter.capabilities.authentication && typeof adapter.authenticate !== 'function') {
    errors.push(
      `Adapter '${adapter.id}' declares capability 'authentication=true' but does not implement 'authenticate' method`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Neutral, decoupled contract that all source adapters must implement.
 * Isolates data sources (Facebook Marketplace, Mercado Libre, custom stores, URL watchers)
 * from the Busca Ofertas AI core domain.
 */
export interface SourceAdapter {
  readonly id: string;
  readonly version: string;
  readonly sdkVersion?: string;
  readonly capabilities: SourceCapabilities;

  /**
   * Initializes the adapter and its in-memory dependencies.
   */
  initialize(context: AdapterContext): Promise<void>;

  /**
   * Performs an active, real health check against the external endpoint without executing a heavy search.
   */
  healthCheck(request: HealthCheckRequest): Promise<SourceHealth>;

  /**
   * Executes a search query, returning normalized boundary candidates and structured diagnostics.
   * Throws SourceAdapterError on external failure.
   */
  search(request: SourceSearchRequest): Promise<SourceSearchResult>;

  /**
   * Optional method: fetches extended details for a specific listing if listingDetails capability is enabled.
   */
  getDetails?(reference: ListingReference, control: OperationControl): Promise<RawListingDetails>;

  /**
   * Optional method: handles explicit authentication/session establishment if authentication capability is enabled.
   */
  authenticate?(request: AuthenticationRequest): Promise<AuthenticationResult>;

  /**
   * Disposes the adapter, releasing any open in-memory timers, workers, or handles idempotently.
   */
  dispose(): Promise<void>;
}
