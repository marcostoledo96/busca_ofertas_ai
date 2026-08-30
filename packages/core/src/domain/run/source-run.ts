import { InvariantViolationError } from '../common/index.js';

export type SourceRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'ZERO_RESULTS_CONFIRMED'
  | 'AUTHENTICATION_REQUIRED'
  | 'MANUAL_INTERVENTION_REQUIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SOURCE_UNAVAILABLE'
  | 'CONTRACT_CHANGED'
  | 'PARSER_FAILED'
  | 'TIMEOUT'
  | 'CONFIGURATION_UNSUPPORTED'
  | 'CANCELLED';

export interface SourceRun {
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly status: SourceRunStatus;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly itemsCount?: number;
  readonly error?: string;
}

export interface CreateSourceRunParams {
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly status?: SourceRunStatus;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly itemsCount?: number;
  readonly error?: string;
}

export const createSourceRun = (params: CreateSourceRunParams): SourceRun => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('SourceRun id cannot be empty');
  }
  if (typeof params.runId !== 'string' || params.runId.trim().length === 0) {
    throw new InvariantViolationError('SourceRun runId cannot be empty');
  }
  if (typeof params.sourceId !== 'string' || params.sourceId.trim().length === 0) {
    throw new InvariantViolationError('SourceRun sourceId cannot be empty');
  }
  const status = params.status ?? 'PENDING';
  const validStatuses: SourceRunStatus[] = [
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
  ];
  if (!validStatuses.includes(status)) {
    throw new InvariantViolationError(`Invalid SourceRunStatus: ${String(status)}`);
  }
  if (!(params.startedAt instanceof Date) || Number.isNaN(params.startedAt.getTime())) {
    throw new InvariantViolationError('SourceRun startedAt must be a valid Date');
  }
  if (params.finishedAt !== undefined) {
    if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
      throw new InvariantViolationError('SourceRun finishedAt must be a valid Date');
    }
    if (params.finishedAt.getTime() < params.startedAt.getTime()) {
      throw new InvariantViolationError('SourceRun finishedAt cannot be earlier than startedAt');
    }
  }
  if (params.itemsCount !== undefined) {
    if (
      typeof params.itemsCount !== 'number' ||
      !Number.isFinite(params.itemsCount) ||
      !Number.isInteger(params.itemsCount) ||
      params.itemsCount < 0
    ) {
      throw new InvariantViolationError('SourceRun itemsCount must be a non-negative integer');
    }
    if (status === 'ZERO_RESULTS_CONFIRMED' && params.itemsCount !== 0) {
      throw new InvariantViolationError(
        'SourceRun with status ZERO_RESULTS_CONFIRMED must have itemsCount equal to 0',
      );
    }
  }

  return {
    id: params.id.trim(),
    runId: params.runId.trim(),
    sourceId: params.sourceId.trim(),
    ...(params.collectorId !== undefined ? { collectorId: params.collectorId.trim() } : {}),
    status,
    startedAt: params.startedAt,
    ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
    ...(params.itemsCount !== undefined ? { itemsCount: params.itemsCount } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
  };
};
