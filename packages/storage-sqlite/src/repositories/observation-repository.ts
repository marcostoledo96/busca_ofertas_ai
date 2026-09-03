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
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  ObservationIdentityCollisionError,
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
  if (Number.isNaN(date.getTime())) {
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

  const rawText = parsed['rawText'];
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new StorageCorruptionError(`Corrupted price.rawText in observation '${entityId}'`);
  }

  const currency = parsed['currency'];
  if (typeof currency !== 'string' || !VALID_CURRENCIES.has(currency as PriceCurrency)) {
    throw new StorageCorruptionError(`Corrupted price.currency in observation '${entityId}'`);
  }

  const resolution = parsed['resolution'];
  if (typeof resolution !== 'string' || !VALID_RESOLUTIONS.has(resolution as PriceResolution)) {
    throw new StorageCorruptionError(`Corrupted price.resolution in observation '${entityId}'`);
  }

  const confidence = parsed['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    throw new StorageCorruptionError(`Corrupted price.confidence in observation '${entityId}'`);
  }

  const rawEvidence = parsed['evidence'];
  if (!Array.isArray(rawEvidence) || !rawEvidence.every((e) => typeof e === 'string')) {
    throw new StorageCorruptionError(`Corrupted price.evidence in observation '${entityId}'`);
  }
  const evidence: readonly string[] = rawEvidence;

  const amountVal = parsed['amount'];
  const amount = typeof amountVal === 'number' && Number.isFinite(amountVal) ? amountVal : null;

  const rawKind = parsed['kind'];
  const kind: PriceKind =
    typeof rawKind === 'string' && VALID_PRICE_KINDS.has(rawKind as PriceKind)
      ? (rawKind as PriceKind)
      : 'UNKNOWN';

  let converted: ConvertedPrice | undefined = undefined;
  const rawConverted = parsed['converted'];
  if (rawConverted !== undefined && rawConverted !== null) {
    if (!isRecord(rawConverted) || rawConverted['currency'] !== 'ARS') {
      throw new StorageCorruptionError(`Corrupted price.converted in observation '${entityId}'`);
    }
    const convAmount = rawConverted['amount'];
    const convRate = rawConverted['exchangeRate'];
    const convOrigin = rawConverted['exchangeRateOrigin'];
    const convAt = rawConverted['convertedAt'];

    if (
      typeof convAmount !== 'number' ||
      typeof convRate !== 'number' ||
      convOrigin !== 'MANUAL' ||
      typeof convAt !== 'string'
    ) {
      throw new StorageCorruptionError(
        `Corrupted price.converted details in observation '${entityId}'`,
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

  const region = typeof parsed['region'] === 'string' ? parsed['region'] : undefined;
  const city = typeof parsed['city'] === 'string' ? parsed['city'] : undefined;
  const neighborhood =
    typeof parsed['neighborhood'] === 'string' ? parsed['neighborhood'] : undefined;

  let coordinates: { readonly latitude: number; readonly longitude: number } | undefined =
    undefined;
  const rawCoords = parsed['coordinates'];
  if (rawCoords !== undefined && rawCoords !== null) {
    if (!isRecord(rawCoords)) {
      throw new StorageCorruptionError(
        `Corrupted location.coordinates in observation '${entityId}'`,
      );
    }
    const lat = rawCoords['latitude'];
    const lon = rawCoords['longitude'];
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      throw new StorageCorruptionError(
        `Corrupted coordinates numbers in observation '${entityId}'`,
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

function areObservationsIdentical(a: Observation, row: ObservationRow): boolean {
  const b = rehydrateObservation(row);
  return (
    a.id === b.id &&
    a.listingId === b.listingId &&
    a.sourceRunId === b.sourceRunId &&
    a.observedAt.getTime() === b.observedAt.getTime() &&
    a.title === b.title &&
    a.description === b.description &&
    arePricesSemanticallyEqual(a.price, b.price) &&
    JSON.stringify(a.location) === JSON.stringify(b.location) &&
    a.condition === b.condition &&
    a.availability === b.availability &&
    JSON.stringify(a.imageUrls) === JSON.stringify(b.imageUrls) &&
    (a.publishedAt === null
      ? b.publishedAt === null
      : a.publishedAt?.getTime() === b.publishedAt?.getTime()) &&
    a.rawFingerprint === b.rawFingerprint
  );
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
        const existingById = existingByIdStmt.get(observation.id);

        if (existingById) {
          if (areObservationsIdentical(observation, existingById)) {
            // Idempotent save of identical observation
            return;
          }
          throw new ObservationIdentityCollisionError({
            observationId: observation.id,
            listingId: existingById.listing_id,
            sourceRunId: existingById.source_run_id,
          });
        }

        // 2. Check if identical observation exists within the same source run
        const existingByRunFingerprintStmt = tx.prepare<ObservationRow, [string, string, string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE listing_id = ? AND source_run_id = ? AND raw_fingerprint = ?`,
        );
        const existingByRun = existingByRunFingerprintStmt.get(
          observation.listingId,
          observation.sourceRunId,
          observation.rawFingerprint,
        );

        if (existingByRun) {
          if (existingByRun.id === observation.id) {
            return;
          }
          throw new ObservationIdentityCollisionError({
            observationId: observation.id,
            listingId: existingByRun.listing_id,
            sourceRunId: existingByRun.source_run_id,
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
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  recordObservation(params: RecordObservationParams): Promise<RecordObservationResult> {
    try {
      let result!: RecordObservationResult;

      this.db.transaction((tx) => {
        const incomingListing = params.listing;
        const incomingObs = params.observation;

        // 1. Resolve or update Listing
        const findListingStmt = tx.prepare<ListingRow, [string, string]>(
          `SELECT id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
           FROM listings
           WHERE source_id = ? AND external_id = ?`,
        );
        const existingListingRow = findListingStmt.get(
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
          insertListingStmt.run(
            incomingListing.id,
            incomingListing.sourceId,
            incomingListing.externalId,
            incomingListing.canonicalUrl,
            incomingListing.firstSeenAt.toISOString(),
            incomingListing.lastSeenAt.toISOString(),
          );

          effectiveListing = incomingListing;
        }

        // 2. Query previous latest Observation for effectiveListing.id
        const findLatestObsStmt = tx.prepare<ObservationRow, [string]>(
          `SELECT id, listing_id, source_run_id, observed_at, title, description, price, location, condition, availability, image_urls, published_at, raw_fingerprint
           FROM observations
           WHERE listing_id = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT 1`,
        );
        const latestObsRow = findLatestObsStmt.get(effectiveListing.id);

        // 3. Determine novelty / change classification
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

        // 4. Observation deduplication check within same run
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
          // Identical observation in the same run -> deduplicate without inserting new row
          const existingObs = rehydrateObservation(existingInRunRow);
          result = {
            listing: effectiveListing,
            observation: existingObs,
            changeKind,
            isNewObservation: false,
          };
          return;
        }

        // 5. Insert new Observation row
        // Ensure the observation points to effectiveListing.id
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
      });

      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
