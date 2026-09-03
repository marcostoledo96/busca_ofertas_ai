import { describe, it, expect } from 'vitest';
import {
  validateRunExportSnapshot,
  RunExportValidationError,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';

function createValidSnapshot(): RunExportSnapshot {
  return {
    schemaVersion: 1,
    run: {
      id: 'run-1',
      savedSearchId: 'search-1',
      status: 'SUCCESS',
      startedAt: '2026-08-30T10:00:00.000Z',
      finishedAt: '2026-08-30T10:05:00.000Z',
      error: null,
    },
    search: {
      savedSearchId: 'search-1',
      revisionNumber: 2,
      schemaVersion: 1,
      name: 'Nintendo Switch Lite',
      category: 'consoles',
    },
    manualExchangeRate: null,
    sources: [
      {
        sourceRunId: 'sr-1',
        sourceId: 'synthetic',
        collectorId: 'col-1',
        adapterVersion: '0.1.0',
        status: 'SUCCESS',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:04:00.000Z',
        itemsCount: 1,
        metrics: {
          pagesRequested: 1,
          pagesCompleted: 1,
          rawItemsCount: 1,
          parsedItemsCount: 1,
          rejectedItemsCount: 0,
          stopReason: 'COMPLETED',
        },
        error: null,
      },
    ],
    results: [
      {
        listingId: 'listing-1',
        observationId: 'obs-1',
        sourceRunId: 'sr-1',
        sourceId: 'synthetic',
        externalId: 'ext-1',
        canonicalUrl: 'https://example.com/item/1',
        observedAt: '2026-08-30T10:02:00.000Z',
        publishedAt: '2026-08-30T09:00:00.000Z',
        title: 'Nintendo Switch Lite Turquesa',
        description: 'Impecable con cargador',
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/img1.jpg'],
        rawFingerprint: 'fp-1',
        price: {
          rawText: '$ 180.000',
          amount: 180000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.95,
          evidence: ['price-tag'],
          kind: 'TOTAL',
          converted: null,
        },
        location: {
          rawText: 'Palermo, CABA',
          region: 'CABA',
          city: 'Buenos Aires',
          neighborhood: 'Palermo',
          latitude: -34.5889,
          longitude: -58.4306,
        },
        novelty: null,
        evaluation: null,
      },
    ],
  };
}

describe('Run Export Runtime Validation (BOAI-014)', () => {
  it('passes a fully valid canonical snapshot', () => {
    const snap = createValidSnapshot();
    expect(() => validateRunExportSnapshot(snap)).not.toThrow();
  });

  it('rejects unsupported schemaVersion', () => {
    const raw: unknown = { ...createValidSnapshot(), schemaVersion: 2 };
    expect(() => validateRunExportSnapshot(raw)).toThrow(RunExportValidationError);
  });

  it('rejects non-canonical timestamps that do not roundtrip', () => {
    const valid = createValidSnapshot();
    const rawMissingMs: unknown = {
      ...valid,
      run: { ...valid.run, startedAt: '2026-08-30T10:00:00Z' },
    };
    expect(() => validateRunExportSnapshot(rawMissingMs)).toThrow(RunExportValidationError);

    const rawInvalidDate: unknown = {
      ...valid,
      run: { ...valid.run, startedAt: 'invalid-date' },
    };
    expect(() => validateRunExportSnapshot(rawInvalidDate)).toThrow(RunExportValidationError);
  });

  it('rejects non-finite numbers (NaN, Infinity, -Infinity)', () => {
    const valid = createValidSnapshot();
    const rawNaN: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: { ...valid.results[0]!.price!, confidence: Number.NaN },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawNaN)).toThrow(RunExportValidationError);

    const rawInf: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: { ...valid.results[0]!.price!, confidence: Number.POSITIVE_INFINITY },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawInf)).toThrow(RunExportValidationError);
  });

  it('validates geographic coordinate boundaries and allows valid negative coordinates', () => {
    const valid = createValidSnapshot();
    const validCoords: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: {
            ...valid.results[0]!.location!,
            latitude: -34.6037,
            longitude: -58.3816,
          },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(validCoords)).not.toThrow();

    const invalidLat: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: {
            ...valid.results[0]!.location!,
            latitude: 95.0,
          },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(invalidLat)).toThrow(RunExportValidationError);

    const invalidLon: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: {
            ...valid.results[0]!.location!,
            longitude: -185.0,
          },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(invalidLon)).toThrow(RunExportValidationError);
  });

  it('validates evaluation integrity when present', () => {
    const valid = createValidSnapshot();
    const emptyReasons: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          evaluation: {
            decision: 'MATCH',
            score: 85,
            reasons: [],
            evaluatedBy: ['RULES'],
            policyVersion: '1.0.0',
            createdAt: '2026-08-30T10:03:00.000Z',
          },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(emptyReasons)).toThrow(RunExportValidationError);

    const validEval: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          evaluation: {
            decision: 'MATCH',
            score: 85,
            reasons: [
              {
                code: 'PRICE_MATCH',
                message: 'Price is below threshold',
                impact: 20,
                severity: 'INFO',
              },
            ],
            evaluatedBy: ['RULES'],
            policyVersion: '1.0.0',
            createdAt: '2026-08-30T10:03:00.000Z',
          },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(validEval)).not.toThrow();
  });

  it('enforces ID coherence: result.sourceRunId must exist in sources and sourceId match', () => {
    const valid = createValidSnapshot();
    const unknownSourceRun: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          sourceRunId: 'unknown-sr',
        },
      ],
    };
    expect(() => validateRunExportSnapshot(unknownSourceRun)).toThrow(RunExportValidationError);

    const mismatchSourceId: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          sourceId: 'different-source-id',
        },
      ],
    };
    expect(() => validateRunExportSnapshot(mismatchSourceId)).toThrow(RunExportValidationError);
  });

  it('rejects duplicate observation IDs and duplicate source run IDs', () => {
    const valid = createValidSnapshot();
    const dupSource: unknown = {
      ...valid,
      sources: [valid.sources[0]!, valid.sources[0]!],
    };
    expect(() => validateRunExportSnapshot(dupSource)).toThrow(RunExportValidationError);

    const dupResult: unknown = {
      ...valid,
      results: [valid.results[0]!, valid.results[0]!],
    };
    expect(() => validateRunExportSnapshot(dupResult)).toThrow(RunExportValidationError);
  });
});
