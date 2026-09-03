import { sanitizeSpreadsheetFormula } from './csv-safety.js';
import { type RunExportSnapshot } from './schema.js';
import { sortResults, sortSources } from './sort.js';
import { validateRunExportSnapshot } from './validation.js';

export const CSV_COLUMNS = [
  'schema_version',
  'record_type',
  'run_id',
  'saved_search_id',
  'search_revision_number',
  'search_schema_version',
  'search_name',
  'search_category',
  'run_status',
  'run_started_at',
  'run_finished_at',
  'run_error_code',
  'run_error_message',
  'manual_exchange_rate',
  'source_run_id',
  'source_id',
  'collector_id',
  'adapter_version',
  'source_status',
  'source_items_count',
  'source_error_code',
  'source_error_message',
  'source_pages_requested',
  'source_pages_completed',
  'source_raw_items_count',
  'source_parsed_items_count',
  'source_rejected_items_count',
  'source_stop_reason',
  'listing_id',
  'external_id',
  'canonical_url',
  'observation_id',
  'observed_at',
  'published_at',
  'title',
  'description',
  'condition',
  'availability',
  'raw_fingerprint',
  'price_raw_text',
  'price_amount',
  'price_currency',
  'price_resolution',
  'price_kind',
  'price_confidence',
  'price_evidence_json',
  'converted_amount',
  'converted_currency',
  'exchange_rate',
  'exchange_rate_origin',
  'converted_at',
  'location_raw_text',
  'location_region',
  'location_city',
  'location_neighborhood',
  'location_latitude',
  'location_longitude',
  'novelty',
  'decision',
  'score',
  'reasons_json',
  'evaluated_by_json',
  'policy_version',
  'evaluation_created_at',
  'image_urls_json',
] as const;

export const CSV_COLUMN_COUNT = CSV_COLUMNS.length; // 65

export const CSV_ROW_DELIMITER = '\r\n' as const;

type CellValue = string | number | null | undefined;

interface CellDefinition {
  readonly value: CellValue;
  readonly isNumeric?: boolean;
}

function formatCsvCell(cell: CellDefinition): string {
  const { value, isNumeric } = cell;
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  let text = String(value);

  // Apply spreadsheet formula injection neutralization strictly to non-numeric textual fields
  if (!isNumeric) {
    text = sanitizeSpreadsheetFormula(text);
  }

  // RFC-4180 Quoting:
  // If text contains comma, quote, CRLF or starts with single quote (from formula neutralization), quote it.
  const needsQuote =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\r') ||
    text.includes('\n') ||
    text.startsWith("'");

  if (needsQuote) {
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return text;
}

function buildCsvRow(cells: readonly CellDefinition[]): string {
  return cells.map(formatCsvCell).join(',');
}

export function serializeCsv(snapshot: RunExportSnapshot): string {
  validateRunExportSnapshot(snapshot);

  const rows: string[] = [];

  // Header row
  rows.push(CSV_COLUMNS.join(','));

  const run = snapshot.run;
  const search = snapshot.search;
  const manualFx = snapshot.manualExchangeRate;

  // 1. RUN row (columns 1-14 populated, remaining 51 empty)
  const runRowCells: CellDefinition[] = [
    { value: snapshot.schemaVersion, isNumeric: true },
    { value: 'RUN' },
    { value: run.id },
    { value: search.savedSearchId },
    { value: search.revisionNumber, isNumeric: true },
    { value: search.schemaVersion, isNumeric: true },
    { value: search.name },
    { value: search.category },
    { value: run.status },
    { value: run.startedAt },
    { value: run.finishedAt },
    { value: run.error?.code ?? null },
    { value: run.error?.message ?? null },
    { value: manualFx, isNumeric: true },
    // Remaining 51 columns are empty
    ...Array.from({ length: 51 }, (): CellDefinition => ({ value: null })),
  ];
  rows.push(buildCsvRow(runRowCells));

  // 2. SOURCE rows (ordered by sourceId ASC, sourceRunId ASC)
  // Columns 1-14: run & search; Columns 15-28: source & metrics; Remaining 37 columns: empty
  const sortedSources = sortSources(snapshot.sources);
  for (const src of sortedSources) {
    const sourceRowCells: CellDefinition[] = [
      { value: snapshot.schemaVersion, isNumeric: true },
      { value: 'SOURCE' },
      { value: run.id },
      { value: search.savedSearchId },
      { value: search.revisionNumber, isNumeric: true },
      { value: search.schemaVersion, isNumeric: true },
      { value: search.name },
      { value: search.category },
      { value: run.status },
      { value: run.startedAt },
      { value: run.finishedAt },
      { value: run.error?.code ?? null },
      { value: run.error?.message ?? null },
      { value: manualFx, isNumeric: true },
      { value: src.sourceRunId },
      { value: src.sourceId },
      { value: src.collectorId },
      { value: src.adapterVersion },
      { value: src.status },
      { value: src.itemsCount, isNumeric: true },
      { value: src.error?.code ?? null },
      { value: src.error?.message ?? null },
      { value: src.metrics?.pagesRequested ?? null, isNumeric: true },
      { value: src.metrics?.pagesCompleted ?? null, isNumeric: true },
      { value: src.metrics?.rawItemsCount ?? null, isNumeric: true },
      { value: src.metrics?.parsedItemsCount ?? null, isNumeric: true },
      { value: src.metrics?.rejectedItemsCount ?? null, isNumeric: true },
      { value: src.metrics?.stopReason ?? null },
      // Remaining 37 result columns are empty
      ...Array.from({ length: 37 }, (): CellDefinition => ({ value: null })),
    ];
    rows.push(buildCsvRow(sourceRowCells));
  }

  // 3. RESULT rows (ordered by sourceId ASC, listingId ASC, observedAt ASC, observationId ASC)
  // Columns 1-14: run & search; Columns 15-16: source run/id; Columns 17-28: 12 empty source fields; Columns 29-65: 37 result fields
  const sortedResults = sortResults(snapshot.results);
  for (const res of sortedResults) {
    const resultRowCells: CellDefinition[] = [
      { value: snapshot.schemaVersion, isNumeric: true },
      { value: 'RESULT' },
      { value: run.id },
      { value: search.savedSearchId },
      { value: search.revisionNumber, isNumeric: true },
      { value: search.schemaVersion, isNumeric: true },
      { value: search.name },
      { value: search.category },
      { value: run.status },
      { value: run.startedAt },
      { value: run.finishedAt },
      { value: run.error?.code ?? null },
      { value: run.error?.message ?? null },
      { value: manualFx, isNumeric: true },
      { value: res.sourceRunId },
      { value: res.sourceId },
      // 12 empty source fields (collector_id through source_stop_reason)
      ...Array.from({ length: 12 }, (): CellDefinition => ({ value: null })),
      // 37 result fields
      { value: res.listingId },
      { value: res.externalId },
      { value: res.canonicalUrl },
      { value: res.observationId },
      { value: res.observedAt },
      { value: res.publishedAt },
      { value: res.title },
      { value: res.description },
      { value: res.condition },
      { value: res.availability },
      { value: res.rawFingerprint },
      { value: res.price?.rawText ?? null },
      { value: res.price?.amount ?? null, isNumeric: true },
      { value: res.price?.currency ?? null },
      { value: res.price?.resolution ?? null },
      { value: res.price?.kind ?? null },
      { value: res.price?.confidence ?? null, isNumeric: true },
      {
        value:
          res.price?.evidence && res.price.evidence.length > 0
            ? JSON.stringify(res.price.evidence)
            : null,
      },
      { value: res.price?.converted?.amount ?? null, isNumeric: true },
      { value: res.price?.converted?.currency ?? null },
      { value: res.price?.converted?.exchangeRate ?? null, isNumeric: true },
      { value: res.price?.converted?.exchangeRateOrigin ?? null },
      { value: res.price?.converted?.convertedAt ?? null },
      { value: res.location?.rawText ?? null },
      { value: res.location?.region ?? null },
      { value: res.location?.city ?? null },
      { value: res.location?.neighborhood ?? null },
      { value: res.location?.latitude ?? null, isNumeric: true },
      { value: res.location?.longitude ?? null, isNumeric: true },
      { value: res.novelty ?? null },
      { value: res.evaluation?.decision ?? null },
      { value: res.evaluation?.score ?? null, isNumeric: true },
      {
        value:
          res.evaluation?.reasons && res.evaluation.reasons.length > 0
            ? JSON.stringify(res.evaluation.reasons)
            : null,
      },
      {
        value:
          res.evaluation?.evaluatedBy && res.evaluation.evaluatedBy.length > 0
            ? JSON.stringify(res.evaluation.evaluatedBy)
            : null,
      },
      { value: res.evaluation?.policyVersion ?? null },
      { value: res.evaluation?.createdAt ?? null },
      { value: res.imageUrls && res.imageUrls.length > 0 ? JSON.stringify(res.imageUrls) : '[]' },
    ];
    rows.push(buildCsvRow(resultRowCells));
  }

  return rows.join(CSV_ROW_DELIMITER) + CSV_ROW_DELIMITER;
}
