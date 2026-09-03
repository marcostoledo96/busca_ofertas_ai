export type RunExportErrorCode =
  | 'VALIDATION_ERROR'
  | 'RUN_NOT_FOUND'
  | 'HISTORICAL_REVISION_NOT_FOUND'
  | 'HISTORICAL_REVISION_COHERENCE_ERROR'
  | 'SOURCE_RUN_COHERENCE_ERROR'
  | 'SOURCE_METADATA_MISSING'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_SOURCE_MISMATCH';

export interface RunExportErrorParams {
  readonly code: RunExportErrorCode;
  readonly message: string;
  readonly runId?: string | undefined;
  readonly savedSearchId?: string | undefined;
  readonly sourceRunId?: string | undefined;
  readonly listingId?: string | undefined;
  readonly path?: string | undefined;
  readonly cause?: unknown;
}

export class RunExportError extends Error {
  readonly code: RunExportErrorCode;
  readonly runId?: string | undefined;
  readonly savedSearchId?: string | undefined;
  readonly sourceRunId?: string | undefined;
  readonly listingId?: string | undefined;
  readonly path?: string | undefined;

  constructor(params: RunExportErrorParams) {
    super(`[${params.code}] ${params.message}`);
    this.name = 'RunExportError';
    this.code = params.code;
    this.runId = params.runId;
    this.savedSearchId = params.savedSearchId;
    this.sourceRunId = params.sourceRunId;
    this.listingId = params.listingId;
    this.path = params.path;
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }
}

export class RunExportValidationError extends RunExportError {
  constructor(message: string, path?: string, cause?: unknown) {
    super({
      code: 'VALIDATION_ERROR',
      message,
      path,
      cause,
    });
    this.name = 'RunExportValidationError';
  }
}

export class RunExportProjectionError extends RunExportError {
  constructor(params: RunExportErrorParams) {
    super(params);
    this.name = 'RunExportProjectionError';
  }
}
