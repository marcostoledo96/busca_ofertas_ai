import { ADAPTER_SDK_VERSION, type SourceCapabilities } from '@busca-ofertas-ai/adapter-sdk';

export const SYNTHETIC_ADAPTER_ID = 'synthetic' as const;
export const SYNTHETIC_ADAPTER_VERSION = '0.1.0' as const;
export const SYNTHETIC_ADAPTER_SDK_VERSION = ADAPTER_SDK_VERSION;
export const SYNTHETIC_ADAPTER_PACKAGE_NAME = '@busca-ofertas-ai/adapter-synthetic' as const;
export const DEFAULT_SYNTHETIC_PAGE_SIZE = 3;

export const SYNTHETIC_ADAPTER_CAPABILITIES: SourceCapabilities = {
  textSearch: true,
  exactUrlWatch: false,
  listingDetails: true,
  authentication: false,
  pagination: true,
  geographicSearch: false,
  priceAndCurrency: true,
  stock: true,
  advertisedDiscount: false,
};

export const SYNTHETIC_SCENARIOS = [
  'SUCCESS',
  'ZERO_RESULTS',
  'ZERO_RESULTS_CONFIRMED',
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'AUTHENTICATION_REQUIRED',
  'CONTRACT_CHANGED',
] as const;

export type SyntheticScenario = (typeof SYNTHETIC_SCENARIOS)[number];

export function isSyntheticScenario(value: unknown): value is SyntheticScenario {
  return typeof value === 'string' && SYNTHETIC_SCENARIOS.includes(value as SyntheticScenario);
}

export const SYNTHETIC_HEALTH_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'UNAVAILABLE',
  'AUTH_REQUIRED',
] as const;

export type SyntheticHealthStatus = (typeof SYNTHETIC_HEALTH_STATUSES)[number];

export function isSyntheticHealthStatus(value: unknown): value is SyntheticHealthStatus {
  return (
    typeof value === 'string' && SYNTHETIC_HEALTH_STATUSES.includes(value as SyntheticHealthStatus)
  );
}

export interface SyntheticListingFixture {
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
  readonly sourceMetadata: Record<string, unknown>;
  readonly matchingQueries: readonly string[];
  readonly sellerInfo?: Record<string, unknown> | undefined;
  readonly attributes?: Record<string, unknown> | undefined;
}

export interface SyntheticAdapterOptions {
  readonly defaultScenario?: SyntheticScenario | undefined;
  readonly healthStatus?: SyntheticHealthStatus | undefined;
  readonly pageSize?: number | undefined;
  readonly fixtures?: readonly SyntheticListingFixture[] | undefined;
}
