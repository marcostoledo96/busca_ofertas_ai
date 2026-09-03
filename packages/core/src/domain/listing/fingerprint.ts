import { InvariantViolationError } from '../common/index.js';
import type { Hasher } from '../common/hasher.js';
import type { ResolvedPrice } from '../price/resolved-price.js';
import type { ListingCondition, Availability, ResolvedLocation } from './types.js';

export interface ObservationFingerprintParams {
  readonly title: string;
  readonly description?: string | null;
  readonly price?: ResolvedPrice | null;
  readonly location?: ResolvedLocation | null;
  readonly condition?: ListingCondition | null;
  readonly availability?: Availability;
  readonly imageUrls?: readonly string[];
  readonly publishedAt?: Date | null;
}

function normalizeWhitespace(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

export function buildCanonicalObservationPayload(params: ObservationFingerprintParams): string {
  if (typeof params.title !== 'string' || params.title.trim().length === 0) {
    throw new InvariantViolationError(
      'Cannot compute fingerprint for observation without a valid title',
    );
  }

  // 1. Title
  const title = normalizeWhitespace(params.title);

  // 2. Description (null if null or empty)
  const description =
    params.description !== undefined &&
    params.description !== null &&
    params.description.trim().length > 0
      ? params.description.trim()
      : null;

  // 3. Price (amount, currency, kind)
  let price: { amount: number | null; currency: string; kind: string } | null = null;
  if (params.price) {
    price = {
      amount: params.price.amount,
      currency: params.price.currency,
      kind: params.price.kind,
    };
  }

  // 4. Location
  let location: {
    city: string | null;
    coordinates: { latitude: number; longitude: number } | null;
    neighborhood: string | null;
    rawText: string;
    region: string | null;
  } | null = null;

  if (params.location) {
    let coordinates: { latitude: number; longitude: number } | null = null;
    if (params.location.coordinates) {
      coordinates = {
        latitude: Math.round(params.location.coordinates.latitude * 100000) / 100000,
        longitude: Math.round(params.location.coordinates.longitude * 100000) / 100000,
      };
    }

    location = {
      city: params.location.city ? params.location.city.trim() : null,
      coordinates,
      neighborhood: params.location.neighborhood ? params.location.neighborhood.trim() : null,
      rawText: params.location.rawText.trim(),
      region: params.location.region ? params.location.region.trim() : null,
    };
  }

  // 5. Condition
  const condition: string | null = params.condition ?? null;

  // 6. Availability
  const availability: string = params.availability ?? 'UNKNOWN';

  // 7. Image URLs: trimmed, unique, deterministically sorted
  const rawImageUrls = params.imageUrls ?? [];
  const imageUrls = Array.from(
    new Set(rawImageUrls.map((url) => url.trim()).filter((url) => url.length > 0)),
  ).sort((a, b) => a.localeCompare(b));

  // 8. Published at: ISO UTC string or null
  let publishedAt: string | null = null;
  if (params.publishedAt instanceof Date && !Number.isNaN(params.publishedAt.getTime())) {
    publishedAt = params.publishedAt.toISOString();
  }

  // Deterministic JSON structure with fixed alphabetical keys
  const canonicalObject = {
    availability,
    condition,
    description,
    imageUrls,
    location,
    price,
    publishedAt,
    title,
  };

  return JSON.stringify(canonicalObject);
}

export function computeObservationFingerprint(
  params: ObservationFingerprintParams,
  hasher: Hasher,
): string {
  if (!hasher || typeof hasher.hash !== 'function') {
    throw new InvariantViolationError(
      'A valid Hasher must be provided to compute observation fingerprint',
    );
  }

  const payload = buildCanonicalObservationPayload(params);
  const hash = hasher.hash(payload);
  if (typeof hash !== 'string' || hash.trim().length === 0) {
    throw new InvariantViolationError('Hasher returned an empty hash for observation fingerprint');
  }

  return hash.trim();
}
