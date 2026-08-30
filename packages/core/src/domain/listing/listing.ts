import { InvariantViolationError } from '../common/index.js';

export interface Listing {
  readonly id: string;
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface CreateListingParams {
  readonly id: string;
  readonly sourceId: string;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export const createListing = (params: CreateListingParams): Listing => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Listing id cannot be empty');
  }
  if (typeof params.sourceId !== 'string' || params.sourceId.trim().length === 0) {
    throw new InvariantViolationError('Listing sourceId cannot be empty');
  }
  if (typeof params.externalId !== 'string' || params.externalId.trim().length === 0) {
    throw new InvariantViolationError('Listing externalId cannot be empty');
  }
  if (typeof params.canonicalUrl !== 'string' || params.canonicalUrl.trim().length === 0) {
    throw new InvariantViolationError('Listing canonicalUrl cannot be empty');
  }
  if (!(params.firstSeenAt instanceof Date) || Number.isNaN(params.firstSeenAt.getTime())) {
    throw new InvariantViolationError('Listing firstSeenAt must be a valid Date');
  }
  if (!(params.lastSeenAt instanceof Date) || Number.isNaN(params.lastSeenAt.getTime())) {
    throw new InvariantViolationError('Listing lastSeenAt must be a valid Date');
  }
  if (params.lastSeenAt.getTime() < params.firstSeenAt.getTime()) {
    throw new InvariantViolationError('Listing lastSeenAt cannot be earlier than firstSeenAt');
  }

  return {
    id: params.id.trim(),
    sourceId: params.sourceId.trim(),
    externalId: params.externalId.trim(),
    canonicalUrl: params.canonicalUrl.trim(),
    firstSeenAt: params.firstSeenAt,
    lastSeenAt: params.lastSeenAt,
  };
};
