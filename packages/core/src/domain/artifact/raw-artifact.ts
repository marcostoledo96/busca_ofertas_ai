import { InvariantViolationError } from '../common/index.js';
import type { RawArtifactRetentionPolicy } from '../search/saved-search.js';

export type RawArtifactReason = 'ERROR' | 'REVIEW' | 'DIAGNOSTIC';

export interface RawArtifact {
  readonly id: string;
  readonly relativePath: string;
  readonly kind: string;
  readonly sizeBytes: number;
  readonly fingerprint: string;
  readonly reason: RawArtifactReason;
  readonly contentType: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly runId?: string | null;
  readonly sourceRunId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface CreateRawArtifactParams {
  readonly id: string;
  readonly relativePath: string;
  readonly kind: string;
  readonly sizeBytes: number;
  readonly fingerprint: string;
  readonly reason: RawArtifactReason;
  readonly contentType: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly runId?: string | null;
  readonly sourceRunId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export const VALID_RAW_ARTIFACT_REASONS: readonly RawArtifactReason[] = Object.freeze([
  'ERROR',
  'REVIEW',
  'DIAGNOSTIC',
]);

export const DEFAULT_RAW_ARTIFACT_RETENTION_DAYS = 30;

/**
 * Validates a relative path strictly to prevent path traversal, absolute injection,
 * backslash manipulation, or escape from the artifact root.
 */
export function validateRelativeArtifactPath(relativePath: string): void {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new InvariantViolationError('Artifact relativePath cannot be empty');
  }

  const trimmed = relativePath.trim();

  // Reject absolute paths (starting with /)
  if (trimmed.startsWith('/')) {
    throw new InvariantViolationError('Artifact relativePath cannot be an absolute path');
  }

  // Reject backslashes
  if (trimmed.includes('\\')) {
    throw new InvariantViolationError('Artifact relativePath cannot contain backslashes');
  }

  // Reject NUL and control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new InvariantViolationError(
      'Artifact relativePath cannot contain control characters or NUL bytes',
    );
  }

  // Reject traversal sequences or ambiguous segments
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new InvariantViolationError(
        'Artifact relativePath cannot contain empty directory segments',
      );
    }
    if (segment === '.' || segment === '..') {
      throw new InvariantViolationError(
        'Artifact relativePath cannot contain "." or ".." directory segments',
      );
    }
  }
}

/**
 * Creates a validated RawArtifact domain entity.
 */
export function createRawArtifact(params: CreateRawArtifactParams): RawArtifact {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Artifact id cannot be empty');
  }

  validateRelativeArtifactPath(params.relativePath);

  if (typeof params.kind !== 'string' || params.kind.trim().length === 0) {
    throw new InvariantViolationError('Artifact kind cannot be empty');
  }

  if (
    typeof params.sizeBytes !== 'number' ||
    !Number.isInteger(params.sizeBytes) ||
    params.sizeBytes < 0
  ) {
    throw new InvariantViolationError('Artifact sizeBytes must be a non-negative integer');
  }

  if (typeof params.fingerprint !== 'string' || params.fingerprint.trim().length === 0) {
    throw new InvariantViolationError('Artifact fingerprint cannot be empty');
  }

  if (!VALID_RAW_ARTIFACT_REASONS.includes(params.reason)) {
    throw new InvariantViolationError(
      `Artifact reason must be one of: ${VALID_RAW_ARTIFACT_REASONS.join(', ')}`,
    );
  }

  if (typeof params.contentType !== 'string' || params.contentType.trim().length === 0) {
    throw new InvariantViolationError('Artifact contentType cannot be empty');
  }

  if (!(params.createdAt instanceof Date) || Number.isNaN(params.createdAt.getTime())) {
    throw new InvariantViolationError('Artifact createdAt must be a valid Date');
  }

  if (!(params.expiresAt instanceof Date) || Number.isNaN(params.expiresAt.getTime())) {
    throw new InvariantViolationError('Artifact expiresAt must be a valid Date');
  }

  if (params.expiresAt.getTime() < params.createdAt.getTime()) {
    throw new InvariantViolationError('Artifact expiresAt cannot be earlier than createdAt');
  }

  const runId = params.runId ? params.runId.trim() : null;
  const sourceRunId = params.sourceRunId ? params.sourceRunId.trim() : null;

  if (sourceRunId !== null && runId === null) {
    throw new InvariantViolationError('Artifact with sourceRunId must have a non-null runId');
  }

  return Object.freeze({
    id: params.id.trim(),
    relativePath: params.relativePath.trim(),
    kind: params.kind.trim(),
    sizeBytes: params.sizeBytes,
    fingerprint: params.fingerprint.trim(),
    reason: params.reason,
    contentType: params.contentType.trim(),
    createdAt: new Date(params.createdAt.getTime()),
    expiresAt: new Date(params.expiresAt.getTime()),
    runId,
    sourceRunId,
    metadata: params.metadata ? Object.freeze({ ...params.metadata }) : null,
  });
}

/**
 * Evaluates whether an artifact with the given reason should be retained under the active policy.
 */
export function isArtifactRetainable(
  policy: RawArtifactRetentionPolicy,
  reason: RawArtifactReason,
): boolean {
  switch (policy) {
    case 'NONE':
      return false;
    case 'ERRORS_ONLY':
      return reason === 'ERROR';
    case 'ERRORS_AND_REVIEW':
      return reason === 'ERROR' || reason === 'REVIEW';
    case 'ALL_LIMITED':
      return true;
    default:
      return false;
  }
}

/**
 * Calculates the artifact expiration timestamp in UTC based on retention days.
 * Defaults safely to 30 days if retentionDays is invalid or <= 0.
 */
export function calculateArtifactExpirationDate(
  createdAt: Date,
  retentionDays?: number | null,
): Date {
  const days =
    typeof retentionDays === 'number' && Number.isInteger(retentionDays) && retentionDays > 0
      ? retentionDays
      : DEFAULT_RAW_ARTIFACT_RETENTION_DAYS;

  const expirationMs = createdAt.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(expirationMs);
}
