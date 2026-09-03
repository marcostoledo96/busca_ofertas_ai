import { describe, it, expect, beforeEach } from 'vitest';
import {
  RawArtifactService,
  createRawArtifact,
  isArtifactRetainable,
  calculateArtifactExpirationDate,
  ArtifactSizeLimitExceededError,
  RunArtifactBudgetExceededError,
  UnsupportedArtifactContentError,
  type RawArtifactRepository,
  type ArtifactFileSystemPort,
  type RawArtifact,
  type RawArtifactReason,
  type RawArtifactRetentionPolicy,
} from '@busca-ofertas-ai/core';
import {
  createSqliteArtifactSanitizer,
  createNodeCryptoHasher,
  SensitiveDataDetectedError,
} from '@busca-ofertas-ai/storage-sqlite';

class InMemoryArtifactFileSystem implements ArtifactFileSystemPort {
  public readonly files = new Map<string, Uint8Array>();

  writeSanitizedFile(relativePath: string, bytes: Uint8Array): Promise<{ sizeBytes: number }> {
    this.files.set(relativePath, new Uint8Array(bytes));
    return Promise.resolve({ sizeBytes: bytes.length });
  }

  readSanitizedFile(relativePath: string): Promise<Uint8Array | null> {
    const file = this.files.get(relativePath);
    return Promise.resolve(file ? new Uint8Array(file) : null);
  }

  deleteFile(relativePath: string): Promise<boolean> {
    return Promise.resolve(this.files.delete(relativePath));
  }

  exists(relativePath: string): Promise<boolean> {
    return Promise.resolve(this.files.has(relativePath));
  }
}

class InMemoryRawArtifactRepository implements RawArtifactRepository {
  public readonly artifacts = new Map<string, RawArtifact>();

  save(artifact: RawArtifact): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
    return Promise.resolve();
  }

  getById(id: string): Promise<RawArtifact | null> {
    return Promise.resolve(this.artifacts.get(id) ?? null);
  }

  listByRunId(runId: string): Promise<readonly RawArtifact[]> {
    return Promise.resolve(Array.from(this.artifacts.values()).filter((a) => a.runId === runId));
  }

  listBySourceRunId(sourceRunId: string): Promise<readonly RawArtifact[]> {
    return Promise.resolve(
      Array.from(this.artifacts.values()).filter((a) => a.sourceRunId === sourceRunId),
    );
  }

  listExpired(now: Date): Promise<readonly RawArtifact[]> {
    return Promise.resolve(
      Array.from(this.artifacts.values()).filter((a) => a.expiresAt.getTime() <= now.getTime()),
    );
  }

  deleteById(id: string): Promise<boolean> {
    return Promise.resolve(this.artifacts.delete(id));
  }

  async getTotalSizeBytesByRunId(runId: string): Promise<number> {
    const list = await this.listByRunId(runId);
    return list.reduce((sum, a) => sum + a.sizeBytes, 0);
  }

  async getCountByRunId(runId: string): Promise<number> {
    const list = await this.listByRunId(runId);
    return list.length;
  }
}

describe('RawArtifactService and Retention Policies (BOAI-016)', () => {
  let fsPort: InMemoryArtifactFileSystem;
  let repo: InMemoryRawArtifactRepository;
  let service: RawArtifactService;
  const sanitizer = createSqliteArtifactSanitizer();
  const hasher = createNodeCryptoHasher();

  const fixedNow = new Date('2026-09-03T12:00:00.000Z');
  let idCounter = 1;

  beforeEach(() => {
    fsPort = new InMemoryArtifactFileSystem();
    repo = new InMemoryRawArtifactRepository();
    idCounter = 1;
    service = new RawArtifactService({
      storagePort: fsPort,
      repository: repo,
      sanitizer,
      hasher,
      clock: { now: () => fixedNow },
      idGenerator: { generate: () => `art-test-${idCounter++}` },
      limits: {
        maxArtifactSizeBytes: 1024,
        maxRunBudgetBytes: 4096,
        maxArtifactsPerRun: 5,
      },
    });
  });

  describe('Policy Retention Matrix (4 canonical policies)', () => {
    const policies: RawArtifactRetentionPolicy[] = [
      'NONE',
      'ERRORS_ONLY',
      'ERRORS_AND_REVIEW',
      'ALL_LIMITED',
    ];
    const reasons: RawArtifactReason[] = ['ERROR', 'REVIEW', 'DIAGNOSTIC'];

    const expectedMatrix: Record<RawArtifactRetentionPolicy, Record<RawArtifactReason, boolean>> = {
      NONE: { ERROR: false, REVIEW: false, DIAGNOSTIC: false },
      ERRORS_ONLY: { ERROR: true, REVIEW: false, DIAGNOSTIC: false },
      ERRORS_AND_REVIEW: { ERROR: true, REVIEW: true, DIAGNOSTIC: false },
      ALL_LIMITED: { ERROR: true, REVIEW: true, DIAGNOSTIC: true },
    };

    for (const policy of policies) {
      for (const reason of reasons) {
        it(`evaluates ${policy} with reason ${reason} -> ${expectedMatrix[policy][reason]}`, async () => {
          expect(isArtifactRetainable(policy, reason)).toBe(expectedMatrix[policy][reason]);

          const stored = await service.storeArtifact({
            policy,
            reason,
            kind: 'HTTP_PAYLOAD',
            content: 'sample response body',
            contentType: 'text/plain',
          });

          if (expectedMatrix[policy][reason]) {
            expect(stored).not.toBeNull();
            expect(stored?.reason).toBe(reason);
            expect(fsPort.files.size).toBe(1);
          } else {
            expect(stored).toBeNull();
            expect(fsPort.files.size).toBe(0);
          }
        });
      }
    }
  });

  describe('Content Sanitization and Fail-Closed Behavior', () => {
    it('sanitizes bearer tokens in JSON object string values before persistence', async () => {
      const artifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'RAW_API_RESPONSE',
        content: {
          authorizationHeader:
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis',
          safeKey: 'normal-value',
        },
        contentType: 'application/json',
      });

      expect(artifact).not.toBeNull();
      const storedBytes = fsPort.files.get(artifact!.relativePath);
      expect(storedBytes).toBeDefined();

      const text = new TextDecoder().decode(storedBytes);
      expect(text).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(text).toContain('[REDACTED]');
      expect(text).toContain('normal-value');
    });

    it('fails closed when forbidden sensitive keys (e.g. token, password) survive in JSON objects', async () => {
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'RAW_API_RESPONSE',
          content: {
            token: 'secret-token-value',
            safeKey: 'normal-value',
          },
          contentType: 'application/json',
        }),
      ).rejects.toThrow(SensitiveDataDetectedError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('sanitizes bearer tokens in plain text content', async () => {
      const artifact = await service.storeArtifact({
        policy: 'ERRORS_ONLY',
        reason: 'ERROR',
        kind: 'RAW_ERROR_HTML',
        content: 'Authorization header: Bearer secret-token-123456 failed',
        contentType: 'text/html',
      });

      expect(artifact).not.toBeNull();
      const content = await service.getArtifactContent(artifact!.id);
      expect(content?.content).not.toContain('secret-token-123456');
      expect(content?.content).toContain('[REDACTED]');
    });

    it('fails closed when content contains sensitive patterns that trigger validation error', async () => {
      const customSanitizer = {
        sanitizeText: (t: string) => t,
        sanitizeData: <T>(d: T) => d,
        validateNoSensitiveData: () => {
          throw new SensitiveDataDetectedError('Secret detected in raw artifact');
        },
      };

      const strictService = new RawArtifactService({
        storagePort: fsPort,
        repository: repo,
        sanitizer: customSanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => 'leak-attempt' },
      });

      await expect(
        strictService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'LEAK',
          content: 'unredacted token',
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(SensitiveDataDetectedError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('rejects unsupported content types (e.g. number, boolean, binary blobs)', async () => {
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'NUMBER',
          content: 12345 as unknown as string,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
    });
  });

  describe('Limits and Budgets', () => {
    it('rejects artifacts exceeding maxArtifactSizeBytes', async () => {
      const bigContent = 'x'.repeat(1025); // Limit configured to 1024 bytes
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'LARGE',
          content: bigContent,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(ArtifactSizeLimitExceededError);

      expect(fsPort.files.size).toBe(0);
    });

    it('rejects artifact when per-run byte budget is exceeded', async () => {
      const runId = 'run-budget-test';

      // Store 4 artifacts of 900 bytes each = 3600 bytes
      for (let i = 0; i < 4; i++) {
        await service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'CHUNK',
          content: 'a'.repeat(900),
          contentType: 'text/plain',
          runId,
        });
      }

      // 5th artifact of 900 bytes would make 4500 bytes > 4096 limit
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'OVERFLOW',
          content: 'a'.repeat(900),
          contentType: 'text/plain',
          runId,
        }),
      ).rejects.toThrow(RunArtifactBudgetExceededError);
    });

    it('rejects artifact when per-run count limit is exceeded', async () => {
      const runId = 'run-count-test';

      // Store up to limit = 5 artifacts
      for (let i = 0; i < 5; i++) {
        await service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'ITEM',
          content: `item-${i}`,
          contentType: 'text/plain',
          runId,
        });
      }

      // 6th artifact exceeds limit
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'EXTRA',
          content: 'extra',
          contentType: 'text/plain',
          runId,
        }),
      ).rejects.toThrow(RunArtifactBudgetExceededError);
    });
  });

  describe('Fingerprint Integrity and Expiration Calculation', () => {
    it('computes exact SHA-256 fingerprint matching the persisted bytes', async () => {
      const content = 'Exact body text to fingerprint';
      const artifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'REVIEW',
        kind: 'SNAPSHOT',
        content,
        contentType: 'text/plain',
      });

      expect(artifact).not.toBeNull();
      const storedBytes = fsPort.files.get(artifact!.relativePath)!;
      const storedText = new TextDecoder().decode(storedBytes);
      const expectedFingerprint = hasher.hash(storedText);

      expect(artifact!.fingerprint).toBe(expectedFingerprint);
    });

    it('calculates expiration date accurately based on retentionDays', () => {
      const now = new Date('2026-09-03T00:00:00.000Z');
      const expires30 = calculateArtifactExpirationDate(now, 30);
      expect(expires30.toISOString()).toBe('2026-10-03T00:00:00.000Z');

      const expires60 = calculateArtifactExpirationDate(now, 60);
      expect(expires60.toISOString()).toBe('2026-11-02T00:00:00.000Z');

      // Invalid days defaults to 30 days safely
      const expiresDefault = calculateArtifactExpirationDate(now, -5);
      expect(expiresDefault.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    });
  });

  describe('Inspection and Cleanup of Expired Artifacts', () => {
    it('inspects and cleans up expired artifacts idempotently', async () => {
      const expiredDate = new Date('2026-08-01T00:00:00.000Z');
      const validDate = new Date('2026-10-01T00:00:00.000Z');

      // Seed 2 expired artifacts and 1 valid artifact
      const art1 = createRawArtifact({
        id: 'expired-1',
        relativePath: '2026-07/art_expired-1.txt',
        kind: 'HTTP_LOG',
        sizeBytes: 100,
        fingerprint: 'fp-1',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: expiredDate,
      });

      const art2 = createRawArtifact({
        id: 'expired-2',
        relativePath: '2026-07/art_expired-2.txt',
        kind: 'HTTP_LOG',
        sizeBytes: 200,
        fingerprint: 'fp-2',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: expiredDate,
      });

      const artValid = createRawArtifact({
        id: 'valid-1',
        relativePath: '2026-09/art_valid-1.txt',
        kind: 'HTTP_LOG',
        sizeBytes: 150,
        fingerprint: 'fp-valid',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: validDate,
      });

      await repo.save(art1);
      await repo.save(art2);
      await repo.save(artValid);

      // Add file for art1 on disk, leave art2 missing on disk to test convergence
      fsPort.files.set(art1.relativePath, new Uint8Array(100));
      fsPort.files.set(artValid.relativePath, new Uint8Array(150));

      // Inspect expired preview
      const preview = await service.inspectExpired(fixedNow);
      expect(preview.count).toBe(2);
      expect(preview.totalSizeBytes).toBe(300);

      // Perform cleanup
      const summary = await service.cleanupExpiredArtifacts(fixedNow);
      expect(summary.found).toBe(2);
      expect(summary.deleted).toBe(1); // art1 present and deleted
      expect(summary.alreadyMissing).toBe(1); // art2 already missing, metadata converged
      expect(summary.failed).toBe(0);

      // Confirm valid artifact remains intact
      expect(await repo.getById('valid-1')).not.toBeNull();
      expect(fsPort.files.has(artValid.relativePath)).toBe(true);

      // Confirm expired records are gone from DB and disk
      expect(await repo.getById('expired-1')).toBeNull();
      expect(await repo.getById('expired-2')).toBeNull();
      expect(fsPort.files.has(art1.relativePath)).toBe(false);

      // Second run is idempotent no-op
      const secondSummary = await service.cleanupExpiredArtifacts(fixedNow);
      expect(secondSummary.found).toBe(0);
      expect(secondSummary.deleted).toBe(0);
    });
  });
});
