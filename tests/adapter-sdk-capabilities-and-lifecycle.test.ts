import { describe, it, expect } from 'vitest';
import type { SourceAdapter, SourceCapabilities } from '@busca-ofertas-ai/adapter-sdk';
import {
  ADAPTER_SDK_VERSION,
  checkAdapterCompatibility,
  isAbortedOrExpired,
  validateAdapterMethodCoherence,
  validateCapabilities,
} from '@busca-ofertas-ai/adapter-sdk';
import {
  createMockAdapterContext,
  InMemoryConformanceAdapter,
} from '@busca-ofertas-ai/adapter-sdk/testing';

describe('Adapter SDK Capabilities, Versioning and Lifecycle (BOAI-003)', () => {
  const baseCaps: SourceCapabilities = {
    textSearch: true,
    exactUrlWatch: false,
    listingDetails: false,
    authentication: false,
    pagination: true,
    geographicSearch: false,
    priceAndCurrency: true,
    stock: false,
    advertisedDiscount: false,
  };

  describe('Capability Validation', () => {
    it('detects compatible capabilities when all required flags are satisfied', () => {
      const result = validateCapabilities({ textSearch: true, pagination: true }, baseCaps);
      expect(result.compatible).toBe(true);
      if (result.compatible) {
        expect(result.missing).toHaveLength(0);
      }
    });

    it('detects missing capabilities before execution and reports missing keys', () => {
      const result = validateCapabilities(
        { textSearch: true, geographicSearch: true, listingDetails: true },
        baseCaps,
      );
      expect(result.compatible).toBe(false);
      if (!result.compatible) {
        expect(result.missing).toContain('geographicSearch');
        expect(result.missing).toContain('listingDetails');
        expect(result.missing).not.toContain('textSearch');
      }
    });
  });

  describe('Method Coherence', () => {
    it('passes when declared capabilities match implemented methods', () => {
      const adapter = new InMemoryConformanceAdapter();
      const coherence = validateAdapterMethodCoherence(adapter);
      expect(coherence.valid).toBe(true);
      expect(coherence.errors).toHaveLength(0);
    });

    it('fails when listingDetails=true but getDetails is missing', () => {
      const adapter = new InMemoryConformanceAdapter({
        capabilities: { listingDetails: true, authentication: false },
      });
      const brokenAdapter = {
        ...adapter,
        getDetails: undefined,
      };
      const coherence = validateAdapterMethodCoherence(brokenAdapter as unknown as SourceAdapter);
      expect(coherence.valid).toBe(false);
      expect(coherence.errors[0]).toContain('getDetails');
    });

    it('fails when authentication=true but authenticate is missing', () => {
      const adapter = new InMemoryConformanceAdapter({
        capabilities: { listingDetails: false, authentication: true },
      });
      const brokenAdapter = {
        ...adapter,
        authenticate: undefined,
      };
      const coherence = validateAdapterMethodCoherence(brokenAdapter as unknown as SourceAdapter);
      expect(coherence.valid).toBe(false);
      expect(coherence.errors[0]).toContain('authenticate');
    });
  });

  describe('SDK Versioning and Compatibility', () => {
    it('validates matching minor version under pre-1.0 semver', () => {
      const match = checkAdapterCompatibility('0.1.0', '0.1.0');
      expect(match.compatible).toBe(true);

      const matchPatch = checkAdapterCompatibility('0.1.4', '0.1.0');
      expect(matchPatch.compatible).toBe(true);

      const mismatchMinor = checkAdapterCompatibility('0.2.0', '0.1.0');
      expect(mismatchMinor.compatible).toBe(false);
      expect(mismatchMinor.reason).toContain('Pre-1.0 SDK requires matching minor version');
    });

    it('handles major version changes under post-1.0 semver', () => {
      const matchMajor = checkAdapterCompatibility('1.2.0', '1.0.0');
      expect(matchMajor.compatible).toBe(true);

      const mismatchMajor = checkAdapterCompatibility('2.0.0', '1.0.0');
      expect(mismatchMajor.compatible).toBe(false);
      expect(mismatchMajor.reason).toContain('Incompatible major version');
    });

    it('rejects invalid or malformed semver strings', () => {
      const invalid = checkAdapterCompatibility('invalid-version', '0.1.0');
      expect(invalid.compatible).toBe(false);
      expect(invalid.reason).toContain('Invalid adapter SDK version');
    });

    it('exposes current ADAPTER_SDK_VERSION constant as 0.1.0', () => {
      expect(ADAPTER_SDK_VERSION).toBe('0.1.0');
    });
  });

  describe('Lifecycle State Transitions', () => {
    it('manages initialization and idempotent repeated initialization', async () => {
      const adapter = new InMemoryConformanceAdapter();
      const context = createMockAdapterContext();

      expect(adapter.isInitialized).toBe(false);
      await adapter.initialize(context);
      expect(adapter.isInitialized).toBe(true);
      expect(adapter.initCount).toBe(1);

      // Repeated initialize should not throw
      await adapter.initialize(context);
      expect(adapter.initCount).toBe(2);
    });

    it('manages disposal and idempotent repeated disposal', async () => {
      const adapter = new InMemoryConformanceAdapter();
      const context = createMockAdapterContext();
      await adapter.initialize(context);

      expect(adapter.isDisposed).toBe(false);
      await adapter.dispose();
      expect(adapter.isDisposed).toBe(true);
      expect(adapter.disposeCount).toBe(1);

      // Repeated dispose
      await adapter.dispose();
      expect(adapter.disposeCount).toBe(2);
    });

    it('rejects operations after disposal', async () => {
      const adapter = new InMemoryConformanceAdapter();
      const context = createMockAdapterContext();
      await adapter.initialize(context);
      await adapter.dispose();

      const controller = new AbortController();
      await expect(
        adapter.search({
          savedSearchId: 'test',
          queries: ['test'],
          pagination: { maxPages: 1, maxItems: 5 },
          control: { signal: controller.signal },
        }),
      ).rejects.toThrow('Cannot perform operation on disposed adapter');
    });
  });

  describe('Operation Control and Deadline Assertions', () => {
    it('detects active vs aborted signals correctly', () => {
      const activeController = new AbortController();
      expect(isAbortedOrExpired({ signal: activeController.signal })).toBe(false);

      const abortedController = new AbortController();
      abortedController.abort();
      expect(isAbortedOrExpired({ signal: abortedController.signal })).toBe(true);
    });

    it('detects expired deadlines using provided clock', () => {
      const activeController = new AbortController();
      const fakeClock = { now: () => new Date('2026-08-30T12:00:00Z') };

      const futureDeadline = new Date('2026-08-30T12:05:00Z');
      expect(
        isAbortedOrExpired(
          { signal: activeController.signal, deadlineAt: futureDeadline },
          fakeClock,
        ),
      ).toBe(false);

      const pastDeadline = new Date('2026-08-30T11:59:59Z');
      expect(
        isAbortedOrExpired(
          { signal: activeController.signal, deadlineAt: pastDeadline },
          fakeClock,
        ),
      ).toBe(true);
    });
  });
});
