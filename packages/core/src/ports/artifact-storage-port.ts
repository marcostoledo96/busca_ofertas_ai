/**
 * Base error for artifact storage operations.
 */
export class ArtifactStorageError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'ARTIFACT_STORAGE_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArtifactStorageError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ArtifactSizeLimitExceededError extends ArtifactStorageError {
  public readonly sizeBytes: number;
  public readonly limitBytes: number;

  constructor(sizeBytes: number, limitBytes: number) {
    super(
      `Artifact size (${sizeBytes} bytes) exceeds configured individual limit (${limitBytes} bytes)`,
      'ARTIFACT_SIZE_LIMIT_EXCEEDED',
    );
    this.name = 'ArtifactSizeLimitExceededError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

export class RunArtifactBudgetExceededError extends ArtifactStorageError {
  public readonly runId: string;
  public readonly requestedOrCurrentValue: number;
  public readonly limitValue: number;
  public readonly metric: 'BYTES' | 'COUNT';

  constructor(
    runId: string,
    metric: 'BYTES' | 'COUNT',
    requestedOrCurrentValue: number,
    limitValue: number,
  ) {
    super(
      `Artifact budget for run '${runId}' exceeded: ${metric} reached ${requestedOrCurrentValue} (limit ${limitValue})`,
      'RUN_ARTIFACT_BUDGET_EXCEEDED',
    );
    this.name = 'RunArtifactBudgetExceededError';
    this.runId = runId;
    this.metric = metric;
    this.requestedOrCurrentValue = requestedOrCurrentValue;
    this.limitValue = limitValue;
  }
}

export class ArtifactPathTraversalError extends ArtifactStorageError {
  constructor(message: string) {
    super(message, 'ARTIFACT_PATH_TRAVERSAL_DETECTED');
    this.name = 'ArtifactPathTraversalError';
  }
}

export class ArtifactSymlinkEscapeError extends ArtifactStorageError {
  constructor(message: string) {
    super(message, 'ARTIFACT_SYMLINK_ESCAPE_DETECTED');
    this.name = 'ArtifactSymlinkEscapeError';
  }
}

export class ArtifactIdentityCollisionError extends ArtifactStorageError {
  constructor(message: string) {
    super(message, 'ARTIFACT_IDENTITY_COLLISION');
    this.name = 'ArtifactIdentityCollisionError';
  }
}

export class ArtifactNotFoundError extends ArtifactStorageError {
  constructor(message: string) {
    super(message, 'ARTIFACT_NOT_FOUND');
    this.name = 'ArtifactNotFoundError';
  }
}

export class DiskFullError extends ArtifactStorageError {
  constructor(message = 'Filesystem is out of space (ENOSPC)') {
    super(message, 'DISK_FULL');
    this.name = 'DiskFullError';
  }
}

export class UnsupportedArtifactContentError extends ArtifactStorageError {
  constructor(
    message = 'Unsupported artifact content type: only UTF-8 text and JSON serializable structures are supported',
  ) {
    super(message, 'UNSUPPORTED_ARTIFACT_CONTENT');
    this.name = 'UnsupportedArtifactContentError';
  }
}

/**
 * Port representing the filesystem storage engine for raw artifacts.
 * Hides all OS-specific filesystem primitives (fs, open, unlink, lstat) behind clean abstractions.
 */
export interface ArtifactFileSystemPort {
  /**
   * Atomically writes sanitized bytes to the relative path within the artifact root.
   * Fails if destination already exists (no overwrite).
   */
  writeSanitizedFile(relativePath: string, bytes: Uint8Array): Promise<{ sizeBytes: number }>;

  /**
   * Reads raw bytes from the specified relative path.
   * Returns null if file is missing (does not throw).
   */
  readSanitizedFile(relativePath: string): Promise<Uint8Array | null>;

  /**
   * Safely deletes the file at relativePath.
   * Returns true if file was deleted, false if file did not exist.
   * Never traverses symlinks outside the root.
   */
  deleteFile(relativePath: string): Promise<boolean>;

  /**
   * Checks whether the file exists at the given relative path.
   */
  exists(relativePath: string): Promise<boolean>;

  /**
   * Safely scans and removes orphaned application-generated temporary files from staging (.tmp).
   * Ignores symlinks and foreign files.
   */
  cleanStagingDirectory?(): Promise<{ scanned: number; deleted: number }>;
}
