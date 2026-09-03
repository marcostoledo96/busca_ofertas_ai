import { RunExportValidationError } from './errors.js';
import {
  RUN_EXPORT_SCHEMA_VERSION,
  type RunExportSnapshot,
  type RunExportSearchCategory,
  type RunExportRunStatus,
  type RunExportSourceStatus,
  type RunExportSourceStopReason,
  type RunExportListingCondition,
  type RunExportAvailability,
  type RunExportPriceCurrency,
  type RunExportPriceResolution,
  type RunExportItemNovelty,
  type RunExportEvaluationDecision,
  type RunExportEvaluationSeverity,
  type RunExportEvaluatorType,
  type RunExportPriceKind,
} from './schema.js';

const CANONICAL_ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const VALID_SEARCH_CATEGORIES: ReadonlySet<RunExportSearchCategory> = new Set([
  'PRODUCT',
  'REAL_ESTATE',
  'VEHICLE',
]);

const VALID_RUN_STATUSES: ReadonlySet<RunExportRunStatus> = new Set([
  'CREATED',
  'RUNNING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'CANCELLED',
]);

const VALID_SOURCE_STATUSES: ReadonlySet<RunExportSourceStatus> = new Set([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'ZERO_RESULTS_CONFIRMED',
  'AUTHENTICATION_REQUIRED',
  'MANUAL_INTERVENTION_REQUIRED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'SOURCE_UNAVAILABLE',
  'CONTRACT_CHANGED',
  'PARSER_FAILED',
  'TIMEOUT',
  'CONFIGURATION_UNSUPPORTED',
  'CANCELLED',
]);

const VALID_STOP_REASONS: ReadonlySet<RunExportSourceStopReason> = new Set([
  'ALL_PAGES_FETCHED',
  'MAX_PAGES_REACHED',
  'MAX_ITEMS_REACHED',
  'NO_MORE_RESULTS',
  'RATE_LIMIT_STOP',
  'USER_ABORTED',
  'DEADLINE_EXCEEDED',
]);

const VALID_CONDITIONS: ReadonlySet<RunExportListingCondition> = new Set([
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
  'UNKNOWN',
]);

const VALID_AVAILABILITIES: ReadonlySet<RunExportAvailability> = new Set([
  'AVAILABLE',
  'PENDING',
  'SOLD',
  'REMOVED',
  'UNKNOWN',
]);

const VALID_CURRENCIES: ReadonlySet<RunExportPriceCurrency> = new Set(['ARS', 'USD', 'UNKNOWN']);

const VALID_RESOLUTIONS: ReadonlySet<RunExportPriceResolution> = new Set([
  'EXPLICIT',
  'SOURCE_METADATA',
  'TEXT_INFERENCE',
  'AMBIGUOUS',
]);

const VALID_PRICE_KINDS: ReadonlySet<RunExportPriceKind> = new Set([
  'TOTAL',
  'DEPOSIT',
  'INSTALLMENT',
  'FROM_PRICE',
  'UNKNOWN',
]);

const VALID_NOVELTIES: ReadonlySet<RunExportItemNovelty> = new Set([
  'NEW',
  'UNCHANGED',
  'PRICE_CHANGED',
  'REAPPEARED',
]);

const VALID_DECISIONS: ReadonlySet<RunExportEvaluationDecision> = new Set([
  'MATCH',
  'REVIEW',
  'REJECT',
]);

const VALID_SEVERITIES: ReadonlySet<RunExportEvaluationSeverity> = new Set([
  'INFO',
  'SOFT',
  'HARD',
]);

const VALID_EVALUATORS: ReadonlySet<RunExportEvaluatorType> = new Set(['RULES', 'AI', 'USER']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireOwnProperty(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) {
    throw new RunExportValidationError(`Missing required property '${key}' at '${path}'`, path);
  }
  return record[key];
}

function validateNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RunExportValidationError(
      `Expected non-empty string at '${path}', got ${JSON.stringify(value)}`,
      path,
    );
  }
  return value;
}

function validateCanonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== 'string' || !CANONICAL_ISO_UTC_REGEX.test(value)) {
    throw new RunExportValidationError(
      `Expected canonical ISO UTC timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ' at '${path}', got ${JSON.stringify(value)}`,
      path,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new RunExportValidationError(
      `Timestamp at '${path}' does not round-trip canonically: '${value}'`,
      path,
    );
  }
  return value;
}

function validateNullableCanonicalTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  return validateCanonicalTimestamp(value, path);
}

function validateInteger(value: unknown, path: string, min = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < min
  ) {
    throw new RunExportValidationError(
      `Expected finite integer >= ${min} at '${path}', got ${JSON.stringify(value)}`,
      path,
    );
  }
  return value;
}

function validateFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RunExportValidationError(
      `Expected finite number at '${path}', got ${JSON.stringify(value)}`,
      path,
    );
  }
  return value;
}

export function validateRunExportSnapshot(
  snapshot: unknown,
): asserts snapshot is RunExportSnapshot {
  if (!isRecord(snapshot)) {
    throw new RunExportValidationError('Root export snapshot must be an object', '$');
  }

  // 1. schemaVersion
  const schemaVersion = requireOwnProperty(snapshot, 'schemaVersion', '$.schemaVersion');
  if (schemaVersion !== RUN_EXPORT_SCHEMA_VERSION) {
    throw new RunExportValidationError(
      `Expected schemaVersion ${RUN_EXPORT_SCHEMA_VERSION}, got ${JSON.stringify(schemaVersion)}`,
      '$.schemaVersion',
    );
  }

  // 2. run
  const run = requireOwnProperty(snapshot, 'run', '$.run');
  if (!isRecord(run)) {
    throw new RunExportValidationError("Field 'run' must be an object", '$.run');
  }
  validateNonEmptyString(requireOwnProperty(run, 'id', '$.run.id'), '$.run.id');
  const runSavedSearchId = validateNonEmptyString(
    requireOwnProperty(run, 'savedSearchId', '$.run.savedSearchId'),
    '$.run.savedSearchId',
  );
  const runStatus = requireOwnProperty(run, 'status', '$.run.status');
  if (typeof runStatus !== 'string' || !VALID_RUN_STATUSES.has(runStatus as RunExportRunStatus)) {
    throw new RunExportValidationError(
      `Invalid run status at '$.run.status': ${JSON.stringify(runStatus)}`,
      '$.run.status',
    );
  }
  validateCanonicalTimestamp(
    requireOwnProperty(run, 'startedAt', '$.run.startedAt'),
    '$.run.startedAt',
  );
  const runFinishedAt = requireOwnProperty(run, 'finishedAt', '$.run.finishedAt');
  validateNullableCanonicalTimestamp(runFinishedAt, '$.run.finishedAt');

  const runError = requireOwnProperty(run, 'error', '$.run.error');
  if (runError !== null) {
    if (!isRecord(runError)) {
      throw new RunExportValidationError(
        "Field 'run.error' must be null or an object",
        '$.run.error',
      );
    }
    const errCode = requireOwnProperty(runError, 'code', '$.run.error.code');
    if (errCode !== null && typeof errCode !== 'string') {
      throw new RunExportValidationError(
        "Field 'run.error.code' must be string or null",
        '$.run.error.code',
      );
    }
    const errMsg = requireOwnProperty(runError, 'message', '$.run.error.message');
    if (errMsg !== null && typeof errMsg !== 'string') {
      throw new RunExportValidationError(
        "Field 'run.error.message' must be string or null",
        '$.run.error.message',
      );
    }
  }

  // 3. search
  const search = requireOwnProperty(snapshot, 'search', '$.search');
  if (!isRecord(search)) {
    throw new RunExportValidationError("Field 'search' must be an object", '$.search');
  }
  const searchSavedSearchId = validateNonEmptyString(
    requireOwnProperty(search, 'savedSearchId', '$.search.savedSearchId'),
    '$.search.savedSearchId',
  );
  if (runSavedSearchId !== searchSavedSearchId) {
    throw new RunExportValidationError(
      `search.savedSearchId '${searchSavedSearchId}' does not match run.savedSearchId '${runSavedSearchId}'`,
      '$.search.savedSearchId',
    );
  }
  validateInteger(
    requireOwnProperty(search, 'revisionNumber', '$.search.revisionNumber'),
    '$.search.revisionNumber',
    1,
  );
  validateInteger(
    requireOwnProperty(search, 'schemaVersion', '$.search.schemaVersion'),
    '$.search.schemaVersion',
    1,
  );
  validateNonEmptyString(requireOwnProperty(search, 'name', '$.search.name'), '$.search.name');
  const cat = requireOwnProperty(search, 'category', '$.search.category');
  if (typeof cat !== 'string' || !VALID_SEARCH_CATEGORIES.has(cat as RunExportSearchCategory)) {
    throw new RunExportValidationError(
      `Invalid search category at '$.search.category': ${JSON.stringify(cat)}`,
      '$.search.category',
    );
  }

  // 4. manualExchangeRate
  const manualFx = requireOwnProperty(snapshot, 'manualExchangeRate', '$.manualExchangeRate');
  if (manualFx !== null) {
    const fxNum = validateFiniteNumber(manualFx, '$.manualExchangeRate');
    if (fxNum <= 0) {
      throw new RunExportValidationError(
        `manualExchangeRate must be positive, got ${fxNum}`,
        '$.manualExchangeRate',
      );
    }
  }

  // 5. sources
  const rawSources = requireOwnProperty(snapshot, 'sources', '$.sources');
  if (!Array.isArray(rawSources)) {
    throw new RunExportValidationError("Field 'sources' must be an array", '$.sources');
  }
  const sources: readonly unknown[] = rawSources;

  const seenSourceRunIds = new Set<string>();
  const sourceMap = new Map<string, { sourceId: string }>();

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const path = `$.sources[${i}]`;
    if (!isRecord(src)) {
      throw new RunExportValidationError(`Source at '${path}' must be an object`, path);
    }
    const srId = validateNonEmptyString(
      requireOwnProperty(src, 'sourceRunId', `${path}.sourceRunId`),
      `${path}.sourceRunId`,
    );
    if (seenSourceRunIds.has(srId)) {
      throw new RunExportValidationError(
        `Duplicate sourceRunId '${srId}' at '${path}.sourceRunId'`,
        `${path}.sourceRunId`,
      );
    }
    seenSourceRunIds.add(srId);

    const sId = validateNonEmptyString(
      requireOwnProperty(src, 'sourceId', `${path}.sourceId`),
      `${path}.sourceId`,
    );
    sourceMap.set(srId, { sourceId: sId });

    const collectorId = requireOwnProperty(src, 'collectorId', `${path}.collectorId`);
    if (collectorId !== null && typeof collectorId !== 'string') {
      throw new RunExportValidationError(
        `collectorId at '${path}.collectorId' must be string or null`,
        `${path}.collectorId`,
      );
    }

    validateNonEmptyString(
      requireOwnProperty(src, 'adapterVersion', `${path}.adapterVersion`),
      `${path}.adapterVersion`,
    );

    const srcStatus = requireOwnProperty(src, 'status', `${path}.status`);
    if (
      typeof srcStatus !== 'string' ||
      !VALID_SOURCE_STATUSES.has(srcStatus as RunExportSourceStatus)
    ) {
      throw new RunExportValidationError(
        `Invalid source status at '${path}.status': ${JSON.stringify(srcStatus)}`,
        `${path}.status`,
      );
    }

    validateCanonicalTimestamp(
      requireOwnProperty(src, 'startedAt', `${path}.startedAt`),
      `${path}.startedAt`,
    );
    const srcFinishedAt = requireOwnProperty(src, 'finishedAt', `${path}.finishedAt`);
    validateNullableCanonicalTimestamp(srcFinishedAt, `${path}.finishedAt`);

    const itemsCount = requireOwnProperty(src, 'itemsCount', `${path}.itemsCount`);
    if (itemsCount !== null) {
      validateInteger(itemsCount, `${path}.itemsCount`, 0);
    }

    const srcMetrics = requireOwnProperty(src, 'metrics', `${path}.metrics`);
    if (srcMetrics !== null) {
      if (!isRecord(srcMetrics)) {
        throw new RunExportValidationError(
          `metrics at '${path}.metrics' must be object or null`,
          `${path}.metrics`,
        );
      }
      const countFields = [
        'pagesRequested',
        'pagesCompleted',
        'rawItemsCount',
        'parsedItemsCount',
        'rejectedItemsCount',
      ] as const;
      for (const field of countFields) {
        const val = requireOwnProperty(srcMetrics, field, `${path}.metrics.${field}`);
        if (val !== null) {
          validateInteger(val, `${path}.metrics.${field}`, 0);
        }
      }
      const stopReason = requireOwnProperty(srcMetrics, 'stopReason', `${path}.metrics.stopReason`);
      if (
        stopReason !== null &&
        (typeof stopReason !== 'string' ||
          !VALID_STOP_REASONS.has(stopReason as RunExportSourceStopReason))
      ) {
        throw new RunExportValidationError(
          `Invalid stopReason at '${path}.metrics.stopReason': ${JSON.stringify(stopReason)}`,
          `${path}.metrics.stopReason`,
        );
      }
    }

    const srcError = requireOwnProperty(src, 'error', `${path}.error`);
    if (srcError !== null) {
      if (!isRecord(srcError)) {
        throw new RunExportValidationError(
          `error at '${path}.error' must be object or null`,
          `${path}.error`,
        );
      }
      const code = requireOwnProperty(srcError, 'code', `${path}.error.code`);
      if (code !== null && typeof code !== 'string') {
        throw new RunExportValidationError(
          `error.code at '${path}.error.code' must be string or null`,
          `${path}.error.code`,
        );
      }
      const msg = requireOwnProperty(srcError, 'message', `${path}.error.message`);
      if (msg !== null && typeof msg !== 'string') {
        throw new RunExportValidationError(
          `error.message at '${path}.error.message' must be string or null`,
          `${path}.error.message`,
        );
      }
    }
  }

  // 6. results
  const rawResults = requireOwnProperty(snapshot, 'results', '$.results');
  if (!Array.isArray(rawResults)) {
    throw new RunExportValidationError("Field 'results' must be an array", '$.results');
  }
  const results: readonly unknown[] = rawResults;

  const seenObsIds = new Set<string>();

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const path = `$.results[${i}]`;
    if (!isRecord(res)) {
      throw new RunExportValidationError(`Result at '${path}' must be an object`, path);
    }

    validateNonEmptyString(
      requireOwnProperty(res, 'listingId', `${path}.listingId`),
      `${path}.listingId`,
    );
    const obsId = validateNonEmptyString(
      requireOwnProperty(res, 'observationId', `${path}.observationId`),
      `${path}.observationId`,
    );
    if (seenObsIds.has(obsId)) {
      throw new RunExportValidationError(
        `Duplicate observationId '${obsId}' at '${path}.observationId'`,
        `${path}.observationId`,
      );
    }
    seenObsIds.add(obsId);

    const srId = validateNonEmptyString(
      requireOwnProperty(res, 'sourceRunId', `${path}.sourceRunId`),
      `${path}.sourceRunId`,
    );
    const sId = validateNonEmptyString(
      requireOwnProperty(res, 'sourceId', `${path}.sourceId`),
      `${path}.sourceId`,
    );

    // Coherence: result.sourceRunId must exist in sources, and sourceId must match
    const knownSource = sourceMap.get(srId);
    if (!knownSource) {
      throw new RunExportValidationError(
        `Result sourceRunId '${srId}' at '${path}.sourceRunId' does not exist in snapshot sources`,
        `${path}.sourceRunId`,
      );
    }
    if (knownSource.sourceId !== sId) {
      throw new RunExportValidationError(
        `Result sourceId '${sId}' at '${path}.sourceId' does not match source '${knownSource.sourceId}' declared in sourceRun '${srId}'`,
        `${path}.sourceId`,
      );
    }

    validateNonEmptyString(
      requireOwnProperty(res, 'externalId', `${path}.externalId`),
      `${path}.externalId`,
    );
    validateNonEmptyString(
      requireOwnProperty(res, 'canonicalUrl', `${path}.canonicalUrl`),
      `${path}.canonicalUrl`,
    );
    validateCanonicalTimestamp(
      requireOwnProperty(res, 'observedAt', `${path}.observedAt`),
      `${path}.observedAt`,
    );
    const pubAt = requireOwnProperty(res, 'publishedAt', `${path}.publishedAt`);
    validateNullableCanonicalTimestamp(pubAt, `${path}.publishedAt`);
    validateNonEmptyString(requireOwnProperty(res, 'title', `${path}.title`), `${path}.title`);

    const desc = requireOwnProperty(res, 'description', `${path}.description`);
    if (desc !== null && typeof desc !== 'string') {
      throw new RunExportValidationError(
        `description at '${path}.description' must be string or null`,
        `${path}.description`,
      );
    }

    const cond = requireOwnProperty(res, 'condition', `${path}.condition`);
    if (cond !== null) {
      if (typeof cond !== 'string' || !VALID_CONDITIONS.has(cond as RunExportListingCondition)) {
        throw new RunExportValidationError(
          `Invalid condition at '${path}.condition': ${JSON.stringify(cond)}`,
          `${path}.condition`,
        );
      }
    }

    const avail = requireOwnProperty(res, 'availability', `${path}.availability`);
    if (typeof avail !== 'string' || !VALID_AVAILABILITIES.has(avail as RunExportAvailability)) {
      throw new RunExportValidationError(
        `Invalid availability at '${path}.availability': ${JSON.stringify(avail)}`,
        `${path}.availability`,
      );
    }

    const imgs = requireOwnProperty(res, 'imageUrls', `${path}.imageUrls`);
    if (!Array.isArray(imgs) || !imgs.every((url) => typeof url === 'string')) {
      throw new RunExportValidationError(
        `imageUrls at '${path}.imageUrls' must be an array of strings`,
        `${path}.imageUrls`,
      );
    }

    validateNonEmptyString(
      requireOwnProperty(res, 'rawFingerprint', `${path}.rawFingerprint`),
      `${path}.rawFingerprint`,
    );

    // Price
    const price = requireOwnProperty(res, 'price', `${path}.price`);
    if (price !== null) {
      if (!isRecord(price)) {
        throw new RunExportValidationError(
          `price at '${path}.price' must be object or null`,
          `${path}.price`,
        );
      }
      validateNonEmptyString(
        requireOwnProperty(price, 'rawText', `${path}.price.rawText`),
        `${path}.price.rawText`,
      );
      const amt = requireOwnProperty(price, 'amount', `${path}.price.amount`);
      if (amt !== null) {
        validateInteger(amt, `${path}.price.amount`, 0);
      }
      const curr = requireOwnProperty(price, 'currency', `${path}.price.currency`);
      if (typeof curr !== 'string' || !VALID_CURRENCIES.has(curr as RunExportPriceCurrency)) {
        throw new RunExportValidationError(
          `Invalid currency at '${path}.price.currency': ${JSON.stringify(curr)}`,
          `${path}.price.currency`,
        );
      }
      const resln = requireOwnProperty(price, 'resolution', `${path}.price.resolution`);
      if (typeof resln !== 'string' || !VALID_RESOLUTIONS.has(resln as RunExportPriceResolution)) {
        throw new RunExportValidationError(
          `Invalid resolution at '${path}.price.resolution': ${JSON.stringify(resln)}`,
          `${path}.price.resolution`,
        );
      }
      const conf = validateFiniteNumber(
        requireOwnProperty(price, 'confidence', `${path}.price.confidence`),
        `${path}.price.confidence`,
      );
      if (conf < 0 || conf > 1) {
        throw new RunExportValidationError(
          `confidence at '${path}.price.confidence' must be between 0 and 1, got ${conf}`,
          `${path}.price.confidence`,
        );
      }
      const evid = requireOwnProperty(price, 'evidence', `${path}.price.evidence`);
      if (!Array.isArray(evid) || !evid.every((e) => typeof e === 'string')) {
        throw new RunExportValidationError(
          `evidence at '${path}.price.evidence' must be an array of strings`,
          `${path}.price.evidence`,
        );
      }
      const kind = requireOwnProperty(price, 'kind', `${path}.price.kind`);
      if (typeof kind !== 'string' || !VALID_PRICE_KINDS.has(kind as RunExportPriceKind)) {
        throw new RunExportValidationError(
          `Invalid price kind at '${path}.price.kind': ${JSON.stringify(kind)}`,
          `${path}.price.kind`,
        );
      }

      const conv = requireOwnProperty(price, 'converted', `${path}.price.converted`);
      if (conv !== null) {
        if (!isRecord(conv)) {
          throw new RunExportValidationError(
            `converted at '${path}.price.converted' must be object or null`,
            `${path}.price.converted`,
          );
        }
        validateInteger(
          requireOwnProperty(conv, 'amount', `${path}.price.converted.amount`),
          `${path}.price.converted.amount`,
          0,
        );
        const convCurr = requireOwnProperty(conv, 'currency', `${path}.price.converted.currency`);
        if (convCurr !== 'ARS') {
          throw new RunExportValidationError(
            `converted currency must be 'ARS'`,
            `${path}.price.converted.currency`,
          );
        }
        const rate = validateFiniteNumber(
          requireOwnProperty(conv, 'exchangeRate', `${path}.price.converted.exchangeRate`),
          `${path}.price.converted.exchangeRate`,
        );
        if (rate <= 0) {
          throw new RunExportValidationError(
            `converted exchangeRate must be positive, got ${rate}`,
            `${path}.price.converted.exchangeRate`,
          );
        }
        const origin = requireOwnProperty(
          conv,
          'exchangeRateOrigin',
          `${path}.price.converted.exchangeRateOrigin`,
        );
        if (origin !== 'MANUAL') {
          throw new RunExportValidationError(
            `converted exchangeRateOrigin must be 'MANUAL'`,
            `${path}.price.converted.exchangeRateOrigin`,
          );
        }
        const cAt = requireOwnProperty(conv, 'convertedAt', `${path}.price.converted.convertedAt`);
        validateCanonicalTimestamp(cAt, `${path}.price.converted.convertedAt`);
      }
    }

    // Location
    const loc = requireOwnProperty(res, 'location', `${path}.location`);
    if (loc !== null) {
      if (!isRecord(loc)) {
        throw new RunExportValidationError(
          `location at '${path}.location' must be object or null`,
          `${path}.location`,
        );
      }
      validateNonEmptyString(
        requireOwnProperty(loc, 'rawText', `${path}.location.rawText`),
        `${path}.location.rawText`,
      );
      const reg = requireOwnProperty(loc, 'region', `${path}.location.region`);
      if (reg !== null && typeof reg !== 'string') {
        throw new RunExportValidationError(
          `location.region must be string or null`,
          `${path}.location.region`,
        );
      }
      const city = requireOwnProperty(loc, 'city', `${path}.location.city`);
      if (city !== null && typeof city !== 'string') {
        throw new RunExportValidationError(
          `location.city must be string or null`,
          `${path}.location.city`,
        );
      }
      const neigh = requireOwnProperty(loc, 'neighborhood', `${path}.location.neighborhood`);
      if (neigh !== null && typeof neigh !== 'string') {
        throw new RunExportValidationError(
          `location.neighborhood must be string or null`,
          `${path}.location.neighborhood`,
        );
      }
      const latVal = requireOwnProperty(loc, 'latitude', `${path}.location.latitude`);
      if (latVal !== null) {
        const lat = validateFiniteNumber(latVal, `${path}.location.latitude`);
        if (lat < -90 || lat > 90) {
          throw new RunExportValidationError(
            `latitude must be between -90 and 90, got ${lat}`,
            `${path}.location.latitude`,
          );
        }
      }
      const lonVal = requireOwnProperty(loc, 'longitude', `${path}.location.longitude`);
      if (lonVal !== null) {
        const lon = validateFiniteNumber(lonVal, `${path}.location.longitude`);
        if (lon < -180 || lon > 180) {
          throw new RunExportValidationError(
            `longitude must be between -180 and 180, got ${lon}`,
            `${path}.location.longitude`,
          );
        }
      }
    }

    // Novelty
    const nov = requireOwnProperty(res, 'novelty', `${path}.novelty`);
    if (nov !== null) {
      if (typeof nov !== 'string' || !VALID_NOVELTIES.has(nov as RunExportItemNovelty)) {
        throw new RunExportValidationError(
          `Invalid novelty at '${path}.novelty': ${JSON.stringify(nov)}`,
          `${path}.novelty`,
        );
      }
    }

    // Evaluation
    const ev = requireOwnProperty(res, 'evaluation', `${path}.evaluation`);
    if (ev !== null) {
      if (!isRecord(ev)) {
        throw new RunExportValidationError(
          `evaluation at '${path}.evaluation' must be object or null`,
          `${path}.evaluation`,
        );
      }
      const dec = requireOwnProperty(ev, 'decision', `${path}.evaluation.decision`);
      if (typeof dec !== 'string' || !VALID_DECISIONS.has(dec as RunExportEvaluationDecision)) {
        throw new RunExportValidationError(
          `Invalid evaluation decision at '${path}.evaluation.decision'`,
          `${path}.evaluation.decision`,
        );
      }
      const score = validateFiniteNumber(
        requireOwnProperty(ev, 'score', `${path}.evaluation.score`),
        `${path}.evaluation.score`,
      );
      if (score < 0 || score > 100) {
        throw new RunExportValidationError(
          `evaluation score must be between 0 and 100, got ${score}`,
          `${path}.evaluation.score`,
        );
      }
      const rawReasons = requireOwnProperty(ev, 'reasons', `${path}.evaluation.reasons`);
      if (!Array.isArray(rawReasons) || rawReasons.length === 0) {
        throw new RunExportValidationError(
          `evaluation must have at least one reason at '${path}.evaluation.reasons'`,
          `${path}.evaluation.reasons`,
        );
      }
      const reasons: readonly unknown[] = rawReasons;
      for (let rIdx = 0; rIdx < reasons.length; rIdx++) {
        const r = reasons[rIdx];
        const rPath = `${path}.evaluation.reasons[${rIdx}]`;
        if (!isRecord(r)) {
          throw new RunExportValidationError(`reason at '${rPath}' must be an object`, rPath);
        }
        validateNonEmptyString(requireOwnProperty(r, 'code', `${rPath}.code`), `${rPath}.code`);
        validateNonEmptyString(
          requireOwnProperty(r, 'message', `${rPath}.message`),
          `${rPath}.message`,
        );
        validateFiniteNumber(requireOwnProperty(r, 'impact', `${rPath}.impact`), `${rPath}.impact`);
        const sev = requireOwnProperty(r, 'severity', `${rPath}.severity`);
        if (typeof sev !== 'string' || !VALID_SEVERITIES.has(sev as RunExportEvaluationSeverity)) {
          throw new RunExportValidationError(
            `Invalid reason severity at '${rPath}.severity'`,
            `${rPath}.severity`,
          );
        }
        // evidence in reason is optional
        if (
          'evidence' in r &&
          r['evidence'] !== null &&
          r['evidence'] !== undefined &&
          typeof r['evidence'] !== 'string'
        ) {
          throw new RunExportValidationError(
            `reason evidence at '${rPath}.evidence' must be string or null`,
            `${rPath}.evidence`,
          );
        }
      }

      const evalBy = requireOwnProperty(ev, 'evaluatedBy', `${path}.evaluation.evaluatedBy`);
      if (
        !Array.isArray(evalBy) ||
        evalBy.length === 0 ||
        !evalBy.every(
          (actor) =>
            typeof actor === 'string' && VALID_EVALUATORS.has(actor as RunExportEvaluatorType),
        )
      ) {
        throw new RunExportValidationError(
          `evaluatedBy at '${path}.evaluation.evaluatedBy' must be non-empty array of valid evaluator types`,
          `${path}.evaluation.evaluatedBy`,
        );
      }

      validateNonEmptyString(
        requireOwnProperty(ev, 'policyVersion', `${path}.evaluation.policyVersion`),
        `${path}.evaluation.policyVersion`,
      );
      validateCanonicalTimestamp(
        requireOwnProperty(ev, 'createdAt', `${path}.evaluation.createdAt`),
        `${path}.evaluation.createdAt`,
      );
    }
  }
}
