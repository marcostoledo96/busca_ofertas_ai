import { describe } from 'vitest';
import { runSourceAdapterContract } from '@busca-ofertas-ai/adapter-sdk/testing';
import { SyntheticAdapter } from '@busca-ofertas-ai/adapter-synthetic';

describe('SyntheticAdapter Contract Conformance Suite', () => {
  runSourceAdapterContract({
    adapterName: 'SyntheticAdapter',
    createAdapter: () => new SyntheticAdapter(),
    configureScenario: (adapter, scenario) => {
      (adapter as SyntheticAdapter).setScenario(scenario);
    },
    expectedCapabilities: {
      textSearch: true,
      exactUrlWatch: false,
      listingDetails: true,
      authentication: false,
      pagination: true,
      geographicSearch: false,
      priceAndCurrency: true,
      stock: true,
      advertisedDiscount: false,
    },
  });
});
