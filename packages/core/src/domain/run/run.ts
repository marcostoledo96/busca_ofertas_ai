import { InvariantViolationError } from '../common/index.js';

export type RunStatus =
  'CREATED' | 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export interface Run {
  readonly id: string;
  readonly savedSearchId: string;
  readonly status: RunStatus;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly error?: string;
}

export interface CreateRunParams {
  readonly id: string;
  readonly savedSearchId: string;
  readonly status?: RunStatus;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly error?: string;
}

export const createRun = (params: CreateRunParams): Run => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('Run id cannot be empty');
  }
  if (typeof params.savedSearchId !== 'string' || params.savedSearchId.trim().length === 0) {
    throw new InvariantViolationError('Run savedSearchId cannot be empty');
  }
  const status = params.status ?? 'CREATED';
  if (
    !['CREATED', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(status)
  ) {
    throw new InvariantViolationError(`Invalid RunStatus: ${String(status)}`);
  }
  if (!(params.startedAt instanceof Date) || Number.isNaN(params.startedAt.getTime())) {
    throw new InvariantViolationError('Run startedAt must be a valid Date');
  }
  if (params.finishedAt !== undefined) {
    if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
      throw new InvariantViolationError('Run finishedAt must be a valid Date');
    }
    if (params.finishedAt.getTime() < params.startedAt.getTime()) {
      throw new InvariantViolationError('Run finishedAt cannot be earlier than startedAt');
    }
  }

  return {
    id: params.id.trim(),
    savedSearchId: params.savedSearchId.trim(),
    status,
    startedAt: params.startedAt,
    ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
  };
};
