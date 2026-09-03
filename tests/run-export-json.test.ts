import { describe, it, expect } from 'vitest';
import { serializeJson, type RunExportSnapshot } from '@busca-ofertas-ai/run-export';

function createRepresentativeSnapshot(): RunExportSnapshot {
  return {
    schemaVersion: 1,
    run: {
      id: 'run-alpha',
      savedSearchId: 'search-omega',
      status: 'SUCCESS',
      startedAt: '2026-08-30T10:00:00.000Z',
      finishedAt: '2026-08-30T10:05:00.000Z',
      error: null,
    },
    search: {
      savedSearchId: 'search-omega',
      revisionNumber: 1,
      schemaVersion: 1,
      name: 'Search Omega',
      category: 'PRODUCT',
    },
    manualExchangeRate: null,
    sources: [
      {
        sourceRunId: 'sr-beta',
        sourceId: 'source-b',
        collectorId: 'col-2',
        adapterVersion: '0.1.0',
        status: 'SUCCESS',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:04:00.000Z',
        itemsCount: 1,
        metrics: null,
        error: null,
      },
      {
        sourceRunId: 'sr-alpha',
        sourceId: 'source-a',
        collectorId: 'col-1',
        adapterVersion: '0.1.0',
        status: 'SUCCESS',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:03:00.000Z',
        itemsCount: 1,
        metrics: null,
        error: null,
      },
    ],
    results: [
      {
        listingId: 'listing-2',
        observationId: 'obs-2',
        sourceRunId: 'sr-beta',
        sourceId: 'source-b',
        externalId: 'ext-2',
        canonicalUrl: 'https://example.com/b/2',
        observedAt: '2026-08-30T10:02:00.000Z',
        publishedAt: null,
        title: 'Title B',
        description: null,
        condition: null,
        availability: 'AVAILABLE',
        imageUrls: [],
        rawFingerprint: 'fp-2',
        price: null,
        location: null,
        novelty: null,
        evaluation: null,
      },
      {
        listingId: 'listing-1',
        observationId: 'obs-1',
        sourceRunId: 'sr-alpha',
        sourceId: 'source-a',
        externalId: 'ext-1',
        canonicalUrl: 'https://example.com/a/1',
        observedAt: '2026-08-30T10:01:00.000Z',
        publishedAt: null,
        title: 'Title A',
        description: null,
        condition: null,
        availability: 'AVAILABLE',
        imageUrls: [],
        rawFingerprint: 'fp-1',
        price: null,
        location: null,
        novelty: null,
        evaluation: null,
      },
    ],
  };
}

describe('Run Export JSON Serializer (BOAI-014)', () => {
  it('produces byte-for-byte deterministic output with canonical trailing newline', () => {
    const snapshot = createRepresentativeSnapshot();
    const json1 = serializeJson(snapshot);
    const json2 = serializeJson(snapshot);

    expect(json1).toBe(json2);
    expect(json1.endsWith('\n')).toBe(true);
    expect(json1.endsWith('\r\n')).toBe(false); // standard JSON uses Unix \n
  });

  it('deterministically sorts sources and results regardless of insertion order', () => {
    const snapshot = createRepresentativeSnapshot();
    const json = serializeJson(snapshot);
    const parsed = JSON.parse(json) as RunExportSnapshot;

    // sources must be sorted by sourceId ASC: source-a then source-b
    expect(parsed.sources[0]?.sourceId).toBe('source-a');
    expect(parsed.sources[1]?.sourceId).toBe('source-b');

    // results must be sorted by sourceId ASC: source-a then source-b
    expect(parsed.results[0]?.sourceId).toBe('source-a');
    expect(parsed.results[1]?.sourceId).toBe('source-b');
  });

  it('enforces deterministic key ordering in root, run, search, and objects', () => {
    const snapshot = createRepresentativeSnapshot();
    const json = serializeJson(snapshot);
    const parsed = JSON.parse(json) as RunExportSnapshot;

    expect(Object.keys(parsed as unknown as Record<string, unknown>)).toEqual([
      'schemaVersion',
      'run',
      'search',
      'manualExchangeRate',
      'sources',
      'results',
    ]);

    expect(Object.keys(parsed.run as unknown as Record<string, unknown>)).toEqual([
      'id',
      'savedSearchId',
      'status',
      'startedAt',
      'finishedAt',
      'error',
    ]);

    expect(Object.keys(parsed.search as unknown as Record<string, unknown>)).toEqual([
      'savedSearchId',
      'revisionNumber',
      'schemaVersion',
      'name',
      'category',
    ]);
  });
});
