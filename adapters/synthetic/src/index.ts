/**
 * @busca-ofertas-ai/adapter-synthetic
 *
 * 100% deterministic, offline source adapter implementing the neutral Adapter SDK contract.
 * Used for testing, contract conformance validation, and offline product demonstrations.
 */

export {
  SYNTHETIC_ADAPTER_ID,
  SYNTHETIC_ADAPTER_VERSION,
  SYNTHETIC_ADAPTER_SDK_VERSION,
  SYNTHETIC_ADAPTER_PACKAGE_NAME,
  DEFAULT_SYNTHETIC_PAGE_SIZE,
  SYNTHETIC_ADAPTER_CAPABILITIES,
  SYNTHETIC_SCENARIOS,
  type SyntheticScenario,
  isSyntheticScenario,
  SYNTHETIC_HEALTH_STATUSES,
  type SyntheticHealthStatus,
  isSyntheticHealthStatus,
  type SyntheticListingFixture,
  type SyntheticAdapterOptions,
} from './types.js';

export { SYNTHETIC_FIXTURES } from './fixtures/synthetic-fixtures.js';

export { SyntheticAdapter } from './synthetic-adapter.js';

import { SYNTHETIC_ADAPTER_PACKAGE_NAME, SYNTHETIC_ADAPTER_VERSION } from './types.js';
import { SyntheticAdapter } from './synthetic-adapter.js';
import type { SyntheticAdapterOptions } from './types.js';

export interface AdapterSyntheticPackageMetadata {
  readonly name: typeof SYNTHETIC_ADAPTER_PACKAGE_NAME;
  readonly version: string;
  readonly initialized: boolean;
}

export const getAdapterSyntheticPackageMetadata = (): AdapterSyntheticPackageMetadata => ({
  name: SYNTHETIC_ADAPTER_PACKAGE_NAME,
  version: SYNTHETIC_ADAPTER_VERSION,
  initialized: true,
});

export const createSyntheticAdapter = (options?: SyntheticAdapterOptions): SyntheticAdapter => {
  return new SyntheticAdapter(options);
};
