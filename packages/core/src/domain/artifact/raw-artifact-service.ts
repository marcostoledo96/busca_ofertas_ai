import { type Clock, type IdGenerator, InvariantViolationError } from '../common/index.js';
import type { Hasher } from '../common/hasher.js';
import {
  type RawArtifact,
  type RawArtifactReason,
  calculateArtifactExpirationDate,
  createRawArtifact,
  isArtifactRetainable,
} from './raw-artifact.js';
import type { RawArtifactRetentionPolicy } from '../search/saved-search.js';
import type { ArtifactSanitizerPort, SanitizerOptions } from './sanitizer-port.js';
import {
  type ArtifactFileSystemPort,
  ArtifactStorageError,
  ArtifactSizeLimitExceededError,
  RunArtifactBudgetExceededError,
  UnsupportedArtifactContentError,
} from '../../ports/artifact-storage-port.js';
import type { RawArtifactRepository } from '../../ports/repositories.js';

export interface RawArtifactLimits {
  readonly maxArtifactSizeBytes?: number;
  readonly maxRunBudgetBytes?: number;
  readonly maxArtifactsPerRun?: number;
}

export const DEFAULT_RAW_ARTIFACT_LIMITS = Object.freeze({
  maxArtifactSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxRunBudgetBytes: 50 * 1024 * 1024, // 50 MB
  maxArtifactsPerRun: 100,
});

export interface RawArtifactServiceOptions {
  readonly storagePort: ArtifactFileSystemPort;
  readonly repository: RawArtifactRepository;
  readonly sanitizer: ArtifactSanitizerPort;
  readonly hasher: Hasher;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly limits?: RawArtifactLimits;
  readonly defaultAdditionalSensitiveKeys?: readonly string[];
}

export interface StoreArtifactParams {
  readonly policy: RawArtifactRetentionPolicy;
  readonly reason: RawArtifactReason;
  readonly kind: string;
  readonly content: string | Record<string, unknown> | readonly unknown[];
  readonly contentType: string;
  readonly retentionDays?: number | null;
  readonly runId?: string | null;
  readonly sourceRunId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly additionalSensitiveKeys?: readonly string[];
}

export interface CleanupSummary {
  readonly found: number;
  readonly deleted: number;
  readonly alreadyMissing: number;
  readonly failed: number;
}

class RunArtifactLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  public async withRunLock<T>(runId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    if (!runId) {
      return fn();
    }

    const previous = this.tails.get(runId) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });

    const nextTail = previous.then(() => current);
    this.tails.set(runId, nextTail);

    try {
      await previous;
      return await fn();
    } finally {
      resolveCurrent();
      if (this.tails.get(runId) === nextTail) {
        this.tails.delete(runId);
      }
    }
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function assertValidJsonStructure(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new UnsupportedArtifactContentError(
      `Unsupported artifact content value type: ${typeof value}`,
    );
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new UnsupportedArtifactContentError(
      'Binary artifact content (Buffer, Uint8Array, ArrayBuffer) is strictly forbidden',
    );
  }
  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof RegExp
  ) {
    throw new UnsupportedArtifactContentError(
      `Unsupported artifact content class: ${value.constructor.name}`,
    );
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new UnsupportedArtifactContentError('Circular reference detected in artifact content');
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        assertValidJsonStructure(item, seen);
      }
      return;
    }
    if (isPlainJsonObject(value)) {
      for (const val of Object.values(value)) {
        assertValidJsonStructure(val, seen);
      }
      return;
    }
    throw new UnsupportedArtifactContentError(
      `Disallowed object prototype in artifact content: ${Object.prototype.toString.call(value)}`,
    );
  }
  throw new UnsupportedArtifactContentError(`Unsupported artifact content: ${typeof value}`);
}

function validateContentType(contentType: string): { isJson: boolean; extension: string } {
  if (typeof contentType !== 'string' || contentType.trim().length === 0) {
    throw new UnsupportedArtifactContentError('Artifact contentType cannot be empty');
  }
  const ct = contentType.trim().toLowerCase();
  const isText = ct.startsWith('text/');
  const isJson =
    ct === 'application/json' ||
    ct.startsWith('application/json;') ||
    ct.endsWith('+json') ||
    ct.includes('+json;');

  if (!isText && !isJson) {
    throw new UnsupportedArtifactContentError(
      `Disallowed artifact contentType '${contentType}'. Only text/* and application/json types are permitted`,
    );
  }

  let extension = 'txt';
  if (isJson) {
    extension = 'json';
  } else if (ct.includes('html')) {
    extension = 'html';
  }

  return { isJson, extension };
}

export class RawArtifactService {
  private readonly storagePort: ArtifactFileSystemPort;
  private readonly repository: RawArtifactRepository;
  private readonly sanitizer: ArtifactSanitizerPort;
  private readonly hasher: Hasher;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly limits: Required<RawArtifactLimits>;
  private readonly defaultAdditionalSensitiveKeys: readonly string[] | undefined;
  private readonly runLock = new RunArtifactLock();

  constructor(options: RawArtifactServiceOptions) {
    this.storagePort = options.storagePort;
    this.repository = options.repository;
    this.sanitizer = options.sanitizer;
    this.hasher = options.hasher;
    this.clock = options.clock;
    this.idGenerator = options.idGenerator;
    this.defaultAdditionalSensitiveKeys = options.defaultAdditionalSensitiveKeys;
    this.limits = Object.freeze({
      maxArtifactSizeBytes:
        options.limits?.maxArtifactSizeBytes ?? DEFAULT_RAW_ARTIFACT_LIMITS.maxArtifactSizeBytes,
      maxRunBudgetBytes:
        options.limits?.maxRunBudgetBytes ?? DEFAULT_RAW_ARTIFACT_LIMITS.maxRunBudgetBytes,
      maxArtifactsPerRun:
        options.limits?.maxArtifactsPerRun ?? DEFAULT_RAW_ARTIFACT_LIMITS.maxArtifactsPerRun,
    });
  }

  /**
   * Stores a sanitized raw artifact if permitted by the retention policy.
   * Returns the created RawArtifact entity, or null if the policy drops the artifact.
   */
  public async storeArtifact(params: StoreArtifactParams): Promise<RawArtifact | null> {
    // 1. Policy check
    if (!isArtifactRetainable(params.policy, params.reason)) {
      return null;
    }

    // 2. Coherence check for runId and sourceRunId
    const runId = params.runId ? params.runId.trim() : null;
    const sourceRunId = params.sourceRunId ? params.sourceRunId.trim() : null;

    if (sourceRunId !== null && runId === null) {
      throw new InvariantViolationError('Artifact with sourceRunId must have a non-null runId');
    }

    // 3. Validate content type and reject binary objects
    const { isJson: isJsonContentType, extension } = validateContentType(params.contentType);

    if (params.content instanceof ArrayBuffer || ArrayBuffer.isView(params.content)) {
      throw new UnsupportedArtifactContentError(
        'Binary artifact content (Buffer, Uint8Array, ArrayBuffer) is strictly forbidden',
      );
    }

    const sanitizerOpts: SanitizerOptions = {
      additionalSensitiveKeys: [
        ...(this.defaultAdditionalSensitiveKeys ?? []),
        ...(params.additionalSensitiveKeys ?? []),
      ],
    };

    let serialized: string;
    if (typeof params.content === 'string') {
      if (isJsonContentType) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(params.content);
        } catch (parseErr) {
          throw new UnsupportedArtifactContentError(
            `Artifact with JSON contentType must contain valid JSON string: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
        }
        assertValidJsonStructure(parsed);
        const sanitizedObj = this.sanitizer.sanitizeData(parsed, sanitizerOpts);
        this.sanitizer.validateNoSensitiveData(sanitizedObj, sanitizerOpts);
        serialized = JSON.stringify(sanitizedObj, null, 2);
      } else {
        const sanitizedText = this.sanitizer.sanitizeText(params.content, sanitizerOpts);
        this.sanitizer.validateNoSensitiveData(sanitizedText, sanitizerOpts);
        serialized = sanitizedText;
      }
    } else if (typeof params.content === 'object' && params.content !== null) {
      if (!isJsonContentType) {
        throw new UnsupportedArtifactContentError(
          `Artifact with object content must have application/json contentType, got '${params.contentType}'`,
        );
      }
      assertValidJsonStructure(params.content);
      const sanitizedObj = this.sanitizer.sanitizeData(params.content, sanitizerOpts);
      this.sanitizer.validateNoSensitiveData(sanitizedObj, sanitizerOpts);
      serialized = JSON.stringify(sanitizedObj, null, 2);
    } else {
      throw new UnsupportedArtifactContentError(
        `Unsupported artifact content type: ${typeof params.content}`,
      );
    }

    // 4. Encode as UTF-8 bytes deterministically
    const bytes = new TextEncoder().encode(serialized);

    // 5. Enforce individual size limit
    if (bytes.length > this.limits.maxArtifactSizeBytes) {
      throw new ArtifactSizeLimitExceededError(bytes.length, this.limits.maxArtifactSizeBytes);
    }

    // 6. Compute fingerprint, id, path, dates, and validate entity BEFORE any filesystem action
    const fingerprint = this.hasher.hash(serialized);
    const id = this.idGenerator.generate();
    const now = this.clock.now();
    const yearMonth = now.toISOString().slice(0, 7);
    const relativePath = `${yearMonth}/art_${id}.${extension}`;
    const expiresAt = calculateArtifactExpirationDate(now, params.retentionDays);

    let sanitizedMetadata: Record<string, unknown> | null = null;
    if (params.metadata && typeof params.metadata === 'object') {
      assertValidJsonStructure(params.metadata);
      sanitizedMetadata = this.sanitizer.sanitizeData({ ...params.metadata }, sanitizerOpts);
      this.sanitizer.validateNoSensitiveData(sanitizedMetadata, sanitizerOpts);
    }

    // Entity construction validates parameters (kind, contentType, relativePath, expiration, runId coherence)
    // BEFORE writing to filesystem, avoiding orphan files.
    const artifact = createRawArtifact({
      id,
      relativePath,
      kind: params.kind,
      sizeBytes: bytes.length,
      fingerprint,
      reason: params.reason,
      contentType: params.contentType,
      createdAt: now,
      expiresAt,
      runId,
      sourceRunId,
      metadata: sanitizedMetadata,
    });

    // 7. Enforce per-run budget inside the run lock to guarantee concurrency safety
    return this.runLock.withRunLock(runId, async () => {
      if (runId) {
        const currentBytes = await this.repository.getTotalSizeBytesByRunId(runId);
        if (currentBytes + bytes.length > this.limits.maxRunBudgetBytes) {
          throw new RunArtifactBudgetExceededError(
            runId,
            'BYTES',
            currentBytes + bytes.length,
            this.limits.maxRunBudgetBytes,
          );
        }

        const currentCount = await this.repository.getCountByRunId(runId);
        if (currentCount >= this.limits.maxArtifactsPerRun) {
          throw new RunArtifactBudgetExceededError(
            runId,
            'COUNT',
            currentCount + 1,
            this.limits.maxArtifactsPerRun,
          );
        }
      }

      // 8. Write sanitized bytes to filesystem atomically
      await this.storagePort.writeSanitizedFile(relativePath, bytes);

      // 9. Persist to repository with compensation
      try {
        await this.repository.save(artifact);
        return artifact;
      } catch (dbErr: unknown) {
        try {
          await this.storagePort.deleteFile(relativePath);
        } catch (compErr: unknown) {
          const errorMsg = `Database save failed ('${dbErr instanceof Error ? dbErr.message : String(dbErr)}') AND compensating file deletion of '${relativePath}' also failed ('${compErr instanceof Error ? compErr.message : String(compErr)}')`;
          throw new ArtifactStorageError(errorMsg, 'ARTIFACT_COMPENSATION_FAILED', {
            cause: dbErr,
          });
        }
        throw dbErr;
      }
    });
  }

  /**
   * Retrieves an artifact by ID from SQLite.
   */
  public async getArtifact(id: string): Promise<RawArtifact | null> {
    return this.repository.getById(id);
  }

  /**
   * Reads the content of an artifact.
   * If the file disappeared manually from disk, returns null without breaking callers.
   */
  public async getArtifactContent(
    id: string,
  ): Promise<{ artifact: RawArtifact; content: string } | null> {
    const artifact = await this.repository.getById(id);
    if (!artifact) {
      return null;
    }

    const bytes = await this.storagePort.readSanitizedFile(artifact.relativePath);
    if (!bytes) {
      return null;
    }

    const content = new TextDecoder('utf-8').decode(bytes);
    return { artifact, content };
  }

  /**
   * Inspects expired artifacts to present a preview for manual cleanup.
   */
  public async inspectExpired(now?: Date): Promise<{ count: number; totalSizeBytes: number }> {
    const refDate = now ?? this.clock.now();
    const expired = await this.repository.listExpired(refDate);
    const totalSizeBytes = expired.reduce((acc, a) => acc + a.sizeBytes, 0);
    return { count: expired.length, totalSizeBytes };
  }

  /**
   * Idempotent cleanup of expired artifacts:
   * 1. Iterates over inventory items where expires_at <= now.
   * 2. Checks filesystem existence.
   * 3. Deletes file safely if present.
   * 4. Deletes inventory row from SQLite.
   * 5. If file was already missing, converges inventory cleanly.
   * 6. If filesystem deletion fails, leaves inventory row intact for retry.
   */
  public async cleanupExpiredArtifacts(now?: Date): Promise<CleanupSummary> {
    const refDate = now ?? this.clock.now();
    const expiredList = await this.repository.listExpired(refDate);

    let deleted = 0;
    let alreadyMissing = 0;
    let failed = 0;

    for (const artifact of expiredList) {
      let fileWasPresent = false;
      try {
        const fileExists = await this.storagePort.exists(artifact.relativePath);
        if (fileExists) {
          const removed = await this.storagePort.deleteFile(artifact.relativePath);
          fileWasPresent = removed;
        } else {
          fileWasPresent = false;
        }
      } catch {
        // Filesystem error (e.g. EPERM): do NOT delete DB row, leave for retry
        failed++;
        continue;
      }

      try {
        await this.repository.deleteById(artifact.id);
        if (fileWasPresent) {
          deleted++;
        } else {
          alreadyMissing++;
        }
      } catch {
        failed++;
      }
    }

    return Object.freeze({
      found: expiredList.length,
      deleted,
      alreadyMissing,
      failed,
    });
  }
}
