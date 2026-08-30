import { InvariantViolationError } from '../common/index.js';

export interface PendingSourceRun {
  readonly status: 'PENDING';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
}

export interface RunningSourceRun {
  readonly status: 'RUNNING';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
}

export interface SuccessSourceRun {
  readonly status: 'SUCCESS';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly itemsCount: number;
}

export interface ZeroResultsConfirmedSourceRun {
  readonly status: 'ZERO_RESULTS_CONFIRMED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly itemsCount: 0;
}

export interface AuthenticationRequiredSourceRun {
  readonly status: 'AUTHENTICATION_REQUIRED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface ManualInterventionRequiredSourceRun {
  readonly status: 'MANUAL_INTERVENTION_REQUIRED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface RateLimitedSourceRun {
  readonly status: 'RATE_LIMITED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface NetworkErrorSourceRun {
  readonly status: 'NETWORK_ERROR';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface SourceUnavailableSourceRun {
  readonly status: 'SOURCE_UNAVAILABLE';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface ContractChangedSourceRun {
  readonly status: 'CONTRACT_CHANGED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface ParserFailedSourceRun {
  readonly status: 'PARSER_FAILED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface TimeoutSourceRun {
  readonly status: 'TIMEOUT';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface ConfigurationUnsupportedSourceRun {
  readonly status: 'CONFIGURATION_UNSUPPORTED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error: string;
}

export interface CancelledSourceRun {
  readonly status: 'CANCELLED';
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly collectorId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly error?: string;
}

export type SourceRun =
  | PendingSourceRun
  | RunningSourceRun
  | SuccessSourceRun
  | ZeroResultsConfirmedSourceRun
  | AuthenticationRequiredSourceRun
  | ManualInterventionRequiredSourceRun
  | RateLimitedSourceRun
  | NetworkErrorSourceRun
  | SourceUnavailableSourceRun
  | ContractChangedSourceRun
  | ParserFailedSourceRun
  | TimeoutSourceRun
  | ConfigurationUnsupportedSourceRun
  | CancelledSourceRun;

export type SourceRunStatus = SourceRun['status'];

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
  if (!(params.startedAt instanceof Date) || Number.isNaN(params.startedAt.getTime())) {
    throw new InvariantViolationError('SourceRun startedAt must be a valid Date');
  }

  const status: SourceRunStatus = params.status ?? 'PENDING';
  const id = params.id.trim();
  const runId = params.runId.trim();
  const sourceId = params.sourceId.trim();
  const collectorId = params.collectorId?.trim();
  const startedAt = params.startedAt;

  switch (status) {
    case 'PENDING':
    case 'RUNNING': {
      if (params.finishedAt !== undefined) {
        throw new InvariantViolationError(`SourceRun with status ${status} cannot have finishedAt`);
      }
      if (params.itemsCount !== undefined) {
        throw new InvariantViolationError(`SourceRun with status ${status} cannot have itemsCount`);
      }
      if (params.error !== undefined) {
        throw new InvariantViolationError(`SourceRun with status ${status} cannot have error`);
      }
      return {
        status,
        id,
        runId,
        sourceId,
        ...(collectorId !== undefined ? { collectorId } : {}),
        startedAt,
      };
    }

    case 'SUCCESS': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          'SourceRun with status SUCCESS must have a valid finishedAt Date',
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('SourceRun finishedAt cannot be earlier than startedAt');
      }
      if (
        typeof params.itemsCount !== 'number' ||
        !Number.isFinite(params.itemsCount) ||
        !Number.isInteger(params.itemsCount) ||
        params.itemsCount < 0
      ) {
        throw new InvariantViolationError(
          'SourceRun with status SUCCESS must have a non-negative integer itemsCount',
        );
      }
      if (params.error !== undefined) {
        throw new InvariantViolationError('SourceRun with status SUCCESS cannot have error');
      }
      return {
        status,
        id,
        runId,
        sourceId,
        ...(collectorId !== undefined ? { collectorId } : {}),
        startedAt,
        finishedAt: params.finishedAt,
        itemsCount: params.itemsCount,
      };
    }

    case 'ZERO_RESULTS_CONFIRMED': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          'SourceRun with status ZERO_RESULTS_CONFIRMED must have a valid finishedAt Date',
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('SourceRun finishedAt cannot be earlier than startedAt');
      }
      if (params.itemsCount !== 0) {
        throw new InvariantViolationError(
          'SourceRun with status ZERO_RESULTS_CONFIRMED must explicitly have itemsCount equal to 0',
        );
      }
      if (params.error !== undefined) {
        throw new InvariantViolationError(
          'SourceRun with status ZERO_RESULTS_CONFIRMED cannot have error',
        );
      }
      return {
        status,
        id,
        runId,
        sourceId,
        ...(collectorId !== undefined ? { collectorId } : {}),
        startedAt,
        finishedAt: params.finishedAt,
        itemsCount: 0,
      };
    }

    case 'AUTHENTICATION_REQUIRED':
    case 'MANUAL_INTERVENTION_REQUIRED':
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'SOURCE_UNAVAILABLE':
    case 'CONTRACT_CHANGED':
    case 'PARSER_FAILED':
    case 'TIMEOUT':
    case 'CONFIGURATION_UNSUPPORTED': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          `SourceRun with status ${status} must have a valid finishedAt Date`,
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('SourceRun finishedAt cannot be earlier than startedAt');
      }
      if (typeof params.error !== 'string' || params.error.trim().length === 0) {
        throw new InvariantViolationError(
          `SourceRun with status ${status} must have a diagnostic error message`,
        );
      }
      if (params.itemsCount !== undefined) {
        throw new InvariantViolationError(`SourceRun with status ${status} cannot have itemsCount`);
      }
      return {
        status,
        id,
        runId,
        sourceId,
        ...(collectorId !== undefined ? { collectorId } : {}),
        startedAt,
        finishedAt: params.finishedAt,
        error: params.error.trim(),
      };
    }

    case 'CANCELLED': {
      if (!(params.finishedAt instanceof Date) || Number.isNaN(params.finishedAt.getTime())) {
        throw new InvariantViolationError(
          'SourceRun with status CANCELLED must have a valid finishedAt Date',
        );
      }
      if (params.finishedAt.getTime() < startedAt.getTime()) {
        throw new InvariantViolationError('SourceRun finishedAt cannot be earlier than startedAt');
      }
      if (params.itemsCount !== undefined) {
        throw new InvariantViolationError('SourceRun with status CANCELLED cannot have itemsCount');
      }
      return {
        status,
        id,
        runId,
        sourceId,
        ...(collectorId !== undefined ? { collectorId } : {}),
        startedAt,
        finishedAt: params.finishedAt,
        ...(params.error !== undefined ? { error: params.error.trim() } : {}),
      };
    }

    default: {
      const exhaustiveCheck: never = status;
      throw new InvariantViolationError(`Invalid SourceRunStatus: ${String(exhaustiveCheck)}`);
    }
  }
};
