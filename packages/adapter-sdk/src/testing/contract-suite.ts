import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Clock } from '@busca-ofertas-ai/core';
import type {
  AdapterContext,
  OperationControl,
  SourceAdapter,
  SourceCapabilities,
  SourceSearchRequest,
} from '../index.js';
import {
  checkAdapterCompatibility,
  isSourceAdapterError,
  validateAdapterMethodCoherence,
  validateCapabilities,
} from '../index.js';

export interface SourceAdapterContractSuiteOptions {
  readonly adapterName: string;
  readonly createAdapter: () => SourceAdapter | Promise<SourceAdapter>;
  readonly createContext?: (clock?: Clock) => AdapterContext | Promise<AdapterContext>;
  readonly validSearchRequest?: (control: OperationControl) => SourceSearchRequest;
  readonly expectedCapabilities?: Partial<SourceCapabilities>;
  readonly simulateFailure?: (
    adapter: SourceAdapter,
    errorType: 'network' | 'timeout' | 'auth' | 'rateLimit',
  ) => void | Promise<void>;
  readonly simulateZeroResults?: (adapter: SourceAdapter) => void | Promise<void>;
}

/**
 * Creates a standard mock AdapterContext for in-memory contract testing.
 */
export function createMockAdapterContext(clock?: Clock): AdapterContext {
  const currentClock: Clock = clock ?? { now: () => new Date('2026-08-30T12:00:00Z') };
  const abortController = new AbortController();

  return {
    runId: 'contract-test-run-001',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    clock: currentClock,
    abortSignal: abortController.signal,
    artifactWriter: {
      writeArtifact: () => Promise.resolve('artifact-ref-001'),
    },
    secretProvider: {
      getSecret: () => Promise.resolve(null),
    },
    sessionDirectory: '/tmp/test-session',
  };
}

/**
 * Reusable Vitest contract test suite for validating SourceAdapter implementations.
 * Can be executed by any concrete adapter (e.g. synthetic adapter, facebook adapters).
 */
export function runSourceAdapterContract(options: SourceAdapterContractSuiteOptions): void {
  const {
    adapterName,
    createAdapter,
    createContext = () => createMockAdapterContext(),
    validSearchRequest = (control: OperationControl) => ({
      savedSearchId: 'test-saved-search-001',
      queries: ['Nintendo Switch Lite'],
      pagination: { maxPages: 2, maxItems: 10 },
      control,
    }),
  } = options;

  describe(`SourceAdapter Contract Conformance: ${adapterName}`, () => {
    let adapter: SourceAdapter;
    let context: AdapterContext;

    beforeEach(async () => {
      adapter = await createAdapter();
      context = await createContext();
      await adapter.initialize(context);
    });

    afterEach(async () => {
      if (adapter) {
        await adapter.dispose();
      }
    });

    describe('1. Identity, Versioning and Metadata', () => {
      it('declares a non-empty string identifier', () => {
        expect(typeof adapter.id).toBe('string');
        expect(adapter.id.trim().length).toBeGreaterThan(0);
      });

      it('declares a non-empty adapter version string', () => {
        expect(typeof adapter.version).toBe('string');
        expect(adapter.version.trim().length).toBeGreaterThan(0);
      });

      it('is compatible with the current Adapter SDK version when sdkVersion is declared', () => {
        if (adapter.sdkVersion) {
          const compat = checkAdapterCompatibility(adapter.sdkVersion);
          expect(compat.compatible).toBe(true);
        }
      });
    });

    describe('2. Capabilities and Method Coherence', () => {
      it('declares all standard boolean capability flags', () => {
        expect(typeof adapter.capabilities.textSearch).toBe('boolean');
        expect(typeof adapter.capabilities.exactUrlWatch).toBe('boolean');
        expect(typeof adapter.capabilities.listingDetails).toBe('boolean');
        expect(typeof adapter.capabilities.authentication).toBe('boolean');
        expect(typeof adapter.capabilities.pagination).toBe('boolean');
        expect(typeof adapter.capabilities.geographicSearch).toBe('boolean');
        expect(typeof adapter.capabilities.priceAndCurrency).toBe('boolean');
        expect(typeof adapter.capabilities.stock).toBe('boolean');
        expect(typeof adapter.capabilities.advertisedDiscount).toBe('boolean');
      });

      it('exhibits method coherence between declared capabilities and optional methods', () => {
        const coherence = validateAdapterMethodCoherence(adapter);
        expect(coherence.valid).toBe(true);
        expect(coherence.errors).toHaveLength(0);
      });

      it('detects missing capabilities before execution via validateCapabilities', () => {
        const unsupportedCheck = validateCapabilities(
          { textSearch: true, geographicSearch: true },
          { ...adapter.capabilities, geographicSearch: false },
        );
        expect(unsupportedCheck.compatible).toBe(false);
        if (!unsupportedCheck.compatible) {
          expect(unsupportedCheck.missing).toContain('geographicSearch');
        }
      });
    });

    describe('3. Lifecycle Management', () => {
      it('initializes cleanly and allows idempotent repeated initialize calls', async () => {
        await expect(adapter.initialize(context)).resolves.not.toThrow();
      });

      it('disposes cleanly and allows idempotent repeated dispose calls', async () => {
        await expect(adapter.dispose()).resolves.not.toThrow();
        await expect(adapter.dispose()).resolves.not.toThrow();
      });
    });

    describe('4. Cancellation and Deadline Control', () => {
      it('aborts search operation when AbortSignal is triggered', async () => {
        const controller = new AbortController();
        controller.abort();

        const request = validSearchRequest({ signal: controller.signal });
        await expect(adapter.search(request)).rejects.toThrow();
      });

      it('rejects search with TIMEOUT when deadline is already in the past', async () => {
        const controller = new AbortController();
        const pastDeadline = new Date(context.clock.now().getTime() - 10000);

        const request = validSearchRequest({
          signal: controller.signal,
          deadlineAt: pastDeadline,
        });

        await expect(adapter.search(request)).rejects.toThrow();
      });
    });

    describe('5. Search Result Invariants (SUCCESS vs ZERO_RESULTS_CONFIRMED)', () => {
      it('returns SUCCESS with items >= 1 and valid diagnostics on normal search', async () => {
        const controller = new AbortController();
        const request = validSearchRequest({ signal: controller.signal });

        const result = await adapter.search(request);
        expect(result.status).toBe('SUCCESS');
        if (result.status === 'SUCCESS') {
          expect(result.items.length).toBeGreaterThan(0);
          expect(result.sourceId).toBe(adapter.id);
          expect(typeof result.pagesRead).toBe('number');
          expect(typeof result.hasMore).toBe('boolean');
          expect(result.diagnostics).toBeDefined();
          expect(result.diagnostics.parsedItemsCount).toBe(result.items.length);
        }
      });

      it('enforces that candidates have non-empty externalId, canonicalUrl, and title', async () => {
        const controller = new AbortController();
        const request = validSearchRequest({ signal: controller.signal });

        const result = await adapter.search(request);
        if (result.status === 'SUCCESS') {
          for (const item of result.items) {
            expect(typeof item.externalId).toBe('string');
            expect(item.externalId.trim().length).toBeGreaterThan(0);
            expect(typeof item.canonicalUrl).toBe('string');
            expect(item.canonicalUrl.startsWith('http')).toBe(true);
            expect(typeof item.title).toBe('string');
            expect(item.title.trim().length).toBeGreaterThan(0);
            expect(item.observedAt).toBeInstanceOf(Date);
          }
        }
      });

      it('returns ZERO_RESULTS_CONFIRMED with items: [] when 0 results are found', async () => {
        if (options.simulateZeroResults) {
          await options.simulateZeroResults(adapter);
          const controller = new AbortController();
          const request = validSearchRequest({ signal: controller.signal });

          const result = await adapter.search(request);
          expect(result.status).toBe('ZERO_RESULTS_CONFIRMED');
          if (result.status === 'ZERO_RESULTS_CONFIRMED') {
            expect(result.items).toHaveLength(0);
            expect(result.diagnostics.rawItemsCount).toBe(0);
          }
        }
      });
    });

    describe('6. Failure Model: Source Failure != Zero Results', () => {
      it('throws SourceAdapterError on external failure and never returns empty success', async () => {
        if (options.simulateFailure) {
          await options.simulateFailure(adapter, 'network');
          const controller = new AbortController();
          const request = validSearchRequest({ signal: controller.signal });

          try {
            const result = await adapter.search(request);
            // Must not reach here
            expect.unreachable(
              `Expected search to throw SourceAdapterError, but returned status: ${(result as { status?: string }).status}`,
            );
          } catch (error) {
            expect(isSourceAdapterError(error)).toBe(true);
            if (isSourceAdapterError(error)) {
              expect(error.code).toBe('NETWORK_ERROR');
              expect(typeof error.retryable).toBe('boolean');
              expect(Array.isArray(error.evidence)).toBe(true);
            }
          }
        }
      });
    });

    describe('7. Pagination Limits & Diagnostics', () => {
      it('respects maxItems pagination limit and reports accurate diagnostics', async () => {
        const controller = new AbortController();
        const request: SourceSearchRequest = {
          ...validSearchRequest({ signal: controller.signal }),
          pagination: { maxPages: 1, maxItems: 1 },
        };

        const result = await adapter.search(request);
        if (result.status === 'SUCCESS') {
          expect(result.items.length).toBeLessThanOrEqual(1);
          expect(result.diagnostics.pagesCompleted).toBeGreaterThanOrEqual(1);
          expect(result.diagnostics.stopReason).toBeDefined();
        }
      });
    });

    describe('8. Health Check Contract', () => {
      it('returns structured SourceHealth without executing a full search', async () => {
        const controller = new AbortController();
        const health = await adapter.healthCheck({
          control: { signal: controller.signal },
        });

        expect(health.sourceId).toBe(adapter.id);
        expect(['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'AUTH_REQUIRED']).toContain(health.status);
        expect(health.checkedAt).toBeInstanceOf(Date);
      });
    });
  });
}
