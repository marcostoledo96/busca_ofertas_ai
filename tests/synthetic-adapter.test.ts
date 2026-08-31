import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Clock } from '@busca-ofertas-ai/core';
import type {
  AdapterContext,
  HealthCheckRequest,
  ListingReference,
  OperationControl,
  SourceSearchRequest,
} from '@busca-ofertas-ai/adapter-sdk';
import {
  ADAPTER_SDK_VERSION,
  checkAdapterCompatibility,
  createSanitizedAdapterContext,
  createSanitizedArtifactWriter,
  createSanitizedLogger,
  SourceAdapterError,
  isSourceAdapterError,
  validateAdapterMethodCoherence,
} from '@busca-ofertas-ai/adapter-sdk';
import {
  SyntheticAdapter,
  SYNTHETIC_ADAPTER_ID,
  SYNTHETIC_ADAPTER_VERSION,
  SYNTHETIC_ADAPTER_SDK_VERSION,
  SYNTHETIC_ADAPTER_CAPABILITIES,
  SYNTHETIC_FIXTURES,
  type SyntheticScenario,
} from '@busca-ofertas-ai/adapter-synthetic';

function createTestContext(fixedDate = '2026-08-31T12:00:00Z'): AdapterContext {
  const clock: Clock = { now: () => new Date(fixedDate) };
  const controller = new AbortController();
  return createSanitizedAdapterContext({
    runId: 'synthetic-test-run-001',
    logger: createSanitizedLogger({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
    clock,
    abortSignal: controller.signal,
    artifactWriter: createSanitizedArtifactWriter({
      writeArtifact: () => Promise.resolve('art-001'),
    }),
    secretProvider: {
      getSecret: () => Promise.resolve(null),
    },
    sessionDirectory: '/tmp/synthetic-test-session',
  });
}

function makeControl(signal?: AbortSignal, deadlineAt?: Date): OperationControl {
  const controller = new AbortController();
  return {
    signal: signal ?? controller.signal,
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
  };
}

function makeSearchRequest(
  partial: Partial<SourceSearchRequest> & { queries?: readonly string[] },
): SourceSearchRequest {
  return {
    savedSearchId: partial.savedSearchId ?? 'test-search-001',
    queries: partial.queries ?? ['Nintendo Switch Lite'],
    pagination: partial.pagination ?? { maxPages: 2, maxItems: 10 },
    control: partial.control ?? makeControl(),
    ...(partial.sourceOptions ? { sourceOptions: partial.sourceOptions } : {}),
  };
}

function makeHealthRequest(control?: OperationControl): HealthCheckRequest {
  return {
    control: control ?? makeControl(),
  };
}

function makeReference(externalId: string): ListingReference {
  return {
    sourceId: 'synthetic',
    externalId,
    canonicalUrl: `https://synthetic.invalid/listings/${externalId}`,
  };
}

describe('SyntheticAdapter Unit & Functional Specification (BOAI-009)', () => {
  let adapter: SyntheticAdapter;
  let context: AdapterContext;

  beforeEach(async () => {
    adapter = new SyntheticAdapter();
    context = createTestContext();
    await adapter.initialize(context);
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.dispose();
    }
  });

  describe('1. Identity, Versions, Capabilities and Method Coherence', () => {
    it('declares stable contractual id, version, and compatible sdkVersion', () => {
      expect(adapter.id).toBe(SYNTHETIC_ADAPTER_ID);
      expect(adapter.id).toBe('synthetic');
      expect(adapter.version).toBe(SYNTHETIC_ADAPTER_VERSION);
      expect(adapter.version).toBe('0.1.0');
      expect(adapter.sdkVersion).toBe(SYNTHETIC_ADAPTER_SDK_VERSION);
      expect(adapter.sdkVersion).toBe(ADAPTER_SDK_VERSION);

      const compat = checkAdapterCompatibility(adapter.sdkVersion);
      expect(compat.compatible).toBe(true);
    });

    it('declares truthful capabilities matching implementation exactly', () => {
      expect(adapter.capabilities).toEqual(SYNTHETIC_ADAPTER_CAPABILITIES);
      expect(adapter.capabilities.textSearch).toBe(true);
      expect(adapter.capabilities.pagination).toBe(true);
      expect(adapter.capabilities.listingDetails).toBe(true);
      expect(adapter.capabilities.priceAndCurrency).toBe(true);
      expect(adapter.capabilities.stock).toBe(true);
      expect(adapter.capabilities.exactUrlWatch).toBe(false);
      expect(adapter.capabilities.authentication).toBe(false);
      expect(adapter.capabilities.geographicSearch).toBe(false);
      expect(adapter.capabilities.advertisedDiscount).toBe(false);
    });

    it('exhibits method coherence (getDetails implemented, authenticate not declared)', () => {
      const coherence = validateAdapterMethodCoherence(adapter);
      expect(coherence.valid).toBe(true);
      expect(coherence.errors).toHaveLength(0);
      expect(typeof adapter.getDetails).toBe('function');
      expect((adapter as unknown as Record<string, unknown>)['authenticate']).toBeUndefined();
    });
  });

  describe('2. Determinism and Repeatability', () => {
    it('produces 100% identical outputs when executed twice with identical parameters and clock', async () => {
      const request = makeSearchRequest({
        savedSearchId: 'search-det-001',
        queries: ['Nintendo Switch Lite', 'Switch Lite'],
        pagination: { maxPages: 2, maxItems: 10 },
      });

      const result1 = await adapter.search(request);
      const result2 = await adapter.search(request);

      expect(result1.status).toBe('SUCCESS');
      expect(result2.status).toBe('SUCCESS');
      expect(result1).toEqual(result2);
      expect(result1.items).toEqual(result2.items);
      expect(result1.diagnostics).toEqual(result2.diagnostics);
    });
  });

  describe('3. Fixture Corpus and Price Evidence Matrix', () => {
    it('contains comprehensive price evidence without business decisions in adapter', () => {
      // 1. ARS explicit
      const arsItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText.includes('ARS 250.000'));
      expect(arsItem).toBeDefined();
      expect(arsItem?.sourceCurrencyCode).toBe('ARS');

      // 2. $ pesos
      const pesosItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText.includes('$ 250.000 pesos'));
      expect(pesosItem).toBeDefined();

      // 3. USD explicit
      const usdItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText === 'USD 300');
      expect(usdItem).toBeDefined();
      expect(usdItem?.sourceCurrencyCode).toBe('USD');

      // 4. US$ explicit
      const usDollarItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText === 'US$ 300');
      expect(usDollarItem).toBeDefined();
      expect(usDollarItem?.sourceCurrencyCode).toBe('USD');

      // 5. Ambiguous $300
      const ambiguous300 = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText === '$300');
      expect(ambiguous300).toBeDefined();
      expect(ambiguous300?.sourceCurrencyCode).toBeNull();

      // 6. Deposit (Seña)
      const depositItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText.includes('Seña'));
      expect(depositItem).toBeDefined();
      expect(depositItem?.sourceCurrencyCode).toBeNull();

      // 7. Installments (Cuotas)
      const installmentItem = SYNTHETIC_FIXTURES.find((f) => f.rawPriceText.includes('cuotas'));
      expect(installmentItem).toBeDefined();
      expect(installmentItem?.sourceCurrencyCode).toBeNull();
    });

    it('contains diverse fixture categories (valid, ambiguous, accessory, replacement, broken, games only, empty box)', () => {
      const ids = SYNTHETIC_FIXTURES.map((f) => f.externalId);
      expect(ids).toContain('syn-001'); // Valid
      expect(ids).toContain('syn-005'); // Ambiguous
      expect(ids).toContain('syn-008'); // Accessory (funda)
      expect(ids).toContain('syn-009'); // Replacement part (pantalla)
      expect(ids).toContain('syn-010'); // Broken (para reparar)
      expect(ids).toContain('syn-011'); // Games only
      expect(ids).toContain('syn-012'); // Empty box
    });

    it('enforces that all fixtures have stable .invalid URLs and zero personal data', () => {
      for (const fixture of SYNTHETIC_FIXTURES) {
        expect(fixture.externalId).toMatch(/^syn-\d{3}$/);
        expect(fixture.canonicalUrl).toMatch(/^https:\/\/synthetic\.invalid\/listings\/syn-\d{3}$/);
        for (const img of fixture.imageUrls) {
          expect(img).toMatch(/^https:\/\/synthetic\.invalid\/images\//);
        }
      }
    });
  });

  describe('4. Cross-Query Duplicate Preservation', () => {
    it('preserves exact externalId and canonicalUrl for duplicates across queries without deduping in adapter', async () => {
      const request = makeSearchRequest({
        savedSearchId: 'search-dup-001',
        queries: ['Nintendo Switch Lite', 'Switch Lite', 'Nintendo Lite'],
        pagination: { maxPages: 10, maxItems: 50 },
        sourceOptions: { pageSize: 20 },
      });

      const result = await adapter.search(request);
      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        const syn001Occurrences = result.items.filter((i) => i.externalId === 'syn-001');
        // syn-001 matches all 3 queries and is returned 3 times
        expect(syn001Occurrences.length).toBe(3);

        for (const item of syn001Occurrences) {
          expect(item.externalId).toBe('syn-001');
          expect(item.canonicalUrl).toBe('https://synthetic.invalid/listings/syn-001');
          expect(item.sourceId).toBe('synthetic');
          expect(item.title).toBe('Nintendo Switch Lite Turquesa usada');
        }
      }
    });
  });

  describe('5. Scenarios (SUCCESS, ZERO_RESULTS, Errors)', () => {
    it('returns ZERO_RESULTS_CONFIRMED when scenario is ZERO_RESULTS', async () => {
      adapter.setScenario('ZERO_RESULTS');
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 2, maxItems: 10 },
        }),
      );

      expect(result.status).toBe('ZERO_RESULTS_CONFIRMED');
      if (result.status === 'ZERO_RESULTS_CONFIRMED') {
        expect(result.items).toHaveLength(0);
        expect(result.pagesRead).toBe(1);
        expect(result.hasMore).toBe(false);
        expect(result.diagnostics.stopReason).toBe('NO_MORE_RESULTS');
      }
    });

    it('returns ZERO_RESULTS_CONFIRMED when query matches zero fixtures in corpus', async () => {
      adapter.setScenario('SUCCESS');
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['PlayStation 5 Pro NonExistentProduct'],
          pagination: { maxPages: 2, maxItems: 10 },
        }),
      );

      expect(result.status).toBe('ZERO_RESULTS_CONFIRMED');
      if (result.status === 'ZERO_RESULTS_CONFIRMED') {
        expect(result.items).toHaveLength(0);
        expect(result.diagnostics.stopReason).toBe('NO_MORE_RESULTS');
      }
    });

    it('rejects with typed NETWORK_ERROR when scenario is NETWORK_ERROR', async () => {
      adapter.setScenario('NETWORK_ERROR');
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw SourceAdapterError');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('NETWORK_ERROR');
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('rejects with typed TIMEOUT when scenario is TIMEOUT', async () => {
      adapter.setScenario('TIMEOUT');
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw SourceAdapterError');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('TIMEOUT');
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('rejects with typed RATE_LIMITED when scenario is RATE_LIMITED', async () => {
      adapter.setScenario('RATE_LIMITED');
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw SourceAdapterError');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('RATE_LIMITED');
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('rejects with typed AUTHENTICATION_REQUIRED when scenario is AUTHENTICATION_REQUIRED', async () => {
      adapter.setScenario('AUTHENTICATION_REQUIRED');
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw SourceAdapterError');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('AUTHENTICATION_REQUIRED');
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('rejects with typed CONTRACT_CHANGED when scenario is CONTRACT_CHANGED', async () => {
      adapter.setScenario('CONTRACT_CHANGED');
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw SourceAdapterError');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('CONTRACT_CHANGED');
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('STRICT INVARIANT: source failure NEVER yields ZERO_RESULTS_CONFIRMED', async () => {
      const errorScenarios: SyntheticScenario[] = [
        'NETWORK_ERROR',
        'TIMEOUT',
        'RATE_LIMITED',
        'AUTHENTICATION_REQUIRED',
        'CONTRACT_CHANGED',
      ];

      for (const scenario of errorScenarios) {
        adapter.setScenario(scenario);
        await expect(
          adapter.search(
            makeSearchRequest({
              savedSearchId: 's1',
              queries: ['Nintendo Switch Lite'],
              pagination: { maxPages: 1, maxItems: 10 },
            }),
          ),
        ).rejects.toThrow(SourceAdapterError);
      }
    });
  });

  describe('6. Artificial Pagination and StopReason Invariants', () => {
    it('respects maxPages=1 and returns at most 1 page of results', async () => {
      adapter.setPageSize(3);
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 1, maxItems: 50 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.pagesRead).toBe(1);
        expect(result.items.length).toBe(3);
        expect(result.hasMore).toBe(true);
        expect(result.diagnostics.stopReason).toBe('MAX_PAGES_REACHED');
      }
    });

    it('respects maxPages=2 and returns at most 2 pages of results', async () => {
      adapter.setPageSize(3);
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 2, maxItems: 50 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.pagesRead).toBe(2);
        expect(result.items.length).toBe(6);
        expect(result.hasMore).toBe(true);
        expect(result.diagnostics.stopReason).toBe('MAX_PAGES_REACHED');
      }
    });

    it('respects maxItems=1 and caps items returned to exactly 1', async () => {
      adapter.setPageSize(3);
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 10, maxItems: 1 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.items).toHaveLength(1);
        expect(result.pagesRead).toBe(1);
        expect(result.hasMore).toBe(true);
        expect(result.diagnostics.stopReason).toBe('MAX_ITEMS_REACHED');
      }
    });

    it('respects maxItems=4 across multiple pages and stops at 4', async () => {
      adapter.setPageSize(3);
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 10, maxItems: 4 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.items).toHaveLength(4);
        expect(result.pagesRead).toBe(2);
        expect(result.hasMore).toBe(true);
        expect(result.diagnostics.stopReason).toBe('MAX_ITEMS_REACHED');
      }
    });

    it('reports ALL_PAGES_FETCHED and hasMore=false when all corpus items fit within limits', async () => {
      adapter.setPageSize(20);
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 10, maxItems: 100 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.hasMore).toBe(false);
        expect(result.diagnostics.stopReason).toBe('ALL_PAGES_FETCHED');
      }
    });
  });

  describe('7. SourceOptions and Dynamic Configuration Override', () => {
    it('allows overriding scenario dynamically per-search via sourceOptions.scenario', async () => {
      adapter.setScenario('SUCCESS');

      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 1, maxItems: 10 },
          sourceOptions: { scenario: 'ZERO_RESULTS' },
        }),
      );

      expect(result.status).toBe('ZERO_RESULTS_CONFIRMED');
    });

    it('rejects with CONFIGURATION_UNSUPPORTED on invalid scenario string in sourceOptions', async () => {
      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['Nintendo Switch Lite'],
            pagination: { maxPages: 1, maxItems: 10 },
            sourceOptions: { scenario: 'INVALID_UNKNOWN_SCENARIO' },
          }),
        );
        expect.unreachable('Should throw CONFIGURATION_UNSUPPORTED');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('CONFIGURATION_UNSUPPORTED');
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('allows overriding pageSize per-search via sourceOptions.pageSize', async () => {
      const result = await adapter.search(
        makeSearchRequest({
          savedSearchId: 's1',
          queries: ['Nintendo Switch Lite'],
          pagination: { maxPages: 1, maxItems: 50 },
          sourceOptions: { pageSize: 5 },
        }),
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.items.length).toBe(5);
      }
    });
  });

  describe('8. Health Check States', () => {
    it('returns HEALTHY status with clock-driven checkedAt', async () => {
      adapter.setHealthStatus('HEALTHY');
      const health = await adapter.healthCheck(makeHealthRequest());
      expect(health.sourceId).toBe('synthetic');
      expect(health.status).toBe('HEALTHY');
      expect(health.checkedAt.toISOString()).toBe('2026-08-31T12:00:00.000Z');
      expect(health.evidence?.[0]).toContain('operational');
    });

    it('returns DEGRADED status when configured', async () => {
      adapter.setHealthStatus('DEGRADED');
      const health = await adapter.healthCheck(makeHealthRequest());
      expect(health.status).toBe('DEGRADED');
    });

    it('returns UNAVAILABLE status when configured', async () => {
      adapter.setHealthStatus('UNAVAILABLE');
      const health = await adapter.healthCheck(makeHealthRequest());
      expect(health.status).toBe('UNAVAILABLE');
    });

    it('returns AUTH_REQUIRED status when configured', async () => {
      adapter.setHealthStatus('AUTH_REQUIRED');
      const health = await adapter.healthCheck(makeHealthRequest());
      expect(health.status).toBe('AUTH_REQUIRED');
    });
  });

  describe('9. Listing Details (getDetails)', () => {
    it('returns complete deterministic details for known reference', async () => {
      const details = await adapter.getDetails(makeReference('syn-001'), makeControl());
      expect(details.externalId).toBe('syn-001');
      expect(details.sourceId).toBe('synthetic');
      expect(details.title).toBe('Nintendo Switch Lite Turquesa usada');
      expect(details.rawPriceText).toBe('ARS 250.000');
      expect(details.sourceCurrencyCode).toBe('ARS');
      expect(details.canonicalUrl).toBe('https://synthetic.invalid/listings/syn-001');
      expect(details.attributes).toBeDefined();
      expect(details.fetchedAt.toISOString()).toBe('2026-08-31T12:00:00.000Z');
    });

    it('rejects with PARSER_FAILED for unknown reference', async () => {
      try {
        await adapter.getDetails(makeReference('syn-999-nonexistent'), makeControl());
        expect.unreachable('Should throw SourceAdapterError for unknown ID');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('PARSER_FAILED');
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('rejects getDetails when operation control is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      try {
        await adapter.getDetails(makeReference('syn-001'), { signal: controller.signal });
        expect.unreachable('Should throw TIMEOUT on aborted signal');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('TIMEOUT');
        }
      }
    });
  });

  describe('10. Lifecycle Management', () => {
    it('allows idempotent repeated initialize() calls', async () => {
      expect(adapter.initCount).toBe(1);
      await adapter.initialize(context);
      expect(adapter.initCount).toBe(2);
      expect(adapter.isInitialized).toBe(true);
    });

    it('allows idempotent repeated dispose() calls and prevents subsequent search', async () => {
      await adapter.dispose();
      expect(adapter.isDisposed).toBe(true);
      expect(adapter.disposeCount).toBe(1);

      await adapter.dispose();
      expect(adapter.disposeCount).toBe(2);

      try {
        await adapter.search(
          makeSearchRequest({
            savedSearchId: 's1',
            queries: ['test'],
            pagination: { maxPages: 1, maxItems: 10 },
          }),
        );
        expect.unreachable('Should throw on disposed adapter');
      } catch (error) {
        expect(isSourceAdapterError(error)).toBe(true);
        if (isSourceAdapterError(error)) {
          expect(error.code).toBe('CONFIGURATION_UNSUPPORTED');
        }
      }
    });
  });
});
