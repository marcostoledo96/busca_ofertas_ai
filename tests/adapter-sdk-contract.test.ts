import { describe, it, expect } from 'vitest';
import type { SourceAdapter } from '@busca-ofertas-ai/adapter-sdk';
import {
  type AdapterConformanceScenario,
  type SourceAdapterContractSuiteOptions,
  InMemoryConformanceAdapter,
  runSourceAdapterContract,
  validateContractSuiteOptions,
} from '@busca-ofertas-ai/adapter-sdk/testing';

describe('Adapter SDK Contract Conformance Suite Verification', () => {
  runSourceAdapterContract({
    adapterName: 'InMemoryConformanceAdapter',
    createAdapter: () => new InMemoryConformanceAdapter(),
    configureScenario: (adapter: SourceAdapter, scenario: AdapterConformanceScenario) => {
      if (adapter instanceof InMemoryConformanceAdapter) {
        switch (scenario) {
          case 'SUCCESS':
            adapter.setSimulateMode('SUCCESS');
            break;
          case 'ZERO_RESULTS':
            adapter.setSimulateMode('ZERO_RESULTS');
            break;
          case 'NETWORK_ERROR':
            adapter.setSimulateMode('FAIL_NETWORK');
            break;
          case 'TIMEOUT':
            adapter.setSimulateMode('FAIL_TIMEOUT');
            break;
          case 'AUTHENTICATION_REQUIRED':
            adapter.setSimulateMode('FAIL_AUTH');
            break;
          case 'RATE_LIMITED':
            adapter.setSimulateMode('FAIL_RATE_LIMIT');
            break;
        }
      }
    },
  });

  describe('Test-of-the-Test: Rejection of Incomplete Contract Suite Configuration', () => {
    it('fails immediately when configureScenario hook is omitted', () => {
      expect(() =>
        validateContractSuiteOptions({
          adapterName: 'BrokenSuiteAdapter',
          createAdapter: () => new InMemoryConformanceAdapter(),
        } as unknown as SourceAdapterContractSuiteOptions),
      ).toThrow(
        'Contract suite requires a configureScenario hook to ensure critical scenarios (SUCCESS, ZERO_RESULTS, NETWORK_ERROR, TIMEOUT) are not silently skipped',
      );
    });

    it('fails immediately when adapterName or createAdapter factory is missing', () => {
      expect(() =>
        validateContractSuiteOptions({
          adapterName: '',
          createAdapter: () => new InMemoryConformanceAdapter(),
          configureScenario: () => {},
        }),
      ).toThrow('Contract suite requires a non-empty string adapterName');

      expect(() =>
        validateContractSuiteOptions({
          adapterName: 'ValidName',
          createAdapter: null as unknown as () => SourceAdapter,
          configureScenario: () => {},
        }),
      ).toThrow('Contract suite requires a createAdapter factory function');
    });
  });
});
