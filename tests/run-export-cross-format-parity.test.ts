import { describe, it, expect } from 'vitest';
import {
  serializeJson,
  serializeCsv,
  CSV_COLUMNS,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';
import { parseCsvRfc4180 } from './helpers/csv-test-parser.js';

function createCompleteSnapshot(): RunExportSnapshot {
  return {
    schemaVersion: 1,
    run: {
      id: 'run-parity-100',
      savedSearchId: 'search-lite-amba',
      status: 'PARTIAL_SUCCESS',
      startedAt: '2026-08-30T10:00:00.000Z',
      finishedAt: '2026-08-30T10:05:00.000Z',
      error: null,
    },
    search: {
      savedSearchId: 'search-lite-amba',
      revisionNumber: 3,
      schemaVersion: 1,
      name: 'Nintendo Switch Lite AMBA',
      category: 'PRODUCT',
    },
    manualExchangeRate: 1400,
    sources: [
      {
        sourceRunId: 'sr-synth-1',
        sourceId: 'synthetic',
        collectorId: 'collector-synthetic',
        adapterVersion: '1.2.3',
        status: 'SUCCESS',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:04:00.000Z',
        itemsCount: 1,
        metrics: {
          pagesRequested: 5,
          pagesCompleted: 3,
          rawItemsCount: 10,
          parsedItemsCount: 8,
          rejectedItemsCount: 2,
          stopReason: 'ALL_PAGES_FETCHED',
        },
        error: null,
      },
      {
        sourceRunId: 'sr-failed-2',
        sourceId: 'failed_source',
        collectorId: null,
        adapterVersion: '2.0.0',
        status: 'NETWORK_ERROR',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:01:00.000Z',
        itemsCount: null,
        metrics: null,
        error: {
          code: 'ETIMEDOUT',
          message: 'Connection timed out',
        },
      },
    ],
    results: [
      {
        listingId: 'listing-parity-1',
        observationId: 'obs-parity-1',
        sourceRunId: 'sr-synth-1',
        sourceId: 'synthetic',
        externalId: 'ext-999',
        canonicalUrl: 'https://example.com/item/999',
        observedAt: '2026-08-30T10:02:00.000Z',
        publishedAt: '2026-08-30T09:30:00.000Z',
        title: 'Nintendo Switch Lite Azul con juego',
        description: 'Impecable estado general',
        condition: 'LIKE_NEW',
        availability: 'AVAILABLE',
        imageUrls: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
        rawFingerprint: 'fp-parity-1',
        price: {
          rawText: '$ 175.000',
          amount: 175000,
          currency: 'ARS',
          resolution: 'EXPLICIT',
          confidence: 0.98,
          evidence: ['price_badge', 'ocr_text'],
          kind: 'TOTAL',
          converted: {
            amount: 175000,
            currency: 'ARS',
            exchangeRate: 1400,
            exchangeRateOrigin: 'MANUAL',
            convertedAt: '2026-08-30T10:02:30.000Z',
          },
        },
        location: {
          rawText: 'Belgrano, CABA',
          region: 'CABA',
          city: 'Buenos Aires',
          neighborhood: 'Belgrano',
          latitude: -34.5627,
          longitude: -58.4563,
        },
        novelty: 'NEW',
        evaluation: {
          decision: 'MATCH',
          score: 92,
          reasons: [
            {
              code: 'PRICE_WITHIN_BUDGET',
              message: 'Target price met',
              impact: 25,
              severity: 'INFO',
            },
          ],
          evaluatedBy: ['RULES', 'AI'],
          policyVersion: '1.0.0',
          createdAt: '2026-08-30T10:03:00.000Z',
        },
      },
    ],
  };
}

describe('Run Export Cross-Format Semantic Parity (BOAI-014)', () => {
  it('preserves 1:1 factual semantic parity between JSON and CSV exports across all 65 columns', () => {
    const fixture = createCompleteSnapshot();

    const jsonStr = serializeJson(fixture);
    const csvStr = serializeCsv(fixture);

    const json = JSON.parse(jsonStr) as RunExportSnapshot;
    const csv = parseCsvRfc4180(csvStr);

    expect(CSV_COLUMNS).toHaveLength(65);
    expect(csv.headers).toEqual([...CSV_COLUMNS]);

    const colIndex = (name: (typeof CSV_COLUMNS)[number]) => {
      const idx = CSV_COLUMNS.indexOf(name);
      if (idx === -1) throw new Error(`Unknown column ${name}`);
      return idx;
    };

    // 1. Run Header & Search Parity
    const runRow = csv.rows.find((r) => r[colIndex('record_type')] === 'RUN')!;
    expect(runRow).toBeDefined();

    expect(runRow[colIndex('schema_version')]).toBe(String(json.schemaVersion));
    expect(runRow[colIndex('run_id')]).toBe(json.run.id);
    expect(runRow[colIndex('saved_search_id')]).toBe(json.run.savedSearchId);
    expect(runRow[colIndex('search_revision_number')]).toBe(String(json.search.revisionNumber));
    expect(runRow[colIndex('search_schema_version')]).toBe(String(json.search.schemaVersion));
    expect(runRow[colIndex('search_name')]).toBe(json.search.name);
    expect(runRow[colIndex('search_category')]).toBe(json.search.category);
    expect(runRow[colIndex('run_status')]).toBe(json.run.status);
    expect(runRow[colIndex('run_started_at')]).toBe(json.run.startedAt);
    expect(runRow[colIndex('run_finished_at')]).toBe(json.run.finishedAt);
    expect(runRow[colIndex('run_error_code')]).toBe(json.run.error?.code ?? '');
    expect(runRow[colIndex('run_error_message')]).toBe(json.run.error?.message ?? '');
    expect(runRow[colIndex('manual_exchange_rate')]).toBe(String(json.manualExchangeRate));

    // Columns 15 to 65 must be empty in RUN row
    for (let c = 14; c < 65; c++) {
      expect(runRow[c]).toBe('');
    }

    // 2. Sources Parity
    const sourceRows = csv.rows.filter((r) => r[colIndex('record_type')] === 'SOURCE');
    expect(sourceRows.length).toBe(json.sources.length);

    for (let i = 0; i < json.sources.length; i++) {
      const jSrc = json.sources[i]!;
      const cSrc = sourceRows[i]!;

      // Run and search fields in source row
      expect(cSrc[colIndex('run_id')]).toBe(json.run.id);
      expect(cSrc[colIndex('saved_search_id')]).toBe(json.run.savedSearchId);
      expect(cSrc[colIndex('search_revision_number')]).toBe(String(json.search.revisionNumber));
      expect(cSrc[colIndex('search_name')]).toBe(json.search.name);
      expect(cSrc[colIndex('search_category')]).toBe(json.search.category);
      expect(cSrc[colIndex('manual_exchange_rate')]).toBe(String(json.manualExchangeRate));

      // Source fields
      expect(cSrc[colIndex('source_run_id')]).toBe(jSrc.sourceRunId);
      expect(cSrc[colIndex('source_id')]).toBe(jSrc.sourceId);
      expect(cSrc[colIndex('collector_id')]).toBe(jSrc.collectorId ?? '');
      expect(cSrc[colIndex('adapter_version')]).toBe(jSrc.adapterVersion);
      expect(cSrc[colIndex('source_items_count')]).toBe(
        jSrc.itemsCount !== null ? String(jSrc.itemsCount) : '',
      );
      expect(cSrc[colIndex('source_error_code')]).toBe(jSrc.error?.code ?? '');
      expect(cSrc[colIndex('source_error_message')]).toBe(jSrc.error?.message ?? '');

      // Source metrics fields
      expect(cSrc[colIndex('source_pages_requested')]).toBe(
        jSrc.metrics?.pagesRequested !== null && jSrc.metrics?.pagesRequested !== undefined
          ? String(jSrc.metrics.pagesRequested)
          : '',
      );
      expect(cSrc[colIndex('source_pages_completed')]).toBe(
        jSrc.metrics?.pagesCompleted !== null && jSrc.metrics?.pagesCompleted !== undefined
          ? String(jSrc.metrics.pagesCompleted)
          : '',
      );
      expect(cSrc[colIndex('source_raw_items_count')]).toBe(
        jSrc.metrics?.rawItemsCount !== null && jSrc.metrics?.rawItemsCount !== undefined
          ? String(jSrc.metrics.rawItemsCount)
          : '',
      );
      expect(cSrc[colIndex('source_parsed_items_count')]).toBe(
        jSrc.metrics?.parsedItemsCount !== null && jSrc.metrics?.parsedItemsCount !== undefined
          ? String(jSrc.metrics.parsedItemsCount)
          : '',
      );
      expect(cSrc[colIndex('source_rejected_items_count')]).toBe(
        jSrc.metrics?.rejectedItemsCount !== null && jSrc.metrics?.rejectedItemsCount !== undefined
          ? String(jSrc.metrics.rejectedItemsCount)
          : '',
      );
      expect(cSrc[colIndex('source_stop_reason')]).toBe(jSrc.metrics?.stopReason ?? '');

      // Result fields (columns 28 to 64) must be empty in SOURCE row
      for (let c = 28; c < 65; c++) {
        expect(cSrc[c]).toBe('');
      }
    }

    // 3. Results Parity
    const resultRows = csv.rows.filter((r) => r[colIndex('record_type')] === 'RESULT');
    expect(resultRows.length).toBe(json.results.length);

    for (let i = 0; i < json.results.length; i++) {
      const jRes = json.results[i]!;
      const cRes = resultRows[i]!;

      // Run and search fields in result row
      expect(cRes[colIndex('run_id')]).toBe(json.run.id);
      expect(cRes[colIndex('saved_search_id')]).toBe(json.run.savedSearchId);
      expect(cRes[colIndex('search_revision_number')]).toBe(String(json.search.revisionNumber));
      expect(cRes[colIndex('search_name')]).toBe(json.search.name);
      expect(cRes[colIndex('search_category')]).toBe(json.search.category);
      expect(cRes[colIndex('manual_exchange_rate')]).toBe(String(json.manualExchangeRate));

      // Source linkage
      expect(cRes[colIndex('source_run_id')]).toBe(jRes.sourceRunId);
      expect(cRes[colIndex('source_id')]).toBe(jRes.sourceId);

      // Source specific fields (columns 16 to 27) must be empty in RESULT row
      for (let c = 16; c <= 27; c++) {
        expect(cRes[c]).toBe('');
      }

      // Result identity & metadata
      expect(cRes[colIndex('listing_id')]).toBe(jRes.listingId);
      expect(cRes[colIndex('external_id')]).toBe(jRes.externalId);
      expect(cRes[colIndex('canonical_url')]).toBe(jRes.canonicalUrl);
      expect(cRes[colIndex('observation_id')]).toBe(jRes.observationId);
      expect(cRes[colIndex('observed_at')]).toBe(jRes.observedAt);
      expect(cRes[colIndex('published_at')]).toBe(jRes.publishedAt ?? '');
      expect(cRes[colIndex('title')]).toBe(jRes.title);
      expect(cRes[colIndex('description')]).toBe(jRes.description ?? '');
      expect(cRes[colIndex('condition')]).toBe(jRes.condition ?? '');
      expect(cRes[colIndex('availability')]).toBe(jRes.availability);
      expect(cRes[colIndex('raw_fingerprint')]).toBe(jRes.rawFingerprint);

      // Price & Converted Price
      expect(cRes[colIndex('price_raw_text')]).toBe(jRes.price?.rawText ?? '');
      expect(cRes[colIndex('price_amount')]).toBe(String(jRes.price?.amount ?? ''));
      expect(cRes[colIndex('price_currency')]).toBe(jRes.price?.currency ?? '');
      expect(cRes[colIndex('price_resolution')]).toBe(jRes.price?.resolution ?? '');
      expect(cRes[colIndex('price_kind')]).toBe(jRes.price?.kind ?? '');
      expect(cRes[colIndex('price_confidence')]).toBe(String(jRes.price?.confidence ?? ''));
      expect(JSON.parse(cRes[colIndex('price_evidence_json')]!)).toEqual(jRes.price?.evidence);
      expect(cRes[colIndex('converted_amount')]).toBe(String(jRes.price?.converted?.amount ?? ''));
      expect(cRes[colIndex('converted_currency')]).toBe(jRes.price?.converted?.currency ?? '');
      expect(cRes[colIndex('exchange_rate')]).toBe(
        String(jRes.price?.converted?.exchangeRate ?? ''),
      );
      expect(cRes[colIndex('exchange_rate_origin')]).toBe(
        jRes.price?.converted?.exchangeRateOrigin ?? '',
      );
      expect(cRes[colIndex('converted_at')]).toBe(jRes.price?.converted?.convertedAt ?? '');

      // Location
      expect(cRes[colIndex('location_raw_text')]).toBe(jRes.location?.rawText ?? '');
      expect(cRes[colIndex('location_region')]).toBe(jRes.location?.region ?? '');
      expect(cRes[colIndex('location_city')]).toBe(jRes.location?.city ?? '');
      expect(cRes[colIndex('location_neighborhood')]).toBe(jRes.location?.neighborhood ?? '');
      expect(cRes[colIndex('location_latitude')]).toBe(String(jRes.location?.latitude ?? ''));
      expect(cRes[colIndex('location_longitude')]).toBe(String(jRes.location?.longitude ?? ''));

      // Novelty
      expect(cRes[colIndex('novelty')]).toBe(jRes.novelty ?? '');

      // Evaluation
      expect(cRes[colIndex('decision')]).toBe(jRes.evaluation?.decision ?? '');
      expect(cRes[colIndex('score')]).toBe(String(jRes.evaluation?.score ?? ''));
      expect(JSON.parse(cRes[colIndex('reasons_json')]!)).toEqual(jRes.evaluation?.reasons);
      expect(JSON.parse(cRes[colIndex('evaluated_by_json')]!)).toEqual(
        jRes.evaluation?.evaluatedBy,
      );
      expect(cRes[colIndex('policy_version')]).toBe(jRes.evaluation?.policyVersion ?? '');
      expect(cRes[colIndex('evaluation_created_at')]).toBe(jRes.evaluation?.createdAt ?? '');

      // Images
      expect(JSON.parse(cRes[colIndex('image_urls_json')]!)).toEqual(jRes.imageUrls);
    }
  });

  it('preserves 1:1 factual parity for run error code and message on FAILED runs', () => {
    const fixture: RunExportSnapshot = {
      ...createCompleteSnapshot(),
      run: {
        id: 'run-failed-parity',
        savedSearchId: 'search-lite-amba',
        status: 'FAILED',
        startedAt: '2026-08-30T10:00:00.000Z',
        finishedAt: '2026-08-30T10:02:00.000Z',
        error: {
          code: 'ERR_ALL_SOURCES_DEAD',
          message: 'All configured sources failed',
        },
      },
    };

    const jsonStr = serializeJson(fixture);
    const csvStr = serializeCsv(fixture);

    const json = JSON.parse(jsonStr) as RunExportSnapshot;
    const csv = parseCsvRfc4180(csvStr);

    const colIndex = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    const runRow = csv.rows.find((r) => r[colIndex('record_type')] === 'RUN')!;

    expect(runRow[colIndex('run_status')]).toBe('FAILED');
    expect(runRow[colIndex('run_error_code')]).toBe('ERR_ALL_SOURCES_DEAD');
    expect(runRow[colIndex('run_error_message')]).toBe('All configured sources failed');
    expect(json.run.error?.code).toBe('ERR_ALL_SOURCES_DEAD');
    expect(json.run.error?.message).toBe('All configured sources failed');
  });
});
