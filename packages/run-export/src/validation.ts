import { RunExportValidationError } from './errors.js';
import {
  RUN_EXPORT_SCHEMA_VERSION,
  type RunExportSnapshot,
  type RunExportRunStatus,
  type RunExportSourceStatus,
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
  if (snapshot['schemaVersion'] !== RUN_EXPORT_SCHEMA_VERSION) {
    throw new RunExportValidationError(
      `Expected schemaVersion ${RUN_EXPORT_SCHEMA_VERSION}, got ${JSON.stringify(snapshot['schemaVersion'])}`,
      '$.schemaVersion',
    );
  }

  // 2. run
  const run = snapshot['run'];
  if (!isRecord(run)) {
    throw new RunExportValidationError("Field 'run' must be an object", '$.run');
  }
  validateNonEmptyString(run['id'], '$.run.id');
  const runSavedSearchId = validateNonEmptyString(run['savedSearchId'], '$.run.savedSearchId');
  const runStatus = run['status'];
  if (typeof runStatus !== 'string' || !VALID_RUN_STATUSES.has(runStatus as RunExportRunStatus)) {
    throw new RunExportValidationError(
      `Invalid run status at '$.run.status': ${JSON.stringify(runStatus)}`,
      '$.run.status',
    );
  }
  validateCanonicalTimestamp(run['startedAt'], '$.run.startedAt');
  validateNullableCanonicalTimestamp(run['finishedAt'], '$.run.finishedAt');

  if (run['error'] !== null && run['error'] !== undefined) {
    if (!isRecord(run['error'])) {
      throw new RunExportValidationError(
        "Field 'run.error' must be null or an object",
        '$.run.error',
      );
    }
    const errCode = run['error']['code'];
    if (errCode !== null && typeof errCode !== 'string') {
      throw new RunExportValidationError(
        "Field 'run.error.code' must be string or null",
        '$.run.error.code',
      );
    }
    const errMsg = run['error']['message'];
    if (errMsg !== null && typeof errMsg !== 'string') {
      throw new RunExportValidationError(
        "Field 'run.error.message' must be string or null",
        '$.run.error.message',
      );
    }
  }

  // 3. search
  const search = snapshot['search'];
  if (!isRecord(search)) {
    throw new RunExportValidationError("Field 'search' must be an object", '$.search');
  }
  const searchSavedSearchId = validateNonEmptyString(
    search['savedSearchId'],
    '$.search.savedSearchId',
  );
  if (runSavedSearchId !== searchSavedSearchId) {
    throw new RunExportValidationError(
      `search.savedSearchId '${searchSavedSearchId}' does not match run.savedSearchId '${runSavedSearchId}'`,
      '$.search.savedSearchId',
    );
  }
  validateInteger(search['revisionNumber'], '$.search.revisionNumber', 1);
  validateInteger(search['schemaVersion'], '$.search.schemaVersion', 1);
  validateNonEmptyString(search['name'], '$.search.name');
  validateNonEmptyString(search['category'], '$.search.category');

  // 4. manualExchangeRate
  const manualFx = snapshot['manualExchangeRate'];
  if (manualFx !== null && manualFx !== undefined) {
    const fxNum = validateFiniteNumber(manualFx, '$.manualExchangeRate');
    if (fxNum <= 0) {
      throw new RunExportValidationError(
        `manualExchangeRate must be positive, got ${fxNum}`,
        '$.manualExchangeRate',
      );
    }
  }

  // 5. sources
  const rawSources = snapshot['sources'];
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
    const srId = validateNonEmptyString(src['sourceRunId'], `${path}.sourceRunId`);
    if (seenSourceRunIds.has(srId)) {
      throw new RunExportValidationError(
        `Duplicate sourceRunId '${srId}' at '${path}.sourceRunId'`,
        `${path}.sourceRunId`,
      );
    }
    seenSourceRunIds.add(srId);

    const sId = validateNonEmptyString(src['sourceId'], `${path}.sourceId`);
    sourceMap.set(srId, { sourceId: sId });

    if (
      src['collectorId'] !== null &&
      src['collectorId'] !== undefined &&
      typeof src['collectorId'] !== 'string'
    ) {
      throw new RunExportValidationError(
        `collectorId at '${path}.collectorId' must be string or null`,
        `${path}.collectorId`,
      );
    }

    validateNonEmptyString(src['adapterVersion'], `${path}.adapterVersion`);

    const srcStatus = src['status'];
    if (
      typeof srcStatus !== 'string' ||
      !VALID_SOURCE_STATUSES.has(srcStatus as RunExportSourceStatus)
    ) {
      throw new RunExportValidationError(
        `Invalid source status at '${path}.status': ${JSON.stringify(srcStatus)}`,
        `${path}.status`,
      );
    }

    validateCanonicalTimestamp(src['startedAt'], `${path}.startedAt`);
    validateNullableCanonicalTimestamp(src['finishedAt'], `${path}.finishedAt`);

    if (src['itemsCount'] !== null && src['itemsCount'] !== undefined) {
      validateInteger(src['itemsCount'], `${path}.itemsCount`, 0);
    }

    if (src['metrics'] !== null && src['metrics'] !== undefined) {
      const m = src['metrics'];
      if (!isRecord(m)) {
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
      ];
      for (const field of countFields) {
        if (m[field] !== null && m[field] !== undefined) {
          validateInteger(m[field], `${path}.metrics.${field}`, 0);
        }
      }
      if (
        m['stopReason'] !== null &&
        m['stopReason'] !== undefined &&
        typeof m['stopReason'] !== 'string'
      ) {
        throw new RunExportValidationError(
          `stopReason at '${path}.metrics.stopReason' must be string or null`,
          `${path}.metrics.stopReason`,
        );
      }
    }

    if (src['error'] !== null && src['error'] !== undefined) {
      const e = src['error'];
      if (!isRecord(e)) {
        throw new RunExportValidationError(
          `error at '${path}.error' must be object or null`,
          `${path}.error`,
        );
      }
      if (e['code'] !== null && typeof e['code'] !== 'string') {
        throw new RunExportValidationError(
          `error.code at '${path}.error.code' must be string or null`,
          `${path}.error.code`,
        );
      }
      if (e['message'] !== null && typeof e['message'] !== 'string') {
        throw new RunExportValidationError(
          `error.message at '${path}.error.message' must be string or null`,
          `${path}.error.message`,
        );
      }
    }
  }

  // 6. results
  const rawResults = snapshot['results'];
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

    validateNonEmptyString(res['listingId'], `${path}.listingId`);
    const obsId = validateNonEmptyString(res['observationId'], `${path}.observationId`);
    if (seenObsIds.has(obsId)) {
      throw new RunExportValidationError(
        `Duplicate observationId '${obsId}' at '${path}.observationId'`,
        `${path}.observationId`,
      );
    }
    seenObsIds.add(obsId);

    const srId = validateNonEmptyString(res['sourceRunId'], `${path}.sourceRunId`);
    const sId = validateNonEmptyString(res['sourceId'], `${path}.sourceId`);

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

    validateNonEmptyString(res['externalId'], `${path}.externalId`);
    validateNonEmptyString(res['canonicalUrl'], `${path}.canonicalUrl`);
    validateCanonicalTimestamp(res['observedAt'], `${path}.observedAt`);
    validateNullableCanonicalTimestamp(res['publishedAt'], `${path}.publishedAt`);
    validateNonEmptyString(res['title'], `${path}.title`);

    if (
      res['description'] !== null &&
      res['description'] !== undefined &&
      typeof res['description'] !== 'string'
    ) {
      throw new RunExportValidationError(
        `description at '${path}.description' must be string or null`,
        `${path}.description`,
      );
    }

    if (res['condition'] !== null && res['condition'] !== undefined) {
      if (
        typeof res['condition'] !== 'string' ||
        !VALID_CONDITIONS.has(res['condition'] as RunExportListingCondition)
      ) {
        throw new RunExportValidationError(
          `Invalid condition at '${path}.condition': ${JSON.stringify(res['condition'])}`,
          `${path}.condition`,
        );
      }
    }

    const avail = res['availability'];
    if (typeof avail !== 'string' || !VALID_AVAILABILITIES.has(avail as RunExportAvailability)) {
      throw new RunExportValidationError(
        `Invalid availability at '${path}.availability': ${JSON.stringify(avail)}`,
        `${path}.availability`,
      );
    }

    const imgs = res['imageUrls'];
    if (!Array.isArray(imgs) || !imgs.every((url) => typeof url === 'string')) {
      throw new RunExportValidationError(
        `imageUrls at '${path}.imageUrls' must be an array of strings`,
        `${path}.imageUrls`,
      );
    }

    validateNonEmptyString(res['rawFingerprint'], `${path}.rawFingerprint`);

    // Price
    if (res['price'] !== null && res['price'] !== undefined) {
      const p = res['price'];
      if (!isRecord(p)) {
        throw new RunExportValidationError(
          `price at '${path}.price' must be object or null`,
          `${path}.price`,
        );
      }
      validateNonEmptyString(p['rawText'], `${path}.price.rawText`);
      if (p['amount'] !== null) {
        validateInteger(p['amount'], `${path}.price.amount`, 0);
      }
      if (
        typeof p['currency'] !== 'string' ||
        !VALID_CURRENCIES.has(p['currency'] as RunExportPriceCurrency)
      ) {
        throw new RunExportValidationError(
          `Invalid currency at '${path}.price.currency': ${JSON.stringify(p['currency'])}`,
          `${path}.price.currency`,
        );
      }
      if (
        typeof p['resolution'] !== 'string' ||
        !VALID_RESOLUTIONS.has(p['resolution'] as RunExportPriceResolution)
      ) {
        throw new RunExportValidationError(
          `Invalid resolution at '${path}.price.resolution': ${JSON.stringify(p['resolution'])}`,
          `${path}.price.resolution`,
        );
      }
      const conf = validateFiniteNumber(p['confidence'], `${path}.price.confidence`);
      if (conf < 0 || conf > 1) {
        throw new RunExportValidationError(
          `confidence at '${path}.price.confidence' must be between 0 and 1, got ${conf}`,
          `${path}.price.confidence`,
        );
      }
      if (!Array.isArray(p['evidence']) || !p['evidence'].every((e) => typeof e === 'string')) {
        throw new RunExportValidationError(
          `evidence at '${path}.price.evidence' must be an array of strings`,
          `${path}.price.evidence`,
        );
      }
      if (
        p['kind'] !== undefined &&
        (typeof p['kind'] !== 'string' || !VALID_PRICE_KINDS.has(p['kind'] as RunExportPriceKind))
      ) {
        throw new RunExportValidationError(
          `Invalid price kind at '${path}.price.kind'`,
          `${path}.price.kind`,
        );
      }

      if (p['converted'] !== null && p['converted'] !== undefined) {
        const c = p['converted'];
        if (!isRecord(c)) {
          throw new RunExportValidationError(
            `converted at '${path}.price.converted' must be object or null`,
            `${path}.price.converted`,
          );
        }
        validateInteger(c['amount'], `${path}.price.converted.amount`, 0);
        if (c['currency'] !== 'ARS') {
          throw new RunExportValidationError(
            `converted currency must be 'ARS'`,
            `${path}.price.converted.currency`,
          );
        }
        const rate = validateFiniteNumber(
          c['exchangeRate'],
          `${path}.price.converted.exchangeRate`,
        );
        if (rate <= 0) {
          throw new RunExportValidationError(
            `converted exchangeRate must be positive, got ${rate}`,
            `${path}.price.converted.exchangeRate`,
          );
        }
        if (c['exchangeRateOrigin'] !== 'MANUAL') {
          throw new RunExportValidationError(
            `converted exchangeRateOrigin must be 'MANUAL'`,
            `${path}.price.converted.exchangeRateOrigin`,
          );
        }
        if (c['convertedAt'] !== null && c['convertedAt'] !== undefined) {
          validateCanonicalTimestamp(c['convertedAt'], `${path}.price.converted.convertedAt`);
        }
      }
    }

    // Location
    if (res['location'] !== null && res['location'] !== undefined) {
      const loc = res['location'];
      if (!isRecord(loc)) {
        throw new RunExportValidationError(
          `location at '${path}.location' must be object or null`,
          `${path}.location`,
        );
      }
      validateNonEmptyString(loc['rawText'], `${path}.location.rawText`);
      if (
        loc['region'] !== null &&
        loc['region'] !== undefined &&
        typeof loc['region'] !== 'string'
      ) {
        throw new RunExportValidationError(
          `location.region must be string or null`,
          `${path}.location.region`,
        );
      }
      if (loc['city'] !== null && loc['city'] !== undefined && typeof loc['city'] !== 'string') {
        throw new RunExportValidationError(
          `location.city must be string or null`,
          `${path}.location.city`,
        );
      }
      if (
        loc['neighborhood'] !== null &&
        loc['neighborhood'] !== undefined &&
        typeof loc['neighborhood'] !== 'string'
      ) {
        throw new RunExportValidationError(
          `location.neighborhood must be string or null`,
          `${path}.location.neighborhood`,
        );
      }
      if (loc['latitude'] !== null && loc['latitude'] !== undefined) {
        const lat = validateFiniteNumber(loc['latitude'], `${path}.location.latitude`);
        if (lat < -90 || lat > 90) {
          throw new RunExportValidationError(
            `latitude must be between -90 and 90, got ${lat}`,
            `${path}.location.latitude`,
          );
        }
      }
      if (loc['longitude'] !== null && loc['longitude'] !== undefined) {
        const lon = validateFiniteNumber(loc['longitude'], `${path}.location.longitude`);
        if (lon < -180 || lon > 180) {
          throw new RunExportValidationError(
            `longitude must be between -180 and 180, got ${lon}`,
            `${path}.location.longitude`,
          );
        }
      }
    }

    // Novelty
    if (res['novelty'] !== null && res['novelty'] !== undefined) {
      if (
        typeof res['novelty'] !== 'string' ||
        !VALID_NOVELTIES.has(res['novelty'] as RunExportItemNovelty)
      ) {
        throw new RunExportValidationError(
          `Invalid novelty at '${path}.novelty': ${JSON.stringify(res['novelty'])}`,
          `${path}.novelty`,
        );
      }
    }

    // Evaluation
    if (res['evaluation'] !== null && res['evaluation'] !== undefined) {
      const ev = res['evaluation'];
      if (!isRecord(ev)) {
        throw new RunExportValidationError(
          `evaluation at '${path}.evaluation' must be object or null`,
          `${path}.evaluation`,
        );
      }
      const dec = ev['decision'];
      if (typeof dec !== 'string' || !VALID_DECISIONS.has(dec as RunExportEvaluationDecision)) {
        throw new RunExportValidationError(
          `Invalid evaluation decision at '${path}.evaluation.decision'`,
          `${path}.evaluation.decision`,
        );
      }
      const score = validateFiniteNumber(ev['score'], `${path}.evaluation.score`);
      if (score < 0 || score > 100) {
        throw new RunExportValidationError(
          `evaluation score must be between 0 and 100, got ${score}`,
          `${path}.evaluation.score`,
        );
      }
      const rawReasons = ev['reasons'];
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
        validateNonEmptyString(r['code'], `${rPath}.code`);
        validateNonEmptyString(r['message'], `${rPath}.message`);
        validateFiniteNumber(r['impact'], `${rPath}.impact`);
        const sev = r['severity'];
        if (typeof sev !== 'string' || !VALID_SEVERITIES.has(sev as RunExportEvaluationSeverity)) {
          throw new RunExportValidationError(
            `Invalid reason severity at '${rPath}.severity'`,
            `${rPath}.severity`,
          );
        }
        if (
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

      const evalBy = ev['evaluatedBy'];
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

      validateNonEmptyString(ev['policyVersion'], `${path}.evaluation.policyVersion`);
      validateCanonicalTimestamp(ev['createdAt'], `${path}.evaluation.createdAt`);
    }
  }
}
