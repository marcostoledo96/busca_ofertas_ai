import { InvariantViolationError } from '../common/index.js';

export type SourceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED';

export interface SourceHealth {
  readonly sourceId: string;
  readonly status: SourceHealthStatus;
  readonly checkedAt: Date;
  readonly evidence: readonly string[];
}

export interface CreateSourceHealthParams {
  readonly sourceId: string;
  readonly status: SourceHealthStatus;
  readonly checkedAt: Date;
  readonly evidence?: readonly string[];
}

export const createSourceHealth = (params: CreateSourceHealthParams): SourceHealth => {
  if (typeof params.sourceId !== 'string' || params.sourceId.trim().length === 0) {
    throw new InvariantViolationError('SourceHealth sourceId cannot be empty');
  }
  if (!['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'AUTH_REQUIRED'].includes(params.status)) {
    throw new InvariantViolationError(`Invalid SourceHealthStatus: ${String(params.status)}`);
  }
  if (!(params.checkedAt instanceof Date) || Number.isNaN(params.checkedAt.getTime())) {
    throw new InvariantViolationError('SourceHealth checkedAt must be a valid Date');
  }

  return {
    sourceId: params.sourceId.trim(),
    status: params.status,
    checkedAt: params.checkedAt,
    evidence: params.evidence ? [...params.evidence] : [],
  };
};
