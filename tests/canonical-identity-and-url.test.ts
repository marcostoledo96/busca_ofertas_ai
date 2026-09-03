import { describe, it, expect } from 'vitest';
import {
  normalizeGenericUrl,
  UrlCanonicalizerRegistry,
  type SourceUrlCanonicalizer,
  createFallbackExternalId,
  isFallbackExternalId,
  FALLBACK_EXTERNAL_ID_NAMESPACE,
  createListing,
  type Hasher,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';
import { SyntheticUrlCanonicalizer } from '@busca-ofertas-ai/adapter-synthetic';
import { createNodeCryptoHasher } from '@busca-ofertas-ai/storage-sqlite';

describe('Canonical Identity & URL Canonicalization (BOAI-012)', () => {
  const hasher: Hasher = createNodeCryptoHasher();

  describe('normalizeGenericUrl', () => {
    it('normalizes scheme, host, default ports, and trailing slashes', () => {
      const normalized = normalizeGenericUrl('HTTP://EXAMPLE.COM:80/path/to/item/?');
      expect(normalized).toBe('http://example.com/path/to/item');

      const normalizedHttps = normalizeGenericUrl('HTTPS://Shop.Example.Com:443/products/');
      expect(normalizedHttps).toBe('https://shop.example.com/products');
    });

    it('strips common marketing and tracking parameters', () => {
      const urlWithTracking =
        'https://example.com/items/123?utm_source=facebook&utm_medium=cpc&utm_campaign=summer&fbclid=IwAR123&gclid=xyz&ref=search&id=product-99';
      const normalized = normalizeGenericUrl(urlWithTracking);
      expect(normalized).toBe('https://example.com/items/123?id=product-99');
    });

    it('sorts remaining query parameters deterministically', () => {
      const url1 = 'https://example.com/search?z=3&a=1&m=2';
      const url2 = 'https://example.com/search?m=2&z=3&a=1';
      expect(normalizeGenericUrl(url1)).toBe('https://example.com/search?a=1&m=2&z=3');
      expect(normalizeGenericUrl(url2)).toBe('https://example.com/search?a=1&m=2&z=3');
      expect(normalizeGenericUrl(url1)).toBe(normalizeGenericUrl(url2));
    });

    it('strips URL fragments by default', () => {
      const normalized = normalizeGenericUrl('https://example.com/item/1#reviews-section');
      expect(normalized).toBe('https://example.com/item/1');
    });

    it('fails closed on invalid URL strings', () => {
      expect(() => normalizeGenericUrl('')).toThrow(InvariantViolationError);
      expect(() => normalizeGenericUrl('   ')).toThrow(InvariantViolationError);
      expect(() => normalizeGenericUrl('not-a-valid-url')).toThrow(InvariantViolationError);
    });
  });

  describe('SourceUrlCanonicalizer and UrlCanonicalizerRegistry', () => {
    it('dispatches to source-specific canonicalizer when registered', () => {
      const registry = new UrlCanonicalizerRegistry();

      // Register synthetic canonicalizer
      const syntheticCanonicalizer = new SyntheticUrlCanonicalizer();
      registry.register(syntheticCanonicalizer);

      // Register a fake source canonicalizer to prove source-specific behavior
      const fakeSourceCanonicalizer: SourceUrlCanonicalizer = {
        sourceId: 'fake-catalog',
        canonicalize: (rawUrl: string) => {
          const u = new URL(rawUrl);
          // Fake source extracts product code from path and ignores everything else
          const match = u.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/);
          const code = match ? match[1] : 'unknown';
          return `https://fake-catalog.test/item/${code}`;
        },
      };
      registry.register(fakeSourceCanonicalizer);

      // 1. Synthetic dispatch
      const synUrl = 'https://synthetic.invalid/listings/syn-001?utm_source=promo&view=grid';
      expect(registry.canonicalize('synthetic', synUrl)).toBe(
        'https://synthetic.invalid/listings/syn-001',
      );

      // 2. Fake source dispatch
      const fakeUrl = 'https://fake-catalog.test/catalog/p/switch-lite-blue?tracking_id=9876';
      expect(registry.canonicalize('fake-catalog', fakeUrl)).toBe(
        'https://fake-catalog.test/item/switch-lite-blue',
      );

      // 3. Unregistered source falls back to generic normalization
      const genericUrl = 'https://other-store.org/item/50?utm_source=newsletter&sort=asc';
      expect(registry.canonicalize('other-store', genericUrl)).toBe(
        'https://other-store.org/item/50?sort=asc',
      );
    });

    it('enforces that two tracking URLs with the same external ID converge to one canonical identity', () => {
      const registry = new UrlCanonicalizerRegistry();
      registry.register(new SyntheticUrlCanonicalizer());

      const urlA = 'https://synthetic.invalid/listings/syn-042?utm_source=fb&fbclid=abc123xyz';
      const urlB =
        'https://synthetic.invalid/listings/syn-042?utm_campaign=retargeting&gclid=def456';

      const canonicalA = registry.canonicalize('synthetic', urlA);
      const canonicalB = registry.canonicalize('synthetic', urlB);

      expect(canonicalA).toBe('https://synthetic.invalid/listings/syn-042');
      expect(canonicalB).toBe('https://synthetic.invalid/listings/syn-042');
      expect(canonicalA).toBe(canonicalB);

      // Same (sourceId, externalId) produces identical Listing
      const listing1 = createListing({
        id: 'list-042',
        sourceId: 'synthetic',
        externalId: 'syn-042',
        canonicalUrl: canonicalA,
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const listing2 = createListing({
        id: 'list-042',
        sourceId: 'synthetic',
        externalId: 'syn-042',
        canonicalUrl: canonicalB,
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T12:00:00Z'),
      });

      expect(listing1.sourceId).toBe(listing2.sourceId);
      expect(listing1.externalId).toBe(listing2.externalId);
      expect(listing1.canonicalUrl).toBe(listing2.canonicalUrl);
    });

    it('does NOT merge listings with different external IDs even if URLs are similar', () => {
      const registry = new UrlCanonicalizerRegistry();
      registry.register(new SyntheticUrlCanonicalizer());

      const url1 = 'https://synthetic.invalid/listings/syn-001';
      const url2 = 'https://synthetic.invalid/listings/syn-002';

      const listingA = createListing({
        id: 'list-1',
        sourceId: 'synthetic',
        externalId: 'syn-001',
        canonicalUrl: registry.canonicalize('synthetic', url1),
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const listingB = createListing({
        id: 'list-2',
        sourceId: 'synthetic',
        externalId: 'syn-002',
        canonicalUrl: registry.canonicalize('synthetic', url2),
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      expect(listingA.externalId).not.toBe(listingB.externalId);
      expect(listingA.canonicalUrl).not.toBe(listingB.canonicalUrl);
    });
  });

  describe('Fallback Identity (Option B with 4 Conditions)', () => {
    it('generates fallback identity with reserved namespace urn:boai:fallback:url: (Condition 1)', () => {
      const canonicalUrl = 'https://synthetic.invalid/listings/syn-fallback-100';
      const fallbackId = createFallbackExternalId(canonicalUrl, hasher);

      expect(fallbackId.startsWith(FALLBACK_EXTERNAL_ID_NAMESPACE)).toBe(true);
      expect(isFallbackExternalId(fallbackId)).toBe(true);
      expect(fallbackId).toMatch(/^urn:boai:fallback:url:[a-f0-9]{64}$/);
    });

    it('hashes strictly from the canonicalized URL, not the raw tracking URL (Condition 2)', () => {
      const registry = new UrlCanonicalizerRegistry();
      registry.register(new SyntheticUrlCanonicalizer());

      const rawUrl1 = 'https://synthetic.invalid/listings/syn-100?utm_source=twitter&fbclid=123';
      const rawUrl2 = 'https://synthetic.invalid/listings/syn-100?utm_medium=email&gclid=456';

      const canonical1 = registry.canonicalize('synthetic', rawUrl1);
      const canonical2 = registry.canonicalize('synthetic', rawUrl2);

      const fallbackId1 = createFallbackExternalId(canonical1, hasher);
      const fallbackId2 = createFallbackExternalId(canonical2, hasher);

      expect(fallbackId1).toBe(fallbackId2);

      // Proves that hashing raw tracking URL would produce conflicting IDs
      const rawHash1 = createFallbackExternalId(rawUrl1, hasher);
      const rawHash2 = createFallbackExternalId(rawUrl2, hasher);
      expect(rawHash1).not.toBe(rawHash2);
      expect(fallbackId1).not.toBe(rawHash1);
    });

    it('preserves source isolation: same fallback ID on different sources does not mix (Condition 3)', () => {
      const canonicalUrl = 'https://shared-domain.example/items/common';
      const fallbackId = createFallbackExternalId(canonicalUrl, hasher);

      const listingSourceA = createListing({
        id: 'uuid-a',
        sourceId: 'source-alpha',
        externalId: fallbackId,
        canonicalUrl,
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      const listingSourceB = createListing({
        id: 'uuid-b',
        sourceId: 'source-beta',
        externalId: fallbackId,
        canonicalUrl,
        firstSeenAt: new Date('2026-08-30T10:00:00Z'),
        lastSeenAt: new Date('2026-08-30T10:00:00Z'),
      });

      // Natural composite key (sourceId, externalId) remains distinct
      expect(listingSourceA.sourceId).not.toBe(listingSourceB.sourceId);
      expect(listingSourceA.externalId).toBe(listingSourceB.externalId);
    });

    it('fails closed when attempting to create fallback ID from invalid or empty URL', () => {
      expect(() => createFallbackExternalId('', hasher)).toThrow(InvariantViolationError);
      expect(() => createFallbackExternalId('   ', hasher)).toThrow(InvariantViolationError);
      expect(() =>
        createFallbackExternalId('https://example.com', null as unknown as Hasher),
      ).toThrow(InvariantViolationError);
    });
  });
});
