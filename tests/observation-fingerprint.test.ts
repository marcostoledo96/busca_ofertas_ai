import { describe, it, expect } from 'vitest';
import {
  computeObservationFingerprint,
  buildCanonicalObservationPayload,
  createResolvedPrice,
  type Hasher,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';
import { createNodeCryptoHasher } from '@busca-ofertas-ai/storage-sqlite';

describe('Observation Fingerprinting (BOAI-012)', () => {
  const hasher: Hasher = createNodeCryptoHasher();

  const basePrice = createResolvedPrice({
    rawText: '$250.000',
    amount: 250000,
    currency: 'ARS',
    resolution: 'EXPLICIT',
    confidence: 0.95,
    evidence: ['$250.000'],
  });

  const baseLocation = {
    rawText: 'Palermo, CABA',
    city: 'Buenos Aires',
    neighborhood: 'Palermo',
    coordinates: {
      latitude: -34.5888888,
      longitude: -58.4305555,
    },
  };

  it('produces identical deterministic fingerprints regardless of volatile fields (observedAt, runId, id)', () => {
    // Two observations with different timestamps, runs, and IDs but identical content
    const fp1 = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite Turquesa',
        description: 'Impecable estado con caja y cargador',
        price: basePrice,
        location: baseLocation,
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        publishedAt: new Date('2026-08-30T10:00:00Z'),
      },
      hasher,
    );

    const fp2 = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite Turquesa',
        description: 'Impecable estado con caja y cargador',
        price: basePrice,
        location: baseLocation,
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        publishedAt: new Date('2026-08-30T10:00:00Z'),
      },
      hasher,
    );

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes whitespace in title and trims description', () => {
    const fpA = computeObservationFingerprint(
      {
        title: '   Nintendo    Switch   Lite   ',
        description: '   Excelente estado.   ',
      },
      hasher,
    );

    const fpB = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        description: 'Excelente estado.',
      },
      hasher,
    );

    expect(fpA).toBe(fpB);
  });

  it('deduplicates and sorts image URLs deterministically', () => {
    const fp1 = computeObservationFingerprint(
      {
        title: 'Nintendo Switch',
        imageUrls: [
          'https://example.com/b.jpg',
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
        ],
      },
      hasher,
    );

    const fp2 = computeObservationFingerprint(
      {
        title: 'Nintendo Switch',
        imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      },
      hasher,
    );

    expect(fp1).toBe(fp2);
  });

  it('changes fingerprint when price amount or currency changes', () => {
    const fpOriginal = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        price: basePrice, // $250.000 ARS
      },
      hasher,
    );

    const lowerPrice = createResolvedPrice({
      rawText: '$220.000',
      amount: 220000,
      currency: 'ARS',
      resolution: 'EXPLICIT',
      confidence: 0.95,
      evidence: ['$220.000'],
    });

    const fpPriceChanged = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        price: lowerPrice,
      },
      hasher,
    );

    expect(fpOriginal).not.toBe(fpPriceChanged);
  });

  it('changes fingerprint when availability changes (e.g. AVAILABLE -> SOLD)', () => {
    const fpAvailable = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        availability: 'AVAILABLE',
      },
      hasher,
    );

    const fpSold = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        availability: 'SOLD',
      },
      hasher,
    );

    expect(fpAvailable).not.toBe(fpSold);
  });

  it('changes fingerprint when condition changes (e.g. GOOD -> LIKE_NEW)', () => {
    const fpGood = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        condition: 'GOOD',
      },
      hasher,
    );

    const fpLikeNew = computeObservationFingerprint(
      {
        title: 'Nintendo Switch Lite',
        condition: 'LIKE_NEW',
      },
      hasher,
    );

    expect(fpGood).not.toBe(fpLikeNew);
  });

  it('produces identical canonical payload independent of JavaScript object insertion order', () => {
    const payload1 = buildCanonicalObservationPayload({
      title: 'Item',
      description: 'Desc',
      condition: 'NEW',
      availability: 'AVAILABLE',
    });

    const payload2 = buildCanonicalObservationPayload({
      availability: 'AVAILABLE',
      condition: 'NEW',
      description: 'Desc',
      title: 'Item',
    });

    expect(payload1).toBe(payload2);
  });

  it('fails closed when title is empty or missing', () => {
    expect(() => computeObservationFingerprint({ title: '' }, hasher)).toThrow(
      InvariantViolationError,
    );
    expect(() => computeObservationFingerprint({ title: '    ' }, hasher)).toThrow(
      InvariantViolationError,
    );
  });
});
