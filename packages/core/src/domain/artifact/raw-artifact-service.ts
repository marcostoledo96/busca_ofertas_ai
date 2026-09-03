import type { Clock, IdGenerator } from '../common/index.js';
import type { Hasher } from '../common/hasher.js';
import {
  type RawArtifact,
  type RawArtifactReason,
  calculateArtifactExpirationDate,
  createRawArtifact,
  isArtifactRetainable,
} from './raw-artifact.js';
import type { RawArtifactRetentionPolicy } from '../search/saved-search.js';
import type { ArtifactSanitizerPort } from './sanitizer-port.js';
import {
  type ArtifactFileSystemPort,
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
}

export interface CleanupSummary {
  readonly found: number;
  readonly deleted: number;
  readonly alreadyMissing: number;
  readonly failed: number;
}

export class RawArtifactService {
  private readonly storagePort: ArtifactFileSystemPort;
  private readonly repository: RawArtifactRepository;
  private readonly sanitizer: ArtifactSanitizerPort;
  private readonly hasher: Hasher;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly limits: Required<RawArtifactLimits>;

  constructor(options: RawArtifactServiceOptions) {
    this.storagePort = options.storagePort;
    this.repository = options.repository;
    this.sanitizer = options.sanitizer;
    this.hasher = options.hasher;
    this.clock = options.clock;
    this.idGenerator = options.idGenerator;
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

    // 3. Inspect, sanitize, and validate content fail-closed
    let serialized: string;

    if (typeof params.content === 'string') {
      let parsedJson: unknown = null;
      let isJson = false;
      try {
        parsedJson = JSON.parse(params.content);
        isJson = parsedJson !== null && typeof parsedJson === 'object';
      } catch {
        isJson = false;
      }

      if (isJson) {
        const sanitizedObj = this.sanitizer.sanitizeData(parsedJson);
        this.sanitizer.validateNoSensitiveData(sanitizedObj);
        serialized = JSON.stringify(sanitizedObj, null, 2);
      } else {
        const sanitizedText = this.sanitizer.sanitizeText(params.content);
        this.sanitizer.validateNoSensitiveData(sanitizedText);
        serialized = sanitizedText;
      }
    } else if (typeof params.content === 'object' && params.content !== null) {
      const sanitizedObj = this.sanitizer.sanitizeData(params.content);
      this.sanitizer.validateNoSensitiveData(sanitizedObj);
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

    // 6. Enforce per-run budget
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

    // 7. Compute deterministic SHA-256 fingerprint of the EXACT sanitized content
    const fingerprint = this.hasher.hash(serialized);

    // 8. Generate internal unique ID and physical layout relative path
    const id = this.idGenerator.generate();
    const now = this.clock.now();
    const yearMonth = now.toISOString().slice(0, 7); // e.g. "2026-09"

    let extension = 'txt';
    const ct = params.contentType.toLowerCase();
    if (ct.includes('json')) {
      extension = 'json';
    } else if (ct.includes('html')) {
      extension = 'html';
    }

    const relativePath = `${yearMonth}/art_${id}.${extension}`;

    // 9. Calculate expiration
    const expiresAt = calculateArtifactExpirationDate(now, params.retentionDays);

    // 10. Sanitize metadata if present
    let sanitizedMetadata: Record<string, unknown> | null = null;
    if (params.metadata && typeof params.metadata === 'object') {
      sanitizedMetadata = this.sanitizer.sanitizeData({ ...params.metadata });
      this.sanitizer.validateNoSensitiveData(sanitizedMetadata);
    }

    // 11. Write sanitized bytes to filesystem atomically
    await this.storagePort.writeSanitizedFile(relativePath, bytes);

    // 12. Create domain entity and persist to repository
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

    try {
      await this.repository.save(artifact);
      return artifact;
    } catch (dbErr) {
      // Compensating action: delete the newly written file so no orphan is left on disk
      await this.storagePort.deleteFile(relativePath).catch(() => {});
      throw dbErr;
    }
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
