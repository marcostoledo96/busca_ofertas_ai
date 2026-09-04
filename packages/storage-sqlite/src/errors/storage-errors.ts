export type SqliteStorageErrorCode =
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_CLOSED'
  | 'PRAGMA_CONFIGURATION_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_MANIFEST_INVALID'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_ALREADY_ACTIVE'
  | 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED'
  | 'TRANSACTION_SCOPE_CLOSED'
  | 'INVALID_DATABASE_PATH'
  | 'STORAGE_CORRUPTION'
  | 'EXECUTION_LOCK_HELD'
  | 'EXECUTION_LOCK_RELEASE_FAILED'
  | 'LISTING_IDENTITY_COLLISION'
  | 'RUN_IDENTITY_COLLISION'
  | 'SOURCE_RUN_IDENTITY_COLLISION'
  | 'SAVED_SEARCH_IDENTITY_COLLISION'
  | 'OBSERVATION_IDENTITY_COLLISION'
  | 'OBSERVATION_FINGERPRINT_COLLISION'
  | 'RECORD_OBSERVATION_COHERENCE_ERROR'
  | 'EVALUATION_IDENTITY_COLLISION'
  | 'OPPORTUNITY_IDENTITY_COLLISION'
  | 'FEEDBACK_IDENTITY_COLLISION'
  | 'RAW_ARTIFACT_IDENTITY_COLLISION'
  | 'SENSITIVE_DATA_DETECTED';

export interface SqliteStorageErrorOptions {
  readonly cause?: unknown;
}

export class SqliteStorageError extends Error {
  readonly code: SqliteStorageErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: SqliteStorageErrorCode, options?: SqliteStorageErrorOptions) {
    super(message);
    this.name = 'SqliteStorageError';
    this.code = code;
    this.cause = options?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DatabaseOpenFailedError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'DATABASE_OPEN_FAILED', options);
    this.name = 'DatabaseOpenFailedError';
  }
}

export class DatabaseClosedError extends SqliteStorageError {
  constructor(
    message = 'Cannot perform operation: SQLite database is closed',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'DATABASE_CLOSED', options);
    this.name = 'DatabaseClosedError';
  }
}

export class PragmaConfigurationError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'PRAGMA_CONFIGURATION_FAILED', options);
    this.name = 'PragmaConfigurationError';
  }
}

export interface MigrationFailedErrorDetails {
  readonly version: number;
  readonly migrationName: string;
}

export class MigrationFailedError extends SqliteStorageError {
  readonly version: number;
  readonly migrationName: string;

  constructor(
    details: MigrationFailedErrorDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Migration ${details.version} ('${details.migrationName}') failed and was rolled back.`;
    super(msg, 'MIGRATION_FAILED', options);
    this.name = 'MigrationFailedError';
    this.version = details.version;
    this.migrationName = details.migrationName;
  }
}

export class MigrationManifestInvalidError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'MIGRATION_MANIFEST_INVALID', options);
    this.name = 'MigrationManifestInvalidError';
  }
}

export interface SchemaVersionUnsupportedDetails {
  readonly foundVersion: number;
  readonly maxSupportedVersion: number;
}

export class SchemaVersionUnsupportedError extends SqliteStorageError {
  readonly foundVersion: number;
  readonly maxSupportedVersion: number;

  constructor(
    details: SchemaVersionUnsupportedDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Database schema version ${details.foundVersion} exceeds maximum version ${details.maxSupportedVersion} supported by this application. Please upgrade Busca Ofertas AI.`;
    super(msg, 'SCHEMA_VERSION_UNSUPPORTED', options);
    this.name = 'SchemaVersionUnsupportedError';
    this.foundVersion = details.foundVersion;
    this.maxSupportedVersion = details.maxSupportedVersion;
  }
}

export type TransactionErrorCode =
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_ALREADY_ACTIVE'
  | 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED'
  | 'TRANSACTION_SCOPE_CLOSED';

export class TransactionFailedError extends SqliteStorageError {
  constructor(
    message: string,
    code: TransactionErrorCode = 'TRANSACTION_FAILED',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, code, options);
    this.name = 'TransactionFailedError';
  }
}

export class TransactionAsyncCallbackUnsupportedError extends SqliteStorageError {
  constructor(
    message = 'Async transaction callbacks are not supported: transaction callback returned a Promise or thenable.',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED', options);
    this.name = 'TransactionAsyncCallbackUnsupportedError';
  }
}

export class TransactionScopeClosedError extends SqliteStorageError {
  constructor(
    message = 'Cannot perform operation: transaction scope has finished and is no longer active.',
    options?: SqliteStorageErrorOptions,
  ) {
    super(message, 'TRANSACTION_SCOPE_CLOSED', options);
    this.name = 'TransactionScopeClosedError';
  }
}

export class InvalidDatabasePathError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'INVALID_DATABASE_PATH', options);
    this.name = 'InvalidDatabasePathError';
  }
}

export class StorageCorruptionError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'STORAGE_CORRUPTION', options);
    this.name = 'StorageCorruptionError';
  }
}

export interface ExecutionLockHeldDetails {
  readonly holderId: string;
  readonly acquiredAt: Date;
}

export class ExecutionLockHeldError extends SqliteStorageError {
  readonly holderId: string;
  readonly acquiredAt: Date;

  constructor(
    details: ExecutionLockHeldDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Execution lock is currently held by '${details.holderId}' (acquired at ${details.acquiredAt.toISOString()}). Concurrent execution rejected.`;
    super(msg, 'EXECUTION_LOCK_HELD', options);
    this.name = 'ExecutionLockHeldError';
    this.holderId = details.holderId;
    this.acquiredAt = details.acquiredAt;
  }
}

export class ExecutionLockReleaseError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'EXECUTION_LOCK_RELEASE_FAILED', options);
    this.name = 'ExecutionLockReleaseError';
  }
}

export interface ListingIdentityCollisionDetails {
  readonly sourceId: string;
  readonly externalId: string;
  readonly existingId: string;
  readonly attemptingId: string;
}

export class ListingIdentityCollisionError extends SqliteStorageError {
  readonly sourceId: string;
  readonly externalId: string;
  readonly existingId: string;
  readonly attemptingId: string;

  constructor(
    details: ListingIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Listing identity conflict on source '${details.sourceId}' and external ID '${details.externalId}': existing record ID '${details.existingId}' cannot be overwritten with new ID '${details.attemptingId}'.`;
    super(msg, 'LISTING_IDENTITY_COLLISION', options);
    this.name = 'ListingIdentityCollisionError';
    this.sourceId = details.sourceId;
    this.externalId = details.externalId;
    this.existingId = details.existingId;
    this.attemptingId = details.attemptingId;
  }
}

export interface RunIdentityCollisionDetails {
  readonly runId: string;
  readonly existingSavedSearchId: string;
  readonly attemptingSavedSearchId: string;
  readonly existingStartedAt: Date;
  readonly attemptingStartedAt: Date;
}

export class RunIdentityCollisionError extends SqliteStorageError {
  readonly runId: string;
  readonly existingSavedSearchId: string;
  readonly attemptingSavedSearchId: string;
  readonly existingStartedAt: Date;
  readonly attemptingStartedAt: Date;

  constructor(
    details: RunIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Run identity collision on run ID '${details.runId}': existing record (savedSearchId='${details.existingSavedSearchId}', startedAt='${details.existingStartedAt.toISOString()}') cannot be modified to (savedSearchId='${details.attemptingSavedSearchId}', startedAt='${details.attemptingStartedAt.toISOString()}').`;
    super(msg, 'RUN_IDENTITY_COLLISION', options);
    this.name = 'RunIdentityCollisionError';
    this.runId = details.runId;
    this.existingSavedSearchId = details.existingSavedSearchId;
    this.attemptingSavedSearchId = details.attemptingSavedSearchId;
    this.existingStartedAt = details.existingStartedAt;
    this.attemptingStartedAt = details.attemptingStartedAt;
  }
}

export interface SourceRunIdentityCollisionDetails {
  readonly sourceRunId: string;
  readonly existingRunId?: string | undefined;
  readonly attemptingRunId?: string | undefined;
  readonly existingSourceId?: string | undefined;
  readonly attemptingSourceId?: string | undefined;
  readonly existingStartedAt?: Date | undefined;
  readonly attemptingStartedAt?: Date | undefined;
  readonly existingAdapterVersion?: string | undefined;
  readonly attemptingAdapterVersion?: string | undefined;
  readonly existingCollectorId?: string | null | undefined;
  readonly attemptingCollectorId?: string | null | undefined;
}

export class SourceRunIdentityCollisionError extends SqliteStorageError {
  readonly sourceRunId: string;
  readonly existingRunId?: string | undefined;
  readonly attemptingRunId?: string | undefined;
  readonly existingSourceId?: string | undefined;
  readonly attemptingSourceId?: string | undefined;
  readonly existingStartedAt?: Date | undefined;
  readonly attemptingStartedAt?: Date | undefined;
  readonly existingAdapterVersion?: string | undefined;
  readonly attemptingAdapterVersion?: string | undefined;
  readonly existingCollectorId?: string | null | undefined;
  readonly attemptingCollectorId?: string | null | undefined;

  constructor(
    details: SourceRunIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `SourceRun identity collision on ID '${details.sourceRunId}': existing record cannot be modified to incoming record.`;
    super(msg, 'SOURCE_RUN_IDENTITY_COLLISION', options);
    this.name = 'SourceRunIdentityCollisionError';
    this.sourceRunId = details.sourceRunId;
    this.existingRunId = details.existingRunId;
    this.attemptingRunId = details.attemptingRunId;
    this.existingSourceId = details.existingSourceId;
    this.attemptingSourceId = details.attemptingSourceId;
    this.existingStartedAt = details.existingStartedAt;
    this.attemptingStartedAt = details.attemptingStartedAt;
    this.existingAdapterVersion = details.existingAdapterVersion;
    this.attemptingAdapterVersion = details.attemptingAdapterVersion;
    this.existingCollectorId = details.existingCollectorId;
    this.attemptingCollectorId = details.attemptingCollectorId;
  }
}

export interface SavedSearchIdentityCollisionDetails {
  readonly savedSearchId: string;
  readonly existingCreatedAt: Date;
  readonly attemptingCreatedAt: Date;
}

export class SavedSearchIdentityCollisionError extends SqliteStorageError {
  readonly savedSearchId: string;
  readonly existingCreatedAt: Date;
  readonly attemptingCreatedAt: Date;

  constructor(
    details: SavedSearchIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `SavedSearch identity collision on ID '${details.savedSearchId}': existing record (createdAt='${details.existingCreatedAt.toISOString()}') cannot be modified to (createdAt='${details.attemptingCreatedAt.toISOString()}').`;
    super(msg, 'SAVED_SEARCH_IDENTITY_COLLISION', options);
    this.name = 'SavedSearchIdentityCollisionError';
    this.savedSearchId = details.savedSearchId;
    this.existingCreatedAt = details.existingCreatedAt;
    this.attemptingCreatedAt = details.attemptingCreatedAt;
  }
}

export interface ObservationIdentityCollisionDetails {
  readonly observationId: string;
  readonly listingId: string;
  readonly sourceRunId: string;
}

export class ObservationIdentityCollisionError extends SqliteStorageError {
  readonly observationId: string;
  readonly listingId: string;
  readonly sourceRunId: string;

  constructor(
    details: ObservationIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Observation identity conflict on observation ID '${details.observationId}': existing record (listingId='${details.listingId}', sourceRunId='${details.sourceRunId}') is immutable and cannot be overwritten with different content.`;
    super(msg, 'OBSERVATION_IDENTITY_COLLISION', options);
    this.name = 'ObservationIdentityCollisionError';
    this.observationId = details.observationId;
    this.listingId = details.listingId;
    this.sourceRunId = details.sourceRunId;
  }
}

export interface ObservationFingerprintCollisionDetails {
  readonly observationId: string;
  readonly listingId: string;
  readonly sourceRunId: string;
  readonly fingerprint: string;
}

export class ObservationFingerprintCollisionError extends SqliteStorageError {
  readonly observationId: string;
  readonly listingId: string;
  readonly sourceRunId: string;
  readonly fingerprint: string;

  constructor(
    details: ObservationFingerprintCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Observation fingerprint conflict on listing '${details.listingId}' and run '${details.sourceRunId}': fingerprint '${details.fingerprint}' matches existing observation but fingerprint-covered payload differs. Refusing to overwrite or discard differing content.`;
    super(msg, 'OBSERVATION_FINGERPRINT_COLLISION', options);
    this.name = 'ObservationFingerprintCollisionError';
    this.observationId = details.observationId;
    this.listingId = details.listingId;
    this.sourceRunId = details.sourceRunId;
    this.fingerprint = details.fingerprint;
  }
}

export interface RecordObservationCoherenceDetails {
  readonly kind:
    | 'LISTING_ID_MISMATCH'
    | 'SOURCE_ID_MISMATCH'
    | 'SOURCE_RUN_NOT_FOUND'
    | 'OUT_OF_ORDER_OBSERVED_AT';
  readonly listingId?: string;
  readonly observationListingId?: string;
  readonly listingSourceId?: string;
  readonly sourceRunSourceId?: string;
  readonly sourceRunId?: string;
  readonly incomingObservedAt?: string;
  readonly latestPersistedObservedAt?: string;
}

export class RecordObservationCoherenceError extends SqliteStorageError {
  readonly details: RecordObservationCoherenceDetails;

  constructor(
    details: RecordObservationCoherenceDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    let msg = message;
    if (!msg) {
      if (details.kind === 'LISTING_ID_MISMATCH') {
        msg = `RecordObservation input coherence failure: observation.listingId ('${details.observationListingId}') must match incoming listing.id ('${details.listingId}') before natural key resolution.`;
      } else if (details.kind === 'SOURCE_ID_MISMATCH') {
        msg = `RecordObservation input coherence failure: listing.sourceId ('${details.listingSourceId}') does not match sourceRun.sourceId ('${details.sourceRunSourceId}'). SourceRun cannot record observations for a different source.`;
      } else if (details.kind === 'OUT_OF_ORDER_OBSERVED_AT') {
        msg = `RecordObservation input coherence failure: incoming observation.observedAt ('${details.incomingObservedAt}') is older than latest persisted observation.observedAt ('${details.latestPersistedObservedAt}') for listing '${details.listingId}'. Observations must be recorded in chronological order.`;
      } else {
        msg = `RecordObservation input coherence failure: sourceRun with id '${details.sourceRunId}' was not found.`;
      }
    }
    super(msg, 'RECORD_OBSERVATION_COHERENCE_ERROR', options);
    this.name = 'RecordObservationCoherenceError';
    this.details = details;
  }
}

export interface EvaluationIdentityCollisionDetails {
  readonly evaluationId: string;
}

export class EvaluationIdentityCollisionError extends SqliteStorageError {
  readonly evaluationId: string;

  constructor(
    details: EvaluationIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Evaluation identity conflict on evaluation ID '${details.evaluationId}': existing record is immutable and cannot be overwritten with different content.`;
    super(msg, 'EVALUATION_IDENTITY_COLLISION', options);
    this.name = 'EvaluationIdentityCollisionError';
    this.evaluationId = details.evaluationId;
  }
}

export interface OpportunityIdentityCollisionDetails {
  readonly opportunityId: string;
}

export class OpportunityIdentityCollisionError extends SqliteStorageError {
  readonly opportunityId: string;

  constructor(
    details: OpportunityIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Opportunity identity conflict on opportunity ID '${details.opportunityId}': existing record is immutable and cannot be overwritten with different content.`;
    super(msg, 'OPPORTUNITY_IDENTITY_COLLISION', options);
    this.name = 'OpportunityIdentityCollisionError';
    this.opportunityId = details.opportunityId;
  }
}

export interface FeedbackIdentityCollisionDetails {
  readonly feedbackId: string;
}

export class FeedbackIdentityCollisionError extends SqliteStorageError {
  readonly feedbackId: string;

  constructor(
    details: FeedbackIdentityCollisionDetails,
    message?: string,
    options?: SqliteStorageErrorOptions,
  ) {
    const msg =
      message ??
      `Feedback identity conflict on feedback ID '${details.feedbackId}': existing record is immutable and cannot be overwritten with different content.`;
    super(msg, 'FEEDBACK_IDENTITY_COLLISION', options);
    this.name = 'FeedbackIdentityCollisionError';
    this.feedbackId = details.feedbackId;
  }
}

export class SensitiveDataDetectedError extends SqliteStorageError {
  constructor(message: string, options?: SqliteStorageErrorOptions) {
    super(message, 'SENSITIVE_DATA_DETECTED', options);
    this.name = 'SensitiveDataDetectedError';
  }
}

export class RawArtifactIdentityCollisionError extends SqliteStorageError {
  readonly artifactId: string;

  constructor(artifactId: string, message?: string, options?: SqliteStorageErrorOptions) {
    const msg =
      message ??
      `RawArtifact identity conflict on artifact ID '${artifactId}': an artifact record with this ID already exists.`;
    super(msg, 'RAW_ARTIFACT_IDENTITY_COLLISION', options);
    this.name = 'RawArtifactIdentityCollisionError';
    this.artifactId = artifactId;
  }
}

export function isSqliteStorageError(error: unknown): error is SqliteStorageError {
  return error instanceof SqliteStorageError;
}
