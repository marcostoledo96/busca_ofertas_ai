import { describe } from 'vitest';
import type { SourceAdapter } from '@busca-ofertas-ai/adapter-sdk';
import {
  InMemoryConformanceAdapter,
  runSourceAdapterContract,
} from '@busca-ofertas-ai/adapter-sdk/testing';

describe('Adapter SDK Contract Conformance Suite Verification', () => {
  runSourceAdapterContract({
    adapterName: 'InMemoryConformanceAdapter',
    createAdapter: () => new InMemoryConformanceAdapter(),
    simulateFailure: (
      adapter: SourceAdapter,
      errorType: 'network' | 'timeout' | 'auth' | 'rateLimit',
    ) => {
      if (adapter instanceof InMemoryConformanceAdapter) {
        if (errorType === 'network') adapter.setSimulateMode('FAIL_NETWORK');
        if (errorType === 'timeout') adapter.setSimulateMode('FAIL_TIMEOUT');
        if (errorType === 'auth') adapter.setSimulateMode('FAIL_AUTH');
        if (errorType === 'rateLimit') adapter.setSimulateMode('FAIL_RATE_LIMIT');
      }
    },
    simulateZeroResults: (adapter: SourceAdapter) => {
      if (adapter instanceof InMemoryConformanceAdapter) {
        adapter.setSimulateMode('ZERO_RESULTS');
      }
    },
  });
});
