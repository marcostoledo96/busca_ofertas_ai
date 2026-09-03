import {
  type Observation,
  type ObservationRepository,
  type CreateObservationParams,
  createObservation,
  type Listing,
  createListing,
  type ObservationChangeKind,
  type RecordObservationParams,
  type RecordObservationResult,
  type ResolvedPrice,
  createResolvedPrice,
  type ConvertedPrice,
  type ResolvedLocation,
  type ListingCondition,
  type Availability,
  type PriceCurrency,
  type PriceResolution,
  type PriceKind,
  isFallbackExternalId,
  buildCanonicalObservationPayload,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  ObservationIdentityCollisionError,
  ObservationFingerprintCollisionError,
  RecordObservationCoherenceError,
  ListingIdentityCollisionError,
  StorageCorruptionError,
} from '../errors/storage-errors.js';

interface ObservationRow {
  readonly id: string;
  readonly listing_id: string;
  readonly source_run_id: string;
  readonly observed_at: string;
  readonly title: string;
  readonly description: string | null;
  readonly price: string | null;
  readonly location: string | null;
  readonly condition: string | null;
  readonly availability: string;
  readonly image_urls: string;
  readonly published_at: string | null;
  readonly raw_fingerprint: string;
}

interface ListingRow {
  readonly id: string;
  readonly source_id: string;
  readonly external_id: string;
  readonly canonical_url: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

interface SourceRunRow {
  readonly source_id: string;
}

const VALID_CONDITIONS = new Set<ListingCondition>([
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
  'UNKNOWN',
]);

const VALID_AVAILABILITIES = new Set<Availability>([
  'AVAILABLE',
  'PENDING',
  'SOLD',
  'REMOVED',
  'UNKNOWN',
]);

const VALID_CURRENCIES = new Set<PriceCurrency>(['ARS', 'USD', 'UNKNOWN']);
const VALID_RESOLUTIONS = new Set<PriceResolution>([
  'EXPLICIT',
  'SOURCE_METADATA',
  'TEXT_INFERENCE',
  'AMBIGUOUS',
]);
const VALID_PRICE_KINDS = new Set<PriceKind>([
  'TOTAL',
  'DEPOSIT',
  'INSTALLMENT',
  'FROM_PRICE',
  'UNKNOWN',
]);

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted entity '${entityId}': '${fieldName}' must be a string, got ${typeof isoString}`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || !isoString.includes('T')) {
    throw new StorageCorruptionError(
      `Corrupted persisted entity '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function parseJsonField(jsonStr: string, fieldName: string, entityId: string): unknown {
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new StorageCorruptionError(
      `Corrupted persisted entity '${entityId}': '${fieldName}' contains invalid JSON`,
      { cause: err },
    );
  }
}

function rehydrateResolvedPrice(rawJson: string, entityId: string): ResolvedPrice {
  const parsed = parseJsonField(rawJson, 'price', entityId);
  if (!isRecord(parsed)) {
    throw new StorageCorruptionError(`Corrupted price object in observation '${entityId}'`);
  }

  // 1. rawText: required non-empty string
  if (!('rawText' in parsed)) {
    throw new StorageCorruptionError(`Missing price.rawText in observation '${entityId}'`);
  }
  const rawText = parsed['rawText'];
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new StorageCorruptionError(`Corrupted price.rawText in observation '${entityId}'`);
  }

  // 2. amount: required in persisted JSON, must be null OR finite non-negative integer
  if (!('amount' in parsed)) {
    throw new StorageCorruptionError(`Missing price.amount in observation '${entityId}'`);
  }
  const amountVal = parsed['amount'];
  if (amountVal !== null) {
    if (
      typeof amountVal !== 'number' ||
      !Number.isInteger(amountVal) ||
      amountVal < 0 ||
      !Number.isFinite(amountVal)
    ) {
      throw new StorageCorruptionError(
        `Corrupted price.amount in observation '${entityId}': expected null or non-negative integer, got ${JSON.stringify(amountVal)}`,
      );
    }
  }
  const amount = amountVal;

  // 3. currency: required valid enum
  if (!('currency' in parsed)) {
    throw new StorageCorruptionError(`Missing price.currency in observation '${entityId}'`);
  }
  const currency = parsed['currency'];
  if (typeof currency !== 'string' || !VALID_CURRENCIES.has(currency as PriceCurrency)) {
    throw new StorageCorruptionError(
      `Corrupted price.currency in observation '${entityId}': got ${JSON.stringify(currency)}`,
    );
  }

  // 4. resolution: required valid enum
  if (!('resolution' in parsed)) {
    throw new StorageCorruptionError(`Missing price.resolution in observation '${entityId}'`);
  }
  const resolution = parsed['resolution'];
  if (typeof resolution !== 'string' || !VALID_RESOLUTIONS.has(resolution as PriceResolution)) {
    throw new StorageCorruptionError(
      `Corrupted price.resolution in observation '${entityId}': got ${JSON.stringify(resolution)}`,
    );
  }

  // 5. confidence: required finite number in [0, 1]
  if (!('confidence' in parsed)) {
    throw new StorageCorruptionError(`Missing price.confidence in observation '${entityId}'`);
  }
  const confidence = parsed['confidence'];
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new StorageCorruptionError(
      `Corrupted price.confidence in observation '${entityId}': expected [0, 1], got ${String(confidence)}`,
    );
  }

  // 6. evidence: required array of strings
  if (!('evidence' in parsed)) {
    throw new StorageCorruptionError(`Missing price.evidence in observation '${entityId}'`);
  }
  const rawEvidence = parsed['evidence'];
  if (!Array.isArray(rawEvidence) || !rawEvidence.every((e) => typeof e === 'string')) {
    throw new StorageCorruptionError(`Corrupted price.evidence in observation '${entityId}'`);
  }
  const evidence: readonly string[] = rawEvidence;

  // 7. kind: required valid enum
  if (!('kind' in parsed)) {
    throw new StorageCorruptionError(`Missing price.kind in observation '${entityId}'`);
  }
  const rawKind = parsed['kind'];
  if (typeof rawKind !== 'string' || !VALID_PRICE_KINDS.has(rawKind as PriceKind)) {
    throw new StorageCorruptionError(
      `Corrupted price.kind in observation '${entityId}': got ${JSON.stringify(rawKind)}`,
    );
  }
  const kind = rawKind as PriceKind;

  // 8. converted: optional, but if present must be strictly valid
  let converted: ConvertedPrice | undefined = undefined;
  if ('converted' in parsed && parsed['converted'] !== undefined && parsed['converted'] !== null) {
    const rawConverted = parsed['converted'];
    if (!isRecord(rawConverted)) {
      throw new StorageCorruptionError(`Corrupted price.converted in observation '${entityId}'`);
    }
    if (rawConverted['currency'] !== 'ARS') {
      throw new StorageCorruptionError(
        `Corrupted price.converted.currency in observation '${entityId}': expected 'ARS', got ${JSON.stringify(rawConverted['currency'])}`,
      );
    }
    const convAmount = rawConverted['amount'];
    if (
      typeof convAmount !== 'number' ||
      !Number.isInteger(convAmount) ||
      convAmount < 0 ||
      !Number.isFinite(convAmount)
    ) {
      throw new StorageCorruptionError(
        `Corrupted price.converted.amount in observation '${entityId}'`,
      );
    }

    const convRate = rawConverted['exchangeRate'];
    if (typeof convRate !== 'number' || !Number.isFinite(convRate) || convRate <= 0) {
      throw new StorageCorruptionError(
        `Corrupted price.converted.exchangeRate in observation '${entityId}': expected finite > 0`,
      );
    }

    const convOrigin = rawConverted['exchangeRateOrigin'];
    if (convOrigin !== 'MANUAL') {
      throw new StorageCorruptionError(
        `Corrupted price.converted.exchangeRateOrigin in observation '${entityId}': expected 'MANUAL'`,
      );
    }

    const convAt = rawConverted['convertedAt'];
    if (typeof convAt !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted price.converted.convertedAt in observation '${entityId}'`,
      );
    }

    converted = {
      amount: convAmount,
      currency: 'ARS',
      exchangeRate: convRate,
      exchangeRateOrigin: 'MANUAL',
      convertedAt: parseIsoDate(convAt, 'converted.convertedAt', entityId),
    };
  }

  return createResolvedPrice({
    rawText,
    amount,
    currency: currency as PriceCurrency,
    resolution: resolution as PriceResolution,
    confidence,
    evidence,
    kind,
    ...(converted !== undefined ? { converted } : {}),
  });
}

function rehydrateResolvedLocation(rawJson: string, entityId: string): ResolvedLocation {
  const parsed = parseJsonField(rawJson, 'location', entityId);
  if (!isRecord(parsed)) {
    throw new StorageCorruptionError(`Corrupted location object in observation '${entityId}'`);
  }

  const rawText = parsed['rawText'];
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new StorageCorruptionError(`Corrupted location.rawText in observation '${entityId}'`);
  }

  let region: string | undefined = undefined;
  if ('region' in parsed && parsed['region'] !== undefined && parsed['region'] !== null) {
    if (typeof parsed['region'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted location.region in observation '${entityId}': expected string, got ${typeof parsed['region']}`,
      );
    }
    region = parsed['region'];
  }

  let city: string | undefined = undefined;
  if ('city' in parsed && parsed['city'] !== undefined && parsed['city'] !== null) {
    if (typeof parsed['city'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted location.city in observation '${entityId}': expected string, got ${typeof parsed['city']}`,
      );
    }
    city = parsed['city'];
  }

  let neighborhood: string | undefined = undefined;
  if (
    'neighborhood' in parsed &&
    parsed['neighborhood'] !== undefined &&
    parsed['neighborhood'] !== null
  ) {
    if (typeof parsed['neighborhood'] !== 'string') {
      throw new StorageCorruptionError(
        `Corrupted location.neighborhood in observation '${entityId}': expected string, got ${typeof parsed['neighborhood']}`,
      );
    }
    neighborhood = parsed['neighborhood'];
  }

  let coordinates: { readonly latitude: number; readonly longitude: number } | undefined =
    undefined;
  if (
    'coordinates' in parsed &&
    parsed['coordinates'] !== undefined &&
    parsed['coordinates'] !== null
  ) {
    const rawCoords = parsed['coordinates'];
    if (!isRecord(rawCoords)) {
      throw new StorageCorruptionError(
        `Corrupted location.coordinates in observation '${entityId}': expected object`,
      );
    }
    const lat = rawCoords['latitude'];
    const lon = rawCoords['longitude'];
    if (
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof lon !== 'number' ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      throw new StorageCorruptionError(
        `Corrupted location.coordinates numbers in observation '${entityId}'`,
      );
    }
    coordinates = { latitude: lat, longitude: lon };
  }

  return {
    rawText,
    ...(region !== undefined ? { region } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(neighborhood !== undefined ? { neighborhood } : {}),
    ...(coordinates !== undefined ? { coordinates } : {}),
  };
}

function rehydrateImageUrls(rawJson: string, entityId: string): readonly string[] {
  const parsed = parseJsonField(rawJson, 'image_urls', entityId);
  if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === 'string')) {
    throw new StorageCorruptionError(
      `Corrupted persisted Observation '${entityId}': 'image_urls' must be a JSON array of strings`,
    );
  }
  return parsed;
}

function rehydrateObservation(row: ObservationRow): Observation {
  try {
    const observedAt = parseIsoDate(row.observed_at, 'observed_at', row.id);
    const publishedAt =
      row.published_at !== null ? parseIsoDate(row.published_at, 'published_at', row.id) : null;

    let price: ResolvedPrice | null = null;
    if (row.price !== null) {
      price = rehydrateResolvedPrice(row.price, row.id);
    }

    let location: ResolvedLocation | null = null;
    if (row.location !== null) {
      location = rehydrateResolvedLocation(row.location, row.id);
    }

    let condition: ListingCondition | null = null;
    if (row.condition !== null) {
      if (!VALID_CONDITIONS.has(row.condition as ListingCondition)) {
        throw new StorageCorruptionError(
          `Corrupted persisted Observation '${row.id}': invalid condition '${row.condition}'`,
        );
      }
      condition = row.condition as ListingCondition;
    }

    if (!VALID_AVAILABILITIES.has(row.availability as Availability)) {
      throw new StorageCorruptionError(
        `Corrupted persisted Observation '${row.id}': invalid availability '${row.availability}'`,
      );
    }
    const availability = row.availability as Availability;

    const imageUrls = rehydrateImageUrls(row.image_urls, row.id);

    const params: CreateObservationParams = {
      id: row.id,
      listingId: row.listing_id,
      sourceRunId: row.source_run_id,
      observedAt,
      title: row.title,
      description: row.description,
      price,
      location,
      condition,
      availability,
      imageUrls,
      publishedAt,
      rawFingerprint: row.raw_fingerprint,
    };

    return createObservation(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Observation '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// Semantic equality used EXCLUSIVELY for changeKind = PRICE_CHANGED vs UNCHANGED
function arePricesSemanticallyEqual(a: ResolvedPrice | null, b: ResolvedPrice | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return (
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.kind === b.kind &&
    (a.amount !== null || a.rawText === b.rawText)
  );
}

// Full semantic equality for ResolvedPrice in immutability verification
function arePricesFullyIdentical(a: ResolvedPrice | null, b: ResolvedPrice | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (
    a.rawText !== b.rawText ||
    a.amount !== b.amount ||
    a.currency !== b.currency ||
    a.resolution !== b.resolution ||
    a.confidence !== b.confidence ||
    a.kind !== b.kind ||
    a.evidence.length !== b.evidence.length ||
    !a.evidence.every((ev, i) => ev === b.evidence[i])
  ) {
    return false;
  }
  if (a.converted === undefined && b.converted === undefined) return true;
  if (a.converted === undefined || b.converted === undefined) return false;
  return (
    a.converted.amount === b.converted.amount &&
    a.converted.currency === b.converted.currency &&
    a.converted.exchangeRate === b.converted.exchangeRate &&
    a.converted.exchangeRateOrigin === b.converted.exchangeRateOrigin &&
    a.converted.convertedAt.getTime() === b.converted.convertedAt.getTime()
  );
}

// Full semantic equality for ResolvedLocation in immutability verification
function areLocationsFullyIdentical(
  a: ResolvedLocation | null,
  b: ResolvedLocation | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (
    a.rawText !== b.rawText ||
    a.region !== b.region ||
    a.city !== b.city ||
    a.neighborhood !== b.neighborhood
  ) {
    return false;
  }
  if (a.coordinates === undefined && b.coordinates === undefined) return true;
  if (a.coordinates === undefined || b.coordinates === undefined) return false;
  return (
    a.coordinates.latitude === b.coordinates.latitude &&
    a.coordinates.longitude === b.coordinates.longitude
  );
}

// Complete semantic equality for Observation immutability verification (Finding 2)
function areObservationsFullyIdentical(incoming: Observation, persisted: Observation): boolean {
  return (
    incoming.id === persisted.id &&
    incoming.listingId === persisted.listingId &&
    incoming.sourceRunId === persisted.sourceRunId &&
    incoming.observedAt.getTime() === persisted.observedAt.getTime() &&
    incoming.title === persisted.title &&
    incoming.description === persisted.description &&
    arePricesFullyIdentical(incoming.price, persisted.price) &&
    areLocationsFullyIdentical(incoming.location, persisted.location) &&
    incoming.condition === persisted.condition &&
    incoming.availability === persisted.availability &&
    incoming.imageUrls.length === persisted.imageUrls.length &&
    incoming.imageUrls.every((url, i) => url === persisted.imageUrls[i]) &&
    (incoming.publishedAt === null
      ? persisted.publishedAt === null
      : persisted.publishedAt !== null &&
        incoming.publishedAt.getTime() === persisted.publishedAt.getTime()) &&
    incoming.rawFingerprint === persisted.rawFingerprint
  );
}

function isSqliteBusyError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('sqlite_busy') || msg.includes('database is locked') || msg.includes('busy')
    );
  }
  return false;
}

export class SqliteObservationRepository implements ObservationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Observation | null> {
    try {
      const stmt = this.db.prepare<ObservationRow, [string]>(
        `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
         FROM observations
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateObservation(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listByListingId(listingId: string): Promise<readonly Observation[]> {
    try {
      const stmt = this.db.prepare<ObservationRow, [string]>(
        `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
         FROM observations
         WHERE listing_id = ?
         ORDER BY observed_at ASC, id ASC`,
      );
      const rows = stmt.all(listingId);
      return Promise.resolve(rows.map(rehydrateObservation));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(observation: Observation): Promise<void> {
    try {
      this.db.transaction((tx) => {
        // 1. Check if observation already exists with this PK id
        const existingByIdStmt = tx.prepare<ObservationRow, [string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE id = ?`,
        );
        const existingByIdRow = existingByIdStmt.get(observation.id);

        if (existingByIdRow) {
          const persistedObs = rehydrateObservation(existingByIdRow);
          if (areObservationsFullyIdentical(observation, persistedObs)) {
            // Idempotent save of identical observation
            return;
          }
          throw new ObservationIdentityCollisionError({
            observationId: observation.id,
            listingId: existingByIdRow.listing_id,
            sourceRunId: existingByIdRow.source_run_id,
          });
        }

        // 2. Check if observation exists within the same source run and fingerprint
        const existingByRunFingerprintStmt = tx.prepare<ObservationRow, [string, string, string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE listing_id = ? AND source_run_id = ? AND raw_fingerprint = ?`,
        );
        const existingByRunRow = existingByRunFingerprintStmt.get(
          observation.listingId,
          observation.sourceRunId,
          observation.rawFingerprint,
        );

        if (existingByRunRow) {
          if (existingByRunRow.id === observation.id) {
            return;
          }
          const existingObs = rehydrateObservation(existingByRunRow);
          const incomingPayload = buildCanonicalObservationPayload(observation);
          const existingPayload = buildCanonicalObservationPayload(existingObs);
          if (incomingPayload !== existingPayload) {
            throw new ObservationFingerprintCollisionError({
              observationId: observation.id,
              listingId: existingByRunRow.listing_id,
              sourceRunId: existingByRunRow.source_run_id,
              fingerprint: observation.rawFingerprint,
            });
          }
          throw new ObservationIdentityCollisionError({
            observationId: observation.id,
            listingId: existingByRunRow.listing_id,
            sourceRunId: existingByRunRow.source_run_id,
          });
        }

        // 3. Insert new observation
        const insertStmt = tx.prepare(
          `INSERT INTO observations (
            id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        insertStmt.run(
          observation.id,
          observation.listingId,
          observation.sourceRunId,
          observation.observedAt.toISOString(),
          observation.title,
          observation.description,
          observation.price ? JSON.stringify(observation.price) : null,
          observation.location ? JSON.stringify(observation.location) : null,
          observation.condition,
          observation.availability,
          JSON.stringify(observation.imageUrls),
          observation.publishedAt ? observation.publishedAt.toISOString() : null,
          observation.rawFingerprint,
        );
      }, 'IMMEDIATE');

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  recordObservation(params: RecordObservationParams): Promise<RecordObservationResult> {
    // 0. Pre-transaction Coherence Check: incoming listing.id must match observation.listingId
    if (params.observation.listingId !== params.listing.id) {
      return Promise.reject(
        new RecordObservationCoherenceError({
          kind: 'LISTING_ID_MISMATCH',
          listingId: params.listing.id,
          observationListingId: params.observation.listingId,
        }),
      );
    }

    const maxAttempts = 5;
    let attempt = 0;

    const executeTransaction = (): RecordObservationResult => {
      let result!: RecordObservationResult;

      this.db.transaction((tx) => {
        const incomingListing = params.listing;
        const incomingObs = params.observation;

        // 0b. SourceRun Coherence Check: sourceRun must exist and source_id must match listing.sourceId
        const findSourceRunStmt = tx.prepare<SourceRunRow, [string]>(
          `SELECT source_id FROM source_runs WHERE id = ?`,
        );
        const sourceRunRow = findSourceRunStmt.get(incomingObs.sourceRunId);
        if (!sourceRunRow) {
          throw new RecordObservationCoherenceError({
            kind: 'SOURCE_RUN_NOT_FOUND',
            sourceRunId: incomingObs.sourceRunId,
          });
        }
        if (sourceRunRow.source_id !== incomingListing.sourceId) {
          throw new RecordObservationCoherenceError({
            kind: 'SOURCE_ID_MISMATCH',
            listingSourceId: incomingListing.sourceId,
            sourceRunSourceId: sourceRunRow.source_id,
          });
        }

        // 1. Resolve or update Listing
        const findListingStmt = tx.prepare<ListingRow, [string, string]>(
          `SELECT id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
           FROM listings
           WHERE source_id = ? AND external_id = ?`,
        );
        let existingListingRow = findListingStmt.get(
          incomingListing.sourceId,
          incomingListing.externalId,
        );

        let effectiveListing: Listing;

        if (existingListingRow) {
          // Check for fallback collision: if fallback identity has conflicting canonical_url
          if (
            isFallbackExternalId(incomingListing.externalId) &&
            existingListingRow.canonical_url !== incomingListing.canonicalUrl
          ) {
            throw new ListingIdentityCollisionError({
              sourceId: incomingListing.sourceId,
              externalId: incomingListing.externalId,
              existingId: existingListingRow.id,
              attemptingId: incomingListing.id,
            });
          }

          const existingFirstSeen = parseIsoDate(
            existingListingRow.first_seen_at,
            'first_seen_at',
            existingListingRow.id,
          );
          const existingLastSeen = parseIsoDate(
            existingListingRow.last_seen_at,
            'last_seen_at',
            existingListingRow.id,
          );

          const earliestFirstSeen =
            incomingListing.firstSeenAt.getTime() < existingFirstSeen.getTime()
              ? incomingListing.firstSeenAt
              : existingFirstSeen;

          const latestLastSeen =
            incomingListing.lastSeenAt.getTime() > existingLastSeen.getTime()
              ? incomingListing.lastSeenAt
              : existingLastSeen;

          const updateListingStmt = tx.prepare(
            `UPDATE listings
             SET canonical_url = ?, first_seen_at = ?, last_seen_at = ?
             WHERE id = ?`,
          );
          updateListingStmt.run(
            incomingListing.canonicalUrl,
            earliestFirstSeen.toISOString(),
            latestLastSeen.toISOString(),
            existingListingRow.id,
          );

          effectiveListing = createListing({
            id: existingListingRow.id,
            sourceId: existingListingRow.source_id,
            externalId: existingListingRow.external_id,
            canonicalUrl: incomingListing.canonicalUrl,
            firstSeenAt: earliestFirstSeen,
            lastSeenAt: latestLastSeen,
          });
        } else {
          // Check if PK id already exists under different keys
          const existingByIdStmt = tx.prepare<{ id: string }, [string]>(
            `SELECT id FROM listings WHERE id = ?`,
          );
          const existingById = existingByIdStmt.get(incomingListing.id);
          if (existingById) {
            throw new ListingIdentityCollisionError({
              sourceId: incomingListing.sourceId,
              externalId: incomingListing.externalId,
              existingId: existingById.id,
              attemptingId: incomingListing.id,
            });
          }

          const insertListingStmt = tx.prepare(
            `INSERT INTO listings (
              id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          );

          try {
            insertListingStmt.run(
              incomingListing.id,
              incomingListing.sourceId,
              incomingListing.externalId,
              incomingListing.canonicalUrl,
              incomingListing.firstSeenAt.toISOString(),
              incomingListing.lastSeenAt.toISOString(),
            );
            effectiveListing = incomingListing;
          } catch (insertErr) {
            // Handle concurrent insert race on uq_listings_source_external
            existingListingRow = findListingStmt.get(
              incomingListing.sourceId,
              incomingListing.externalId,
            );
            if (!existingListingRow) {
              throw insertErr;
            }
            // Fallback collision check on concurrently inserted row
            if (
              isFallbackExternalId(incomingListing.externalId) &&
              existingListingRow.canonical_url !== incomingListing.canonicalUrl
            ) {
              throw new ListingIdentityCollisionError({
                sourceId: incomingListing.sourceId,
                externalId: incomingListing.externalId,
                existingId: existingListingRow.id,
                attemptingId: incomingListing.id,
              });
            }
            effectiveListing = createListing({
              id: existingListingRow.id,
              sourceId: existingListingRow.source_id,
              externalId: existingListingRow.external_id,
              canonicalUrl: incomingListing.canonicalUrl,
              firstSeenAt: parseIsoDate(
                existingListingRow.first_seen_at,
                'first_seen_at',
                existingListingRow.id,
              ),
              lastSeenAt: parseIsoDate(
                existingListingRow.last_seen_at,
                'last_seen_at',
                existingListingRow.id,
              ),
            });
          }
        }

        // 2. Check if an Observation with incomingObs.id already exists
        const checkExistingObsByIdStmt = tx.prepare<ObservationRow, [string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE id = ?`,
        );
        const existingObsByIdRow = checkExistingObsByIdStmt.get(incomingObs.id);
        if (existingObsByIdRow) {
          const persistedObs = rehydrateObservation(existingObsByIdRow);
          if (!areObservationsFullyIdentical(incomingObs, persistedObs)) {
            throw new ObservationIdentityCollisionError({
              observationId: incomingObs.id,
              listingId: existingObsByIdRow.listing_id,
              sourceRunId: existingObsByIdRow.source_run_id,
            });
          }
        }

        // 3. Query previous latest Observation for effectiveListing.id
        const findLatestObsStmt = tx.prepare<ObservationRow, [string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE listing_id = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT 1`,
        );
        const latestObsRow = findLatestObsStmt.get(effectiveListing.id);

        // 4. Determine novelty / change classification
        let changeKind: ObservationChangeKind;
        let latestObs: Observation | null = null;

        if (!latestObsRow) {
          changeKind = 'NEW';
        } else {
          latestObs = rehydrateObservation(latestObsRow);

          // Priority 1: REAPPEARED
          const wasGone = latestObs.availability === 'SOLD' || latestObs.availability === 'REMOVED';
          const isNowBack =
            incomingObs.availability === 'AVAILABLE' || incomingObs.availability === 'PENDING';

          if (wasGone && isNowBack) {
            changeKind = 'REAPPEARED';
          } else if (!arePricesSemanticallyEqual(latestObs.price, incomingObs.price)) {
            // Priority 2: PRICE_CHANGED
            changeKind = 'PRICE_CHANGED';
          } else {
            // Priority 3: UNCHANGED (no price change, no reappearance, not new)
            changeKind = 'UNCHANGED';
          }
        }

        // 5. Observation deduplication check within same run
        const findExistingInRunStmt = tx.prepare<ObservationRow, [string, string, string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE listing_id = ? AND source_run_id = ? AND raw_fingerprint = ?`,
        );
        const existingInRunRow = findExistingInRunStmt.get(
          effectiveListing.id,
          incomingObs.sourceRunId,
          incomingObs.rawFingerprint,
        );

        if (existingInRunRow) {
          const existingObs = rehydrateObservation(existingInRunRow);
          const incomingPayload = buildCanonicalObservationPayload(incomingObs);
          const existingPayload = buildCanonicalObservationPayload(existingObs);

          if (incomingPayload === existingPayload) {
            // Exact dedup: identical fingerprint and identical semantic payload within same run
            result = {
              listing: effectiveListing,
              observation: existingObs,
              changeKind,
              isNewObservation: false,
            };
            return;
          }

          // Fingerprint Collision (Finding 3): same fingerprint but differing semantic payload!
          throw new ObservationFingerprintCollisionError({
            observationId: incomingObs.id,
            listingId: effectiveListing.id,
            sourceRunId: incomingObs.sourceRunId,
            fingerprint: incomingObs.rawFingerprint,
          });
        }

        // 6. Insert new Observation row pointing to effectiveListing.id
        const observationToInsert: Observation =
          incomingObs.listingId === effectiveListing.id
            ? incomingObs
            : createObservation({
                id: incomingObs.id,
                listingId: effectiveListing.id,
                sourceRunId: incomingObs.sourceRunId,
                observedAt: incomingObs.observedAt,
                title: incomingObs.title,
                description: incomingObs.description,
                price: incomingObs.price,
                location: incomingObs.location,
                condition: incomingObs.condition,
                availability: incomingObs.availability,
                imageUrls: incomingObs.imageUrls,
                publishedAt: incomingObs.publishedAt,
                rawFingerprint: incomingObs.rawFingerprint,
              });

        const insertObsStmt = tx.prepare(
          `INSERT INTO observations (
            id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        insertObsStmt.run(
          observationToInsert.id,
          observationToInsert.listingId,
          observationToInsert.sourceRunId,
          observationToInsert.observedAt.toISOString(),
          observationToInsert.title,
          observationToInsert.description,
          observationToInsert.price ? JSON.stringify(observationToInsert.price) : null,
          observationToInsert.location ? JSON.stringify(observationToInsert.location) : null,
          observationToInsert.condition,
          observationToInsert.availability,
          JSON.stringify(observationToInsert.imageUrls),
          observationToInsert.publishedAt ? observationToInsert.publishedAt.toISOString() : null,
          observationToInsert.rawFingerprint,
        );

        result = {
          listing: effectiveListing,
          observation: observationToInsert,
          changeKind,
          isNewObservation: true,
        };
      }, 'IMMEDIATE');

      return result;
    };

    while (attempt < maxAttempts) {
      try {
        const res = executeTransaction();
        return Promise.resolve(res);
      } catch (err) {
        if (isSqliteBusyError(err) && attempt < maxAttempts - 1) {
          attempt++;
          // synchronous small delay before retry
          const start = Date.now();
          const delayMs = 10 * attempt + Math.floor(Math.random() * 20);
          while (Date.now() - start < delayMs) {
            // busy wait
          }
          continue;
        }
        return Promise.reject(toError(err));
      }
    }

    return Promise.reject(new Error('Exceeded maximum retry attempts for SQLITE_BUSY'));
  }
}
