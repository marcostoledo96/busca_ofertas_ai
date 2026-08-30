/**
 * @busca-ofertas-ai/adapter-sdk/testing
 *
 * Testing utilities, test doubles, and reusable contract test suite for SourceAdapter implementations.
 */

export {
  type InMemoryConformanceAdapterOptions,
  InMemoryConformanceAdapter,
} from './testing/fake-adapter.js';

export {
  type SourceAdapterContractSuiteOptions,
  createMockAdapterContext,
  runSourceAdapterContract,
} from './testing/contract-suite.js';
