import { InvariantViolationError } from '../common/index.js';

export interface CreatedRun {
  readonly status: 'CREATED';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
}

export interface RunningRun {
  readonly status: 'RUNNING';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
}

export interface SuccessRun {
  readonly status: 'SUCCESS';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface PartialSuccessRun {
  readonly status: 'PARTIAL_SUCCESS';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface FailedRun {
  readonly status: 'FAILED';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface CancelledRun {
  readonly status: 'CANCELLED';
  readonly id: string;
  readonly savedSearchId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error?: string;
}

export type Run =
  CreatedRun | RunningRun | SuccessRun | PartialSuccessRun | FailedRun | CancelledRun;

export type RunStatus = Run['status'];

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
  if (!(params.startedAt instanceof Date) || Number.isNaN(params.startedAt.getTime())) {
    throw new InvariantViolationError('Run startedAt must be a valid Date');
  }

  const status: RunStatus = params.status ?? 'CREATED';
  const id = params.id.trim();
  const savedSearchId = params.savedSearchId.trim();
  const startedAt = params.startedAt;

  switch (status) {
    case 'CREATED':
    case 'RUNNING': {
      if (params.finishedAt !== undefined) {
        throw new InvariantViolationError(`Run with status ${status} cannot have finishedAt`);
      }
      if (params.error !== undefined) {
        throw new InvariantViolationError(`Run with status ${status} cannot have error`);
      }
      return {
        status,
        id,
        savedSearchId,
        startedAt,
      };
    }

    case 'SUCCESS':
    case 'PARTIAL_SUCCESS': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          `Run with status ${status} must have a valid finishedAt Date`,
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('Run finishedAt cannot be earlier than startedAt');
      }
      if (params.error !== undefined) {
        throw new InvariantViolationError(`Run with status ${status} cannot have error`);
      }
      return {
        status,
        id,
        savedSearchId,
        startedAt,
        finishedAt: params.finishedAt,
      };
    }

    case 'FAILED': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          'Run with status FAILED must have a valid finishedAt Date',
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('Run finishedAt cannot be earlier than startedAt');
      }
      if (typeof params.error !== 'string' || params.error.trim().length === 0) {
        throw new InvariantViolationError(
          'Run with status FAILED must have a diagnostic error message',
        );
      }
      return {
        status,
        id,
        savedSearchId,
        startedAt,
        finishedAt: params.finishedAt,
        error: params.error.trim(),
      };
    }

    case 'CANCELLED': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          'Run with status CANCELLED must have a valid finishedAt Date',
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('Run finishedAt cannot be earlier than startedAt');
      }
      return {
        status,
        id,
        savedSearchId,
        startedAt,
        finishedAt: params.finishedAt,
        ...(params.error !== undefined ? { error: params.error.trim() } : {}),
      };
    }

    default: {
      const exhaustiveCheck: never = status;
      throw new InvariantViolationError(`Invalid RunStatus: ${String(exhaustiveCheck)}`);
    }
  }
};
