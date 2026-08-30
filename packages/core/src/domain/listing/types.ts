export type ListingCondition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS' | 'UNKNOWN';

export type Availability = 'AVAILABLE' | 'PENDING' | 'SOLD' | 'REMOVED' | 'UNKNOWN';

export interface ResolvedLocation {
  readonly rawText: string;
  readonly region?: string;
  readonly city?: string;
  readonly neighborhood?: string;
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
}
