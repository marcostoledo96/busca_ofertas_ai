import { describe, it, expect } from 'vitest';
import {
  serializeCsv,
  CSV_COLUMNS,
  CSV_COLUMN_COUNT,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';
import { parseCsvRfc4180 } from './helpers/csv-test-parser.js';

function createSnapshotWithFormulaAndCoordinates(): RunExportSnapshot {
  return {
    schemaVersion: 1,
    run: {
      id: 'run-formulas',
      savedSearchId: 'search-1',
      status: 'SUCCESS',
      startedAt: '2026-08-30T10:00:00.000Z',
      finishedAt: '2026-08-30T10:05:00.000Z',
      error: null,
    },
    search: {
      savedSearchId: 'search-1',
      revisionNumber: 1,
      schemaVersion: 1,
      name: '=SUM(1,2)', // Malicious title/name
      category: 'PRODUCT',
    },
    manualExchangeRate: null,
    sources: [
      {
        sourceRunId: 'sr-1',
        sourceId: 'synthetic',
        collectorId: null,
        adapterVersion: '0.1.0',
        status: 'SUCCESS',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:04:00.000Z',
        itemsCount: 2,
        metrics: null,
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
        canonicalUrl: 'https://example.com/1',
        observedAt: '2026-08-30T10:01:00.000Z',
        publishedAt: null,
        title: '+cmd|"/c calc"!A0', // Dangerous formula starting with +
        description: '  -2+3=5 formula attempt with whitespace', // Dangerous formula starting with space and -
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/photo.jpg'],
        rawFingerprint: 'fp-1',
        price: {
          rawText: '$ 150.000',
          amount: 150000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.99,
          evidence: ['tag'],
          kind: 'TOTAL',
          converted: null,
        },
        location: {
          rawText: 'CABA, Argentina',
          region: 'CABA',
          city: 'Buenos Aires',
          neighborhood: 'Monserrat',
          latitude: -34.6037, // Genuine negative numeric value
          longitude: -58.3816, // Genuine negative numeric value
        },
        novelty: null,
        evaluation: null,
      },
    ],
  };
}

describe('Run Export CSV Serializer (BOAI-014)', () => {
  it('enforces exact 65 columns in header and all rows', () => {
    expect(CSV_COLUMNS).toHaveLength(65);
    expect(CSV_COLUMN_COUNT).toBe(65);

    const snapshot = createSnapshotWithFormulaAndCoordinates();
    const csv = serializeCsv(snapshot);
    const parsed = parseCsvRfc4180(csv);

    expect(parsed.headers).toEqual([...CSV_COLUMNS]);
    expect(parsed.headers.length).toBe(65);

    for (let i = 0; i < parsed.rows.length; i++) {
      expect(parsed.rows[i]?.length).toBe(65);
    }
  });

  it('structures CSV records into RUN, SOURCE, and RESULT rows', () => {
    const snapshot = createSnapshotWithFormulaAndCoordinates();
    const csv = serializeCsv(snapshot);
    const parsed = parseCsvRfc4180(csv);

    // Row 0: RUN
    const recordTypeCol = CSV_COLUMNS.indexOf('record_type');
    const runIdCol = CSV_COLUMNS.indexOf('run_id');
    const srIdCol = CSV_COLUMNS.indexOf('source_run_id');
    const sourceIdCol = CSV_COLUMNS.indexOf('source_id');
    const listingIdCol = CSV_COLUMNS.indexOf('listing_id');

    expect(parsed.rows[0]?.[recordTypeCol]).toBe('RUN');
    expect(parsed.rows[0]?.[runIdCol]).toBe('run-formulas');

    // Row 1: SOURCE
    expect(parsed.rows[1]?.[recordTypeCol]).toBe('SOURCE');
    expect(parsed.rows[1]?.[srIdCol]).toBe('sr-1');
    expect(parsed.rows[1]?.[sourceIdCol]).toBe('synthetic');

    // Row 2: RESULT
    expect(parsed.rows[2]?.[recordTypeCol]).toBe('RESULT');
    expect(parsed.rows[2]?.[listingIdCol]).toBe('listing-1');
  });

  it('neutralizes spreadsheet formula injection on untrusted textual fields', () => {
    const snapshot = createSnapshotWithFormulaAndCoordinates();
    const csv = serializeCsv(snapshot);
    const parsed = parseCsvRfc4180(csv);

    // search_name in RUN row: was '=SUM(1,2)' -> must be neutralized with leading '
    const searchNameCol = CSV_COLUMNS.indexOf('search_name');
    expect(parsed.rows[0]?.[searchNameCol]).toBe("'=SUM(1,2)");

    // title in RESULT row: was '+cmd|"/c calc"!A0' -> must be neutralized with leading '
    const titleCol = CSV_COLUMNS.indexOf('title');
    expect(parsed.rows[2]?.[titleCol]).toBe('\'+cmd|"/c calc"!A0');

    // description in RESULT row: was '  -2+3=5...' -> must be neutralized with leading '
    const descCol = CSV_COLUMNS.indexOf('description');
    expect(parsed.rows[2]?.[descCol]).toBe("'  -2+3=5 formula attempt with whitespace");
  });

  it('strictly preserves genuine negative numbers without formula quotes', () => {
    const snapshot = createSnapshotWithFormulaAndCoordinates();
    const csv = serializeCsv(snapshot);
    const parsed = parseCsvRfc4180(csv);

    const latCol = CSV_COLUMNS.indexOf('location_latitude');
    const lonCol = CSV_COLUMNS.indexOf('location_longitude');

    // Latitude and Longitude MUST be plain negative numbers, NEVER prefixed with '
    expect(parsed.rows[2]?.[latCol]).toBe('-34.6037');
    expect(parsed.rows[2]?.[lonCol]).toBe('-58.3816');
  });

  it('handles zero results run without generating fake RESULT rows', () => {
    const snapshot: RunExportSnapshot = {
      ...createSnapshotWithFormulaAndCoordinates(),
      results: [],
    };

    const csv = serializeCsv(snapshot);
    const parsed = parseCsvRfc4180(csv);

    expect(parsed.rows.length).toBe(2); // 1 header + 1 RUN + 1 SOURCE, 0 RESULT
    expect(parsed.rows[0]?.[1]).toBe('RUN');
    expect(parsed.rows[1]?.[1]).toBe('SOURCE');
    expect(parsed.rows.some((r) => r[1] === 'RESULT')).toBe(false);
  });
});
