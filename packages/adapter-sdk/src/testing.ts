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
  type AdapterConformanceScenario,
  type SourceAdapterContractSuiteOptions,
  createMockAdapterContext,
  runSourceAdapterContract,
  validateContractSuiteOptions,
} from './testing/contract-suite.js';
