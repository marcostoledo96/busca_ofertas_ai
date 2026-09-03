import { describe, it, expect } from 'vitest';
import {
  validateRunExportSnapshot,
  RunExportValidationError,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';

function createValidCanonicalSnapshot(): RunExportSnapshot {
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
      category: 'PRODUCT',
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
          stopReason: 'ALL_PAGES_FETCHED',
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
          converted: {
            amount: 180000,
            currency: 'ARS',
            exchangeRate: 1,
            exchangeRateOrigin: 'MANUAL',
            convertedAt: '2026-08-30T10:02:00.000Z',
          },
        },
        location: {
          rawText: 'Palermo, CABA',
          region: 'CABA',
          city: 'Buenos Aires',
          neighborhood: 'Palermo',
          latitude: -34.5889,
          longitude: -58.4306,
        },
        novelty: 'NEW',
        evaluation: {
          decision: 'MATCH',
          score: 95,
          reasons: [
            {
              code: 'PRICE_OK',
              message: 'Within range',
              impact: 10,
              severity: 'INFO',
            },
          ],
          evaluatedBy: ['RULES'],
          policyVersion: '1.0.0',
          createdAt: '2026-08-30T10:02:05.000Z',
        },
      },
    ],
  };
}

describe('Run Export Runtime Validation (BOAI-014)', () => {
  it('passes a fully valid canonical full fixture', () => {
    const snap = createValidCanonicalSnapshot();
    expect(() => validateRunExportSnapshot(snap)).not.toThrow();
  });

  it('rejects unsupported schemaVersion', () => {
    const raw: unknown = { ...createValidCanonicalSnapshot(), schemaVersion: 2 };
    expect(() => validateRunExportSnapshot(raw)).toThrow(RunExportValidationError);
  });

  it('rejects non-canonical timestamps that do not roundtrip', () => {
    const valid = createValidCanonicalSnapshot();
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
    const valid = createValidCanonicalSnapshot();
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
    const valid = createValidCanonicalSnapshot();

    // Valid negative coordinates pass
    expect(() => validateRunExportSnapshot(valid)).not.toThrow();

    // Invalid latitude > 90
    const rawBadLat: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: { ...valid.results[0]!.location!, latitude: 90.0001 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawBadLat)).toThrow(RunExportValidationError);

    // Invalid latitude < -90
    const rawBadNegLat: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: { ...valid.results[0]!.location!, latitude: -90.0001 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawBadNegLat)).toThrow(RunExportValidationError);

    // Invalid longitude > 180
    const rawBadLon: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: { ...valid.results[0]!.location!, longitude: 180.0001 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawBadLon)).toThrow(RunExportValidationError);

    // Invalid longitude < -180
    const rawBadNegLon: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: { ...valid.results[0]!.location!, longitude: -180.0001 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawBadNegLon)).toThrow(RunExportValidationError);

    // NaN coordinates rejected
    const rawNanLat: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          location: { ...valid.results[0]!.location!, latitude: Number.NaN },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawNanLat)).toThrow(RunExportValidationError);
  });

  it('enforces confidence between 0 and 1', () => {
    const valid = createValidCanonicalSnapshot();
    const rawOver: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: { ...valid.results[0]!.price!, confidence: 1.05 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawOver)).toThrow(RunExportValidationError);

    const rawUnder: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: { ...valid.results[0]!.price!, confidence: -0.05 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawUnder)).toThrow(RunExportValidationError);
  });

  it('enforces score between 0 and 100', () => {
    const valid = createValidCanonicalSnapshot();
    const rawScoreOver: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          evaluation: { ...valid.results[0]!.evaluation!, score: 101 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawScoreOver)).toThrow(RunExportValidationError);

    const rawScoreUnder: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          evaluation: { ...valid.results[0]!.evaluation!, score: -1 },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawScoreUnder)).toThrow(RunExportValidationError);

    const rawScoreNaN: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          evaluation: { ...valid.results[0]!.evaluation!, score: Number.NaN },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawScoreNaN)).toThrow(RunExportValidationError);
  });

  it('enforces referential integrity between results and sources', () => {
    const valid = createValidCanonicalSnapshot();
    const rawUnmatchedSourceRun: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          sourceRunId: 'unknown-sr-999',
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawUnmatchedSourceRun)).toThrow(
      RunExportValidationError,
    );

    const rawMismatchedSourceId: unknown = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          sourceId: 'facebook_marketplace', // sr-1 declares synthetic, not facebook_marketplace
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawMismatchedSourceId)).toThrow(
      RunExportValidationError,
    );
  });

  it('rejects duplicate observation IDs within results', () => {
    const valid = createValidCanonicalSnapshot();
    const rawDup: unknown = {
      ...valid,
      results: [valid.results[0]!, { ...valid.results[0]!, listingId: 'listing-2' }],
    };
    expect(() => validateRunExportSnapshot(rawDup)).toThrow(RunExportValidationError);
  });

  // Finding 3 Regressions:
  it('rejects unknown search category (e.g. "consoles") and accepts contractual categories', () => {
    const valid = createValidCanonicalSnapshot();
    const rawConsoles: unknown = {
      ...valid,
      search: { ...valid.search, category: 'consoles' },
    };
    expect(() => validateRunExportSnapshot(rawConsoles)).toThrow(RunExportValidationError);

    for (const cat of ['PRODUCT', 'REAL_ESTATE', 'VEHICLE'] as const) {
      const rawValid: unknown = {
        ...valid,
        search: { ...valid.search, category: cat },
      };
      expect(() => validateRunExportSnapshot(rawValid)).not.toThrow();
    }
  });

  it('rejects unknown source stopReason (e.g. "COMPLETED") and accepts contractual stop reasons', () => {
    const valid = createValidCanonicalSnapshot();
    const rawCompleted: unknown = {
      ...valid,
      sources: [
        {
          ...valid.sources[0]!,
          metrics: { ...valid.sources[0]!.metrics!, stopReason: 'COMPLETED' },
        },
      ],
    };
    expect(() => validateRunExportSnapshot(rawCompleted)).toThrow(RunExportValidationError);

    const contractualStopReasons = [
      'ALL_PAGES_FETCHED',
      'MAX_PAGES_REACHED',
      'MAX_ITEMS_REACHED',
      'NO_MORE_RESULTS',
      'RATE_LIMIT_STOP',
      'USER_ABORTED',
      'DEADLINE_EXCEEDED',
    ] as const;

    for (const reason of contractualStopReasons) {
      const rawValid: unknown = {
        ...valid,
        sources: [
          {
            ...valid.sources[0]!,
            metrics: { ...valid.sources[0]!.metrics!, stopReason: reason },
          },
        ],
      };
      expect(() => validateRunExportSnapshot(rawValid)).not.toThrow();
    }
  });

  it('rejects missing required nullable keys (differentiates undefined from explicit null)', () => {
    const valid = createValidCanonicalSnapshot();

    // 1. manualExchangeRate missing on root
    const rawNoFx = { ...valid } as Record<string, unknown>;
    delete rawNoFx['manualExchangeRate'];
    expect(() => validateRunExportSnapshot(rawNoFx)).toThrow(RunExportValidationError);

    // 2. run.finishedAt missing
    const rawNoFinished = {
      ...valid,
      run: { ...valid.run },
    } as Record<string, unknown>;
    delete (rawNoFinished['run'] as Record<string, unknown>)['finishedAt'];
    expect(() => validateRunExportSnapshot(rawNoFinished)).toThrow(RunExportValidationError);

    // 3. run.error missing
    const rawNoError = {
      ...valid,
      run: { ...valid.run },
    } as Record<string, unknown>;
    delete (rawNoError['run'] as Record<string, unknown>)['error'];
    expect(() => validateRunExportSnapshot(rawNoError)).toThrow(RunExportValidationError);

    // 4. source.collectorId missing
    const rawNoCollector = {
      ...valid,
      sources: [{ ...valid.sources[0]! }],
    } as Record<string, unknown>;
    delete ((rawNoCollector['sources'] as Record<string, unknown>[])[0] as Record<string, unknown>)[
      'collectorId'
    ];
    expect(() => validateRunExportSnapshot(rawNoCollector)).toThrow(RunExportValidationError);

    // 5. source.metrics missing
    const rawNoMetrics = {
      ...valid,
      sources: [{ ...valid.sources[0]! }],
    } as Record<string, unknown>;
    delete ((rawNoMetrics['sources'] as Record<string, unknown>[])[0] as Record<string, unknown>)[
      'metrics'
    ];
    expect(() => validateRunExportSnapshot(rawNoMetrics)).toThrow(RunExportValidationError);

    // 6. result.description missing
    const rawNoDesc = {
      ...valid,
      results: [{ ...valid.results[0]! }],
    } as Record<string, unknown>;
    delete ((rawNoDesc['results'] as Record<string, unknown>[])[0] as Record<string, unknown>)[
      'description'
    ];
    expect(() => validateRunExportSnapshot(rawNoDesc)).toThrow(RunExportValidationError);

    // 7. result.novelty missing
    const rawNoNov = {
      ...valid,
      results: [{ ...valid.results[0]! }],
    } as Record<string, unknown>;
    delete ((rawNoNov['results'] as Record<string, unknown>[])[0] as Record<string, unknown>)[
      'novelty'
    ];
    expect(() => validateRunExportSnapshot(rawNoNov)).toThrow(RunExportValidationError);

    // 8. result.evaluation missing
    const rawNoEval = {
      ...valid,
      results: [{ ...valid.results[0]! }],
    } as Record<string, unknown>;
    delete ((rawNoEval['results'] as Record<string, unknown>[])[0] as Record<string, unknown>)[
      'evaluation'
    ];
    expect(() => validateRunExportSnapshot(rawNoEval)).toThrow(RunExportValidationError);
  });

  it('rejects missing price.kind when price is present', () => {
    const valid = createValidCanonicalSnapshot();
    const rawNoKind = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: { ...valid.results[0]!.price! },
        },
      ],
    } as Record<string, unknown>;
    const res0 = (rawNoKind['results'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    delete (res0['price'] as Record<string, unknown>)['kind'];
    expect(() => validateRunExportSnapshot(rawNoKind)).toThrow(RunExportValidationError);
  });

  it('rejects missing convertedAt when price.converted is present', () => {
    const valid = createValidCanonicalSnapshot();
    const rawNoConvertedAt = {
      ...valid,
      results: [
        {
          ...valid.results[0]!,
          price: {
            ...valid.results[0]!.price!,
            converted: { ...valid.results[0]!.price!.converted! },
          },
        },
      ],
    } as Record<string, unknown>;
    const res0 = (rawNoConvertedAt['results'] as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const priceObj = res0['price'] as Record<string, unknown>;
    delete (priceObj['converted'] as Record<string, unknown>)['convertedAt'];
    expect(() => validateRunExportSnapshot(rawNoConvertedAt)).toThrow(RunExportValidationError);
  });
});
