import {
  type SavedSearch,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
  type CreateSavedSearchParams,
  type SourceSearchConfig,
  type QueryPolicy,
  type PricePolicy,
  type LocationPolicy,
  type ConditionPolicy,
  type RuleExpression,
  type EvaluationPolicy,
  type AiPolicy,
  type RetentionPolicy,
  type RawArtifactRetentionPolicy,
  type PriceCurrency,
  type ListingCondition,
  createSavedSearch,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  StorageCorruptionError,
  SavedSearchIdentityCollisionError,
} from '../errors/storage-errors.js';
import { validateNoSensitiveData, validateSessionRef } from '../sanitization/secret-detector.js';

interface SavedSearchRow {
  readonly id: string;
  readonly schema_version: number;
  readonly name: string;
  readonly category: string;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly payload: string;
}

interface SavedSearchRevisionRow {
  readonly id: string;
  readonly saved_search_id: string;
  readonly revision_number: number;
  readonly schema_version: number;
  readonly snapshot: string;
  readonly recorded_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(isoString: unknown, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${entityId}': '${fieldName}' must be a string, got ${typeof isoString}`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || !isoString.includes('T')) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set(['PRODUCT', 'REAL_ESTATE', 'VEHICLE']);
const VALID_CURRENCIES: ReadonlySet<string> = new Set(['ARS', 'USD', 'UNKNOWN']);
const VALID_FOREIGN_MODES: ReadonlySet<string> = new Set(['MANUAL_RATE', 'IGNORE', 'STRICT']);
const VALID_ON_UNKNOWN: ReadonlySet<string> = new Set(['REVIEW', 'REJECT']);
const VALID_LOCATION_MODES: ReadonlySet<string> = new Set(['REGION', 'RADIUS', 'CUSTOM']);
const VALID_CONDITIONS: ReadonlySet<string> = new Set([
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
  'UNKNOWN',
]);
const VALID_PRECISION_PROFILES: ReadonlySet<string> = new Set([
  'STRICT',
  'BALANCED',
  'PERMISSIVE',
  'MIXED',
]);
const VALID_RAW_ARTIFACTS: ReadonlySet<string> = new Set([
  'NONE',
  'ERRORS_ONLY',
  'ERRORS_AND_REVIEW',
  'ALL_LIMITED',
  'ALL',
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateSourceConfigs(val: unknown, entityContext: string): SourceSearchConfig[] {
  if (!Array.isArray(val) || val.length === 0) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'sourceConfigs' must be a non-empty array`,
    );
  }
  return val.map((item, idx) => {
    if (!isRecord(item)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}] must be an object`,
      );
    }
    if (typeof item['id'] !== 'string' || item['id'].trim().length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}].id must be a non-empty string`,
      );
    }
    if (typeof item['enabled'] !== 'boolean') {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}].enabled must be a boolean`,
      );
    }
    if (!Array.isArray(item['queries']) || !item['queries'].every((q) => typeof q === 'string')) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}].queries must be an array of strings`,
      );
    }
    if (item['options'] !== undefined && !isRecord(item['options'])) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}].options must be an object/record if present`,
      );
    }
    if (item['sessionRef'] !== undefined && typeof item['sessionRef'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': sourceConfigs[${idx}].sessionRef must be a string if present`,
      );
    }
    return {
      id: item['id'],
      enabled: item['enabled'],
      queries: item['queries'],
      ...(item['options'] !== undefined ? { options: item['options'] } : {}),
      ...(item['sessionRef'] !== undefined ? { sessionRef: item['sessionRef'] } : {}),
    };
  });
}

function validateQuery(val: unknown, entityContext: string): QueryPolicy {
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'query' must be an object`,
    );
  }
  if (!Array.isArray(val['terms']) || !val['terms'].every((t) => typeof t === 'string')) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': query.terms must be an array of strings`,
    );
  }
  if (
    val['excludedTerms'] !== undefined &&
    (!Array.isArray(val['excludedTerms']) ||
      !val['excludedTerms'].every((t) => typeof t === 'string'))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': query.excludedTerms must be an array of strings if present`,
    );
  }
  return {
    terms: val['terms'],
    ...(val['excludedTerms'] !== undefined ? { excludedTerms: val['excludedTerms'] } : {}),
  };
}

function validatePrice(val: unknown, entityContext: string): PricePolicy | null {
  if (val === null) return null;
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'price' must be null or an object`,
    );
  }
  if (typeof val['targetCurrency'] !== 'string' || !VALID_CURRENCIES.has(val['targetCurrency'])) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': price.targetCurrency must be a valid PriceCurrency`,
    );
  }
  const maximum = val['maximum'];
  if (
    maximum !== undefined &&
    maximum !== null &&
    (typeof maximum !== 'number' || !Number.isFinite(maximum))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': price.maximum must be null or a finite number`,
    );
  }
  const minimumPlausible = val['minimumPlausible'];
  if (
    minimumPlausible !== undefined &&
    minimumPlausible !== null &&
    (typeof minimumPlausible !== 'number' || !Number.isFinite(minimumPlausible))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': price.minimumPlausible must be null or a finite number`,
    );
  }

  let foreignCurrency: PricePolicy['foreignCurrency'];
  if (val['foreignCurrency'] !== undefined) {
    const fc = val['foreignCurrency'];
    if (!isRecord(fc)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': price.foreignCurrency must be an object if present`,
      );
    }
    if (typeof fc['mode'] !== 'string' || !VALID_FOREIGN_MODES.has(fc['mode'])) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': price.foreignCurrency.mode is invalid`,
      );
    }
    if (typeof fc['onUnknown'] !== 'string' || !VALID_ON_UNKNOWN.has(fc['onUnknown'])) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': price.foreignCurrency.onUnknown is invalid`,
      );
    }
    foreignCurrency = {
      mode: fc['mode'] as 'MANUAL_RATE' | 'IGNORE' | 'STRICT',
      onUnknown: fc['onUnknown'] as 'REVIEW' | 'REJECT',
    };
  }

  return {
    targetCurrency: val['targetCurrency'] as PriceCurrency,
    ...(maximum !== undefined ? { maximum: maximum } : {}),
    ...(minimumPlausible !== undefined ? { minimumPlausible: minimumPlausible } : {}),
    ...(foreignCurrency !== undefined ? { foreignCurrency } : {}),
  };
}

function validateLocation(val: unknown, entityContext: string): LocationPolicy | null {
  if (val === null) return null;
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'location' must be null or an object`,
    );
  }
  if (typeof val['mode'] !== 'string' || !VALID_LOCATION_MODES.has(val['mode'])) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': location.mode is invalid`,
    );
  }
  if (val['region'] !== undefined && typeof val['region'] !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': location.region must be a string if present`,
    );
  }
  if (
    val['radiusKm'] !== undefined &&
    (typeof val['radiusKm'] !== 'number' || !Number.isFinite(val['radiusKm']))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': location.radiusKm must be a finite number if present`,
    );
  }
  let coordinates: LocationPolicy['coordinates'];
  if (val['coordinates'] !== undefined) {
    const coords = val['coordinates'];
    if (!isRecord(coords)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': location.coordinates must be an object if present`,
      );
    }
    if (
      typeof coords['latitude'] !== 'number' ||
      !Number.isFinite(coords['latitude']) ||
      typeof coords['longitude'] !== 'number' ||
      !Number.isFinite(coords['longitude'])
    ) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': location.coordinates latitude/longitude must be finite numbers`,
      );
    }
    coordinates = {
      latitude: coords['latitude'],
      longitude: coords['longitude'],
    };
  }

  return {
    mode: val['mode'] as 'REGION' | 'RADIUS' | 'CUSTOM',
    ...(val['region'] !== undefined ? { region: val['region'] } : {}),
    ...(val['radiusKm'] !== undefined ? { radiusKm: val['radiusKm'] } : {}),
    ...(coordinates !== undefined ? { coordinates } : {}),
  };
}

function validateCondition(val: unknown, entityContext: string): ConditionPolicy | null {
  if (val === null) return null;
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'condition' must be null or an object`,
    );
  }
  if (
    !Array.isArray(val['accepted']) ||
    !val['accepted'].every((c) => typeof c === 'string' && VALID_CONDITIONS.has(c))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': condition.accepted must be an array of valid ListingCondition`,
    );
  }
  return {
    accepted: val['accepted'] as ListingCondition[],
  };
}

function validateRules(val: unknown, entityContext: string): RuleExpression[] {
  if (!Array.isArray(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'rules' must be an array`,
    );
  }
  return val.map((rule, idx) => {
    if (!isRecord(rule)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': rules[${idx}] must be an object`,
      );
    }
    if (typeof rule['id'] !== 'string' || rule['id'].trim().length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': rules[${idx}].id must be a non-empty string`,
      );
    }
    if (typeof rule['type'] !== 'string' || rule['type'].trim().length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': rules[${idx}].type must be a non-empty string`,
      );
    }
    if (rule['params'] !== undefined && !isRecord(rule['params'])) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': rules[${idx}].params must be an object if present`,
      );
    }
    return {
      id: rule['id'],
      type: rule['type'],
      ...(rule['params'] !== undefined ? { params: rule['params'] } : {}),
    };
  });
}

function validateEvaluation(val: unknown, entityContext: string): EvaluationPolicy {
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'evaluation' must be an object`,
    );
  }
  if (
    typeof val['matchThreshold'] !== 'number' ||
    !Number.isFinite(val['matchThreshold']) ||
    val['matchThreshold'] < 0 ||
    val['matchThreshold'] > 100
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': evaluation.matchThreshold must be a number between 0 and 100`,
    );
  }
  if (
    typeof val['reviewThreshold'] !== 'number' ||
    !Number.isFinite(val['reviewThreshold']) ||
    val['reviewThreshold'] < 0 ||
    val['reviewThreshold'] > 100
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': evaluation.reviewThreshold must be a number between 0 and 100`,
    );
  }
  if (
    val['precisionProfile'] !== undefined &&
    (typeof val['precisionProfile'] !== 'string' ||
      !VALID_PRECISION_PROFILES.has(val['precisionProfile']))
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': evaluation.precisionProfile is invalid`,
    );
  }
  return {
    matchThreshold: val['matchThreshold'],
    reviewThreshold: val['reviewThreshold'],
    ...(val['precisionProfile'] !== undefined
      ? {
          precisionProfile: val['precisionProfile'] as
            'STRICT' | 'BALANCED' | 'PERMISSIVE' | 'MIXED',
        }
      : {}),
  };
}

function validateAi(val: unknown, entityContext: string): AiPolicy {
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'ai' must be an object`,
    );
  }
  if (typeof val['enabled'] !== 'boolean') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': ai.enabled must be a boolean`,
    );
  }
  if (typeof val['evaluateOnlyReview'] !== 'boolean') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': ai.evaluateOnlyReview must be a boolean`,
    );
  }
  if (val['provider'] !== undefined && typeof val['provider'] !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': ai.provider must be a string if present`,
    );
  }
  if (typeof val['requireConfirmation'] !== 'boolean') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': ai.requireConfirmation must be a boolean`,
    );
  }
  if (
    typeof val['maxEvaluationsPerRun'] !== 'number' ||
    !Number.isInteger(val['maxEvaluationsPerRun']) ||
    val['maxEvaluationsPerRun'] < 0
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': ai.maxEvaluationsPerRun must be an integer >= 0`,
    );
  }
  return {
    enabled: val['enabled'],
    evaluateOnlyReview: val['evaluateOnlyReview'],
    ...(val['provider'] !== undefined ? { provider: val['provider'] } : {}),
    requireConfirmation: val['requireConfirmation'],
    maxEvaluationsPerRun: val['maxEvaluationsPerRun'],
  };
}

function validateRetention(val: unknown, entityContext: string): RetentionPolicy {
  if (!isRecord(val)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': 'retention' must be an object`,
    );
  }
  if (typeof val['rawArtifacts'] !== 'string' || !VALID_RAW_ARTIFACTS.has(val['rawArtifacts'])) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': retention.rawArtifacts is invalid`,
    );
  }
  if (
    typeof val['rawDataDays'] !== 'number' ||
    !Number.isInteger(val['rawDataDays']) ||
    val['rawDataDays'] < 0
  ) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': retention.rawDataDays must be an integer >= 0`,
    );
  }
  const rawPolicy = val['rawArtifacts'];
  const canonicalPolicy: RawArtifactRetentionPolicy =
    rawPolicy === 'ALL' ? 'ALL_LIMITED' : (rawPolicy as RawArtifactRetentionPolicy);

  return {
    rawArtifacts: canonicalPolicy,
    rawDataDays: val['rawDataDays'],
  };
}

function serializeSavedSearch(search: SavedSearch): string {
  const canonical: Required<CreateSavedSearchParams> = {
    id: search.id,
    schemaVersion: search.schemaVersion,
    name: search.name,
    enabled: search.enabled,
    category: search.category,
    sourceConfigs: search.sourceConfigs,
    query: search.query,
    price: search.price ?? null,
    location: search.location ?? null,
    condition: search.condition ?? null,
    rules: search.rules,
    evaluation: search.evaluation,
    ai: search.ai,
    retention: search.retention,
    createdAt: search.createdAt,
    updatedAt: search.updatedAt,
  };
  return JSON.stringify(canonical);
}

function rehydrateSavedSearchFromSnapshot(
  rawJson: string,
  entityContext: string,
  fallbackRow?: SavedSearchRow,
): SavedSearch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': invalid JSON payload`,
      { cause: err },
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': snapshot is not an object`,
    );
  }

  const data = parsed as Record<string, unknown>;

  try {
    // Explicit canonical validation: NO fallback from indexed table columns (Finding 3)
    if (typeof data['id'] !== 'string' || data['id'].trim().length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing or invalid 'id'`,
      );
    }
    const id = data['id'];

    if (
      typeof data['schemaVersion'] !== 'number' ||
      !Number.isInteger(data['schemaVersion']) ||
      data['schemaVersion'] < 1
    ) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing or invalid 'schemaVersion'`,
      );
    }
    const schemaVersion = data['schemaVersion'];

    if (typeof data['name'] !== 'string' || data['name'].trim().length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing or invalid 'name'`,
      );
    }
    const name = data['name'];

    if (typeof data['enabled'] !== 'boolean') {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing or invalid 'enabled'`,
      );
    }
    const enabled = data['enabled'];

    if (typeof data['category'] !== 'string' || !VALID_CATEGORIES.has(data['category'])) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing or invalid 'category'`,
      );
    }
    const category = data['category'] as SavedSearch['category'];

    if (!('sourceConfigs' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'sourceConfigs'`,
      );
    }

    if (!('query' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'query'`,
      );
    }

    if (!('price' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'price'`,
      );
    }

    if (!('location' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'location'`,
      );
    }

    if (!('condition' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'condition'`,
      );
    }

    if (!('rules' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'rules'`,
      );
    }

    if (!('evaluation' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'evaluation'`,
      );
    }

    if (!('ai' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'ai'`,
      );
    }

    if (!('retention' in data)) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'retention'`,
      );
    }

    if (typeof data['createdAt'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'createdAt'`,
      );
    }

    if (typeof data['updatedAt'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing canonical field 'updatedAt'`,
      );
    }

    const createdAt = parseIsoDate(data['createdAt'], 'createdAt', id);
    const updatedAt = parseIsoDate(data['updatedAt'], 'updatedAt', id);

    // Strict structural runtime validation of all complex shapes (Finding Único Wave 4)
    const sourceConfigs = validateSourceConfigs(data['sourceConfigs'], entityContext);
    const query = validateQuery(data['query'], entityContext);
    const price = validatePrice(data['price'], entityContext);
    const location = validateLocation(data['location'], entityContext);
    const condition = validateCondition(data['condition'], entityContext);
    const rules = validateRules(data['rules'], entityContext);
    const evaluation = validateEvaluation(data['evaluation'], entityContext);
    const ai = validateAi(data['ai'], entityContext);
    const retention = validateRetention(data['retention'], entityContext);

    // Cross-validate indexed table columns vs canonical snapshot (Finding 3 / C3)
    if (fallbackRow) {
      if (fallbackRow.id !== id) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed id '${fallbackRow.id}' does not match snapshot id '${id}'`,
        );
      }
      if (fallbackRow.schema_version !== schemaVersion) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed schema_version '${fallbackRow.schema_version}' does not match snapshot schemaVersion '${schemaVersion}'`,
        );
      }
      if (fallbackRow.name !== name) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed name '${fallbackRow.name}' does not match snapshot name '${name}'`,
        );
      }
      if ((fallbackRow.enabled === 1) !== enabled) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed enabled '${fallbackRow.enabled}' does not match snapshot enabled '${enabled}'`,
        );
      }
      if (fallbackRow.category !== category) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed category '${fallbackRow.category}' does not match snapshot category '${category}'`,
        );
      }
      if (fallbackRow.created_at !== createdAt.toISOString()) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed created_at '${fallbackRow.created_at}' does not match snapshot createdAt '${createdAt.toISOString()}'`,
        );
      }
      if (fallbackRow.updated_at !== updatedAt.toISOString()) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed updated_at '${fallbackRow.updated_at}' does not match snapshot updatedAt '${updatedAt.toISOString()}'`,
        );
      }
    }

    const params: CreateSavedSearchParams = {
      id,
      schemaVersion,
      name,
      enabled,
      category,
      sourceConfigs,
      query,
      price,
      location,
      condition,
      rules,
      evaluation,
      ai,
      retention,
      createdAt,
      updatedAt,
    };

    return createSavedSearch(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': domain invariant violation: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteSavedSearchRepository implements SavedSearchRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<SavedSearch | null> {
    try {
      const stmt = this.db.prepare<SavedSearchRow, [string]>(
        `SELECT id, schema_version, name, category, enabled, created_at, updated_at, payload
         FROM saved_searches
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateSavedSearchFromSnapshot(row.payload, row.id, row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listEnabled(): Promise<readonly SavedSearch[]> {
    try {
      const stmt = this.db.prepare<SavedSearchRow, []>(
        `SELECT id, schema_version, name, category, enabled, created_at, updated_at, payload
         FROM saved_searches
         WHERE enabled = 1
         ORDER BY created_at ASC, id ASC`,
      );
      const rows = stmt.all();
      return Promise.resolve(
        rows.map((row) => rehydrateSavedSearchFromSnapshot(row.payload, row.id, row)),
      );
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(savedSearch: SavedSearch): Promise<void> {
    try {
      // 1. Defensively inspect options, sessionRef, and rule params before opening the transaction or writing rows.
      // If any sensitive secret data is present, throw SensitiveDataDetectedError (fail-closed, 0 mutations).
      for (const cfg of savedSearch.sourceConfigs) {
        if (cfg.options !== undefined) {
          validateNoSensitiveData(cfg.options, `sourceConfigs.${cfg.id}.options`);
        }
        if (cfg.sessionRef !== undefined) {
          validateSessionRef(cfg.sessionRef, `sourceConfigs.${cfg.id}.sessionRef`);
        }
      }

      for (let i = 0; i < savedSearch.rules.length; i++) {
        const rule = savedSearch.rules[i]!;
        if (rule.params !== undefined) {
          validateNoSensitiveData(rule.params, `rules[${i}].params`);
        }
      }

      // 2. Validate immutable createdAt identity if record already exists (Finding C3)
      const existing = this.db
        .prepare<{ id: string; created_at: string }, [string]>(
          `SELECT id, created_at FROM saved_searches WHERE id = ?`,
        )
        .get(savedSearch.id);

      if (existing) {
        if (existing.created_at !== savedSearch.createdAt.toISOString()) {
          throw new SavedSearchIdentityCollisionError({
            savedSearchId: savedSearch.id,
            existingCreatedAt: new Date(existing.created_at),
            attemptingCreatedAt: savedSearch.createdAt,
          });
        }
      }

      // 3. Canonical serialization of the complete SavedSearch (exact semantic round-trip).
      const payloadJson = serializeSavedSearch(savedSearch);
      const createdAtIso = savedSearch.createdAt.toISOString();
      const updatedAtIso = savedSearch.updatedAt.toISOString();
      const enabledInt = savedSearch.enabled ? 1 : 0;

      this.db.transaction((tx) => {
        // 4. Upsert into saved_searches
        const upsertStmt = tx.prepare(
          `INSERT INTO saved_searches (
            id, schema_version, name, category, enabled, created_at, updated_at, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            schema_version = excluded.schema_version,
            name = excluded.name,
            category = excluded.category,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            payload = excluded.payload`,
        );
        upsertStmt.run(
          savedSearch.id,
          savedSearch.schemaVersion,
          savedSearch.name,
          savedSearch.category,
          enabledInt,
          createdAtIso,
          updatedAtIso,
          payloadJson,
        );

        // 5. Query next revision number
        const maxRevStmt = tx.prepare<{ max_rev: number }, [string]>(
          `SELECT COALESCE(MAX(revision_number), 0) AS max_rev
           FROM saved_search_revisions
           WHERE saved_search_id = ?`,
        );
        const maxRevRow = maxRevStmt.get(savedSearch.id);
        const nextRevNumber = (maxRevRow ? Number(maxRevRow.max_rev) : 0) + 1;
        const revisionId = `${savedSearch.id}_rev_${nextRevNumber}`;

        // 6. Insert complete append-only revision record
        const revisionInsertStmt = tx.prepare(
          `INSERT INTO saved_search_revisions (
            id, saved_search_id, revision_number, schema_version, snapshot, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        revisionInsertStmt.run(
          revisionId,
          savedSearch.id,
          nextRevNumber,
          savedSearch.schemaVersion,
          payloadJson,
          updatedAtIso,
        );
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listRevisions(savedSearchId: string): Promise<readonly SavedSearchRevisionRecord[]> {
    try {
      const stmt = this.db.prepare<SavedSearchRevisionRow, [string]>(
        `SELECT id, saved_search_id, revision_number, schema_version, snapshot, recorded_at
         FROM saved_search_revisions
         WHERE saved_search_id = ?
         ORDER BY revision_number ASC`,
      );
      const rows = stmt.all(savedSearchId);

      const mapped: SavedSearchRevisionRecord[] = rows.map((row) => {
        const recordedAt = parseIsoDate(row.recorded_at, 'recorded_at', row.id);
        const snapshot = rehydrateSavedSearchFromSnapshot(row.snapshot, `revision:${row.id}`);

        // Validate revision consistency with row columns (Finding C3)
        if (row.saved_search_id !== snapshot.id) {
          throw new StorageCorruptionError(
            `Corrupted persisted SavedSearch revision in '${row.id}': saved_search_id '${row.saved_search_id}' does not match snapshot id '${snapshot.id}'`,
          );
        }
        if (Number(row.schema_version) !== snapshot.schemaVersion) {
          throw new StorageCorruptionError(
            `Corrupted persisted SavedSearch revision in '${row.id}': schema_version '${row.schema_version}' does not match snapshot schemaVersion '${snapshot.schemaVersion}'`,
          );
        }

        return {
          id: row.id,
          savedSearchId: row.saved_search_id,
          revisionNumber: Number(row.revision_number),
          schemaVersion: Number(row.schema_version),
          recordedAt,
          snapshot,
        };
      });

      return Promise.resolve(mapped);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
