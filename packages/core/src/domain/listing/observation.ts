import { InvariantViolationError } from '../common/index.js';
import { ResolvedPrice } from '../price/resolved-price.js';
import { ListingCondition, Availability, ResolvedLocation } from './types.js';

export interface Observation {
  readonly id: string;
  readonly listingId: string;
  readonly sourceRunId: string;
  readonly observedAt: Date;
  readonly title: string;
  readonly description: string | null;
  readonly price: ResolvedPrice | null;
  readonly location: ResolvedLocation | null;
  readonly condition: ListingCondition | null;
  readonly availability: Availability;
  readonly imageUrls: readonly string[];
  readonly publishedAt: Date | null;
  readonly rawFingerprint: string;
}

export interface CreateObservationParams {
  readonly id: string;
  readonly listingId: string;
  readonly sourceRunId: string;
  readonly observedAt: Date;
  readonly title: string;
  readonly description?: string | null;
  readonly price?: ResolvedPrice | null;
  readonly location?: ResolvedLocation | null;
  readonly condition?: ListingCondition | null;
  readonly availability?: Availability;
  readonly imageUrls?: readonly string[];
  readonly publishedAt?: Date | null;
  readonly rawFingerprint: string;
}

export const createObservation = (params: CreateObservationParams): Observation => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Observation id cannot be empty');
  }
  if (typeof params.listingId !== 'string' || params.listingId.trim().length === 0) {
    throw new InvariantViolationError('Observation listingId cannot be empty');
  }
  if (typeof params.sourceRunId !== 'string' || params.sourceRunId.trim().length === 0) {
    throw new InvariantViolationError('Observation sourceRunId cannot be empty');
  }
  if (typeof params.title !== 'string' || params.title.trim().length === 0) {
    throw new InvariantViolationError('Observation title cannot be empty');
  }
  if (typeof params.rawFingerprint !== 'string' || params.rawFingerprint.trim().length === 0) {
    throw new InvariantViolationError('Observation rawFingerprint cannot be empty');
  }
  if (!(params.observedAt instanceof Date) || Number.isNaN(params.observedAt.getTime())) {
    throw new InvariantViolationError('Observation observedAt must be a valid Date');
  }
  if (
    params.publishedAt !== undefined &&
    params.publishedAt !== null &&
    (!(params.publishedAt instanceof Date) || Number.isNaN(params.publishedAt.getTime()))
  ) {
    throw new InvariantViolationError('Observation publishedAt must be a valid Date or null');
  }

  return {
    id: params.id.trim(),
    listingId: params.listingId.trim(),
    sourceRunId: params.sourceRunId.trim(),
    observedAt: params.observedAt,
    title: params.title.trim(),
    description: params.description ?? null,
    price: params.price ?? null,
    location: params.location ?? null,
    condition: params.condition ?? null,
    availability: params.availability ?? 'UNKNOWN',
    imageUrls: params.imageUrls ? [...params.imageUrls] : [],
    publishedAt: params.publishedAt ?? null,
    rawFingerprint: params.rawFingerprint.trim(),
  };
};
