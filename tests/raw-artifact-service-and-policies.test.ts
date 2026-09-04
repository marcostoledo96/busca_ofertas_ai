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
  type SanitizerOptions,
  ArtifactStorageError,
  InvariantViolationError,
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

  describe('Focal Tests: Sanitization and Canaries (HIGH-01 & MEDIUM-02)', () => {
    it('redacts entire Cookie header and prevents partial leakage with generic keys', async () => {
      // 1. Single cookie value
      const artSingle = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'HTTP_HEADERS',
        content: 'Host: example.com\nCookie: session=CANARY_COOKIE_SINGLE\nUser-Agent: agent/1.0',
        contentType: 'text/plain',
      });
      expect(artSingle).not.toBeNull();
      const singleBytes = fsPort.files.get(artSingle!.relativePath);
      expect(singleBytes).toBeDefined();
      const singleText = new TextDecoder().decode(singleBytes);
      expect(singleText).not.toContain('CANARY_COOKIE_SINGLE');
      expect(singleText).toContain('[REDACTED]');
      expect(singleText).toContain('Host: example.com');

      // 2. Cookie with 3 values, 2nd and 3rd with generic key names that do not contain secret keywords
      const artMulti = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'HTTP_HEADERS',
        content:
          'Host: example.com\nCookie: alpha=CANARY_C_MULTI_1; genericBeta=CANARY_C_MULTI_2; standardItem=CANARY_C_MULTI_3\nUser-Agent: agent/1.0',
        contentType: 'text/plain',
      });
      expect(artMulti).not.toBeNull();
      const multiBytes = fsPort.files.get(artMulti!.relativePath);
      expect(multiBytes).toBeDefined();
      const multiText = new TextDecoder().decode(multiBytes);
      expect(multiText).not.toContain('CANARY_C_MULTI_1');
      expect(multiText).not.toContain('CANARY_C_MULTI_2');
      expect(multiText).not.toContain('CANARY_C_MULTI_3');
      expect(multiText).toContain('[REDACTED]');
      expect(multiText).toContain('Host: example.com');
      expect(multiText).toContain('User-Agent: agent/1.0');
    });

    it('redacts Set-Cookie with attributes, Authorization, Proxy-Authorization, and standalone Bearer', async () => {
      const headersContent = [
        'Set-Cookie: authId=CANARY_SET_COOKIE; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Strict',
        'Authorization: Basic CANARY_AUTH_HEADER',
        'Proxy-Authorization: Digest CANARY_PROXY_HEADER',
        'Error: request failed using Bearer CANARY_BEARER_STANDALONE in query',
      ].join('\n');

      const artifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'ERROR',
        kind: 'HTTP_LOG',
        content: headersContent,
        contentType: 'text/plain',
      });

      expect(artifact).not.toBeNull();
      const storedBytes = fsPort.files.get(artifact!.relativePath);
      expect(storedBytes).toBeDefined();
      const text = new TextDecoder().decode(storedBytes);

      expect(text).not.toContain('CANARY_SET_COOKIE');
      expect(text).not.toContain('CANARY_AUTH_HEADER');
      expect(text).not.toContain('CANARY_PROXY_HEADER');
      expect(text).not.toContain('CANARY_BEARER_STANDALONE');
      expect(text).toContain('[REDACTED]');
    });

    it('redacts configurable sensitive keys in JSON (MEDIUM-02)', async () => {
      const inputJson = {
        internalReference: 'CANARY_CUSTOM_1',
        nested: {
          sellerOpaqueField: 'CANARY_CUSTOM_2',
        },
        publicField: 'CANARY_PUBLIC_SAFE',
      };

      const artifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'CUSTOM_REDACTION',
        content: inputJson,
        contentType: 'application/json',
        additionalSensitiveKeys: ['internalReference', 'sellerOpaqueField'],
      });

      expect(artifact).not.toBeNull();
      const storedBytes = fsPort.files.get(artifact!.relativePath);
      expect(storedBytes).toBeDefined();
      const text = new TextDecoder().decode(storedBytes);

      expect(text).not.toContain('CANARY_CUSTOM_1');
      expect(text).not.toContain('CANARY_CUSTOM_2');
      expect(text).toContain('CANARY_PUBLIC_SAFE');
      expect(text).toContain('[REDACTED]');
    });
  });

  describe('Focal Tests: Runtime Binary & ContentType Rejection (HIGH-03)', () => {
    it('strictly rejects Buffer content with 0 filesystem writes and 0 SQLite rows', async () => {
      const buffer = Buffer.from('CANARY_SECRET_BUFFER_BYTES');
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'BINARY_BUFFER',
          content: buffer as unknown as string,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('strictly rejects Uint8Array content with 0 filesystem writes and 0 SQLite rows', async () => {
      const uint8 = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'BINARY_UINT8',
          content: uint8 as unknown as string,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('strictly rejects ArrayBuffer and DataView with 0 filesystem writes and 0 SQLite rows', async () => {
      const arrayBuffer = new ArrayBuffer(16);
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'BINARY_AB',
          content: arrayBuffer as unknown as string,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      const dataView = new DataView(arrayBuffer);
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'BINARY_DV',
          content: dataView as unknown as string,
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('strictly rejects disallowed object types (Date, Map, Set, custom class)', async () => {
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'CLASS_DATE',
          content: new Date() as unknown as Record<string, unknown>,
          contentType: 'application/json',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'CLASS_MAP',
          content: new Map() as unknown as Record<string, unknown>,
          contentType: 'application/json',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      class CustomPayload {
        secret = 'foo';
      }
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'CLASS_CUSTOM',
          content: new CustomPayload() as unknown as Record<string, unknown>,
          contentType: 'application/json',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('strictly rejects arbitrary binary MIME types and enforces contentType coherence', async () => {
      // Disallowed binary mime
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'IMAGE',
          content: 'fake image bytes',
          contentType: 'image/png',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'OCTET',
          content: 'raw stream',
          contentType: 'application/octet-stream',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      // Object content requires JSON contentType
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'MISMATCH',
          content: { key: 'val' },
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      // JSON contentType requires valid JSON string
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'INVALID_JSON',
          content: '{ unclosed json...',
          contentType: 'application/json',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });
  });

  describe('Focal Tests: sourceRunId/runId Invariant and Budget Protection (HIGH-02)', () => {
    it('rejects sourceRunId without runId in domain entity creation', () => {
      expect(() =>
        createRawArtifact({
          id: 'test-inv-1',
          relativePath: '2026-09/art_test-inv-1.txt',
          kind: 'DIAGNOSTIC',
          sizeBytes: 10,
          fingerprint: 'fp',
          reason: 'DIAGNOSTIC',
          contentType: 'text/plain',
          createdAt: fixedNow,
          expiresAt: new Date(fixedNow.getTime() + 86400000),
          sourceRunId: 'sr-without-run',
          runId: null,
        }),
      ).toThrow(InvariantViolationError);
    });

    it('rejects sourceRunId without runId in storeArtifact with 0 writes and 0 rows', async () => {
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'ORPHAN_SOURCE_RUN',
          content: 'sample diagnostic',
          contentType: 'text/plain',
          sourceRunId: 'sr-orphan-1',
          runId: null,
        }),
      ).rejects.toThrow(InvariantViolationError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('proves that an artifact associated with sourceRun cannot evade run budget', async () => {
      // Configure service with tight budget: 100 bytes
      const tightService = new RawArtifactService({
        storagePort: fsPort,
        repository: repo,
        sanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => 'tight-art-1' },
        limits: {
          maxArtifactSizeBytes: 1024,
          maxRunBudgetBytes: 100,
          maxArtifactsPerRun: 10,
        },
      });

      // Storing an 80-byte artifact succeeds
      const first = await tightService.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'ERROR',
        kind: 'DIAGNOSTIC',
        content: 'a'.repeat(80),
        contentType: 'text/plain',
        runId: 'run-budget-test',
        sourceRunId: 'sr-budget-test-1',
      });
      expect(first).not.toBeNull();

      // Second artifact with sourceRunId cannot evade budget because runId is mandatory
      await expect(
        tightService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'ERROR',
          kind: 'DIAGNOSTIC',
          content: 'b'.repeat(50),
          contentType: 'text/plain',
          runId: 'run-budget-test',
          sourceRunId: 'sr-budget-test-2',
        }),
      ).rejects.toThrow(RunArtifactBudgetExceededError);

      expect(await repo.getCountByRunId('run-budget-test')).toBe(1);
    });
  });

  describe('Focal Tests: Entity-First Validation and Observable Compensation (MEDIUM-01)', () => {
    it('produces 0 orphan files when kind or contentType is empty', async () => {
      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: '   ',
          content: 'valid text',
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(InvariantViolationError);

      await expect(
        service.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'VALID_KIND',
          content: 'valid text',
          contentType: '   ',
        }),
      ).rejects.toThrow(UnsupportedArtifactContentError);

      expect(fsPort.files.size).toBe(0);
      expect(repo.artifacts.size).toBe(0);
    });

    it('compensates and deletes file when repository.save fails', async () => {
      const failingRepo = new InMemoryRawArtifactRepository();
      failingRepo.save = () => Promise.reject(new Error('Simulated SQLite disk write failure'));

      const compService = new RawArtifactService({
        storagePort: fsPort,
        repository: failingRepo,
        sanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => 'comp-art-1' },
      });

      await expect(
        compService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'TEST_KIND',
          content: 'test content',
          contentType: 'text/plain',
        }),
      ).rejects.toThrow('Simulated SQLite disk write failure');

      // The file was deleted by compensation
      expect(fsPort.files.size).toBe(0);
    });

    it('throws an observable composite error when both save and compensating delete fail', async () => {
      const failingRepo = new InMemoryRawArtifactRepository();
      failingRepo.save = () => Promise.reject(new Error('Simulated SQLite DB error'));

      const failingFs = new InMemoryArtifactFileSystem();
      failingFs.deleteFile = () => Promise.reject(new Error('Simulated unlink permission denied'));

      const compService = new RawArtifactService({
        storagePort: failingFs,
        repository: failingRepo,
        sanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => 'comp-fail-1' },
      });

      await expect(
        compService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'TEST_KIND',
          content: 'test content',
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(ArtifactStorageError);

      try {
        await compService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'TEST_KIND',
          content: 'test content',
          contentType: 'text/plain',
        });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ArtifactStorageError);
        const storageErr = err as ArtifactStorageError;
        expect(storageErr.code).toBe('ARTIFACT_COMPENSATION_FAILED');
        expect(storageErr.message).toContain('Database save failed');
        expect(storageErr.message).toContain('compensating file deletion');
      }
    });
  });

  describe('Focal Tests: Concurrent Budget Enforcement (MEDIUM-05)', () => {
    it('prevents concurrent stores in the same run from exceeding limits', async () => {
      // Budget: max 1000 bytes. Seed current usage at 800 bytes.
      const runId = 'concurrent-budget-run';
      const initialArt = createRawArtifact({
        id: 'seed-art',
        relativePath: '2026-09/art_seed.txt',
        kind: 'DIAGNOSTIC',
        sizeBytes: 800,
        fingerprint: 'fp-seed',
        reason: 'DIAGNOSTIC',
        contentType: 'text/plain',
        createdAt: fixedNow,
        expiresAt: new Date(fixedNow.getTime() + 86400000),
        runId,
      });
      await repo.save(initialArt);

      const concurrentService = new RawArtifactService({
        storagePort: fsPort,
        repository: repo,
        sanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: {
          generate: () => `concurrent-${idCounter++}`,
        },
        limits: {
          maxArtifactSizeBytes: 1024,
          maxRunBudgetBytes: 1000,
          maxArtifactsPerRun: 10,
        },
      });

      // Both stores want to write 150 bytes: 800 + 150 = 950 <= 1000, but 950 + 150 = 1100 > 1000
      const content = 'c'.repeat(150);
      const results = await Promise.allSettled([
        concurrentService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'ERROR',
          kind: 'CONCURRENT',
          content,
          contentType: 'text/plain',
          runId,
        }),
        concurrentService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'ERROR',
          kind: 'CONCURRENT',
          content,
          contentType: 'text/plain',
          runId,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const firstRejected = rejected[0];
      expect(firstRejected).toBeDefined();
      if (firstRejected && firstRejected.status === 'rejected') {
        expect(firstRejected.reason).toBeInstanceOf(RunArtifactBudgetExceededError);
      }

      const finalBytes = await repo.getTotalSizeBytesByRunId(runId);
      expect(finalBytes).toBeLessThanOrEqual(1000);
      expect(finalBytes).toBe(950);

      const finalCount = await repo.getCountByRunId(runId);
      expect(finalCount).toBe(2); // seed + exactly 1 fulfilled
    });
  });

  describe('Strict Content-Type Validation (LOW)', () => {
    it('accepts application/json and application/json with optional parameters', async () => {
      const jsonArtifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'API_RESPONSE',
        content: JSON.stringify({ status: 'ok' }),
        contentType: 'application/json',
      });
      expect(jsonArtifact).not.toBeNull();
      expect(jsonArtifact?.contentType).toBe('application/json');

      const jsonWithParams = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'API_RESPONSE',
        content: JSON.stringify({ status: 'ok_params' }),
        contentType: 'application/json; charset=utf-8',
      });
      expect(jsonWithParams).not.toBeNull();
      expect(jsonWithParams?.contentType).toBe('application/json; charset=utf-8');
    });

    it('accepts text/* MIME types with optional parameters', async () => {
      const textPlain = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'LOG',
        content: 'log line 1\nlog line 2',
        contentType: 'text/plain; charset=utf-8',
      });
      expect(textPlain).not.toBeNull();

      const textHtml = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'PAGE',
        content: '<html><body>test</body></html>',
        contentType: 'text/html',
      });
      expect(textHtml).not.toBeNull();
    });

    const rejectedStructuredJsonTypes = [
      'application/problem+json',
      'application/problem+json; charset=utf-8',
      'application/ld+json',
      'application/vnd.api+json',
      'application/custom+json',
      'application/feed+json',
      'application/merge-patch+json',
      'application/xml',
      'application/octet-stream',
      'image/png',
    ];

    for (const rejectedType of rejectedStructuredJsonTypes) {
      it(`rejects structured suffix or unsupported type '${rejectedType}' with 0 writes and 0 rows`, async () => {
        const initialFilesCount = fsPort.files.size;
        const initialRowsCount = repo.artifacts.size;

        await expect(
          service.storeArtifact({
            policy: 'ALL_LIMITED',
            reason: 'DIAGNOSTIC',
            kind: 'PAYLOAD',
            content: '{"error": "test"}',
            contentType: rejectedType,
          }),
        ).rejects.toThrow(UnsupportedArtifactContentError);

        expect(fsPort.files.size).toBe(initialFilesCount);
        expect(repo.artifacts.size).toBe(initialRowsCount);
      });
    }
  });

  describe('End-to-End and Fail-Closed additionalSensitivePatterns (COBERTURA)', () => {
    it('redacts custom canary pattern end-to-end from persisted artifact file', async () => {
      const canaryToken = 'CANARY_SECRET_ALPHA99';
      const customPattern = /CANARY_SECRET_[A-Z0-9]+/g;

      const artifact = await service.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'CANARY_TEST',
        content: `Error occurred with auth token ${canaryToken} during execution`,
        contentType: 'text/plain',
        additionalSensitivePatterns: [customPattern],
      });

      expect(artifact).not.toBeNull();
      if (!artifact) {
        throw new Error('Expected artifact to be defined');
      }

      // Read back persisted file from storage
      const persistedBytes = fsPort.files.get(artifact.relativePath);
      expect(persistedBytes).toBeDefined();
      if (!persistedBytes) {
        throw new Error('Expected persistedBytes to be defined');
      }
      const persistedContent = new TextDecoder().decode(persistedBytes);

      expect(persistedContent).not.toContain(canaryToken);
      expect(persistedContent).toContain(
        'Error occurred with auth token [REDACTED] during execution',
      );

      // Verify repository record matches the sanitized content
      const saved = await repo.getById(artifact.id);
      expect(saved).not.toBeNull();
      expect(saved?.sizeBytes).toBe(persistedBytes.length);
      expect(saved?.fingerprint).toBe(hasher.hash(persistedContent));
    });

    it('redacts custom canary pattern in JSON artifact via service constructor default options', async () => {
      const canarySecret = 'CANARY_CONSTRUCTOR_TOKEN_123';
      const customPattern = /CANARY_CONSTRUCTOR_TOKEN_\d+/g;

      const customService = new RawArtifactService({
        storagePort: fsPort,
        repository: repo,
        sanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => `art-canary-${idCounter++}` },
        defaultAdditionalSensitivePatterns: [customPattern],
      });

      const artifact = await customService.storeArtifact({
        policy: 'ALL_LIMITED',
        reason: 'DIAGNOSTIC',
        kind: 'JSON_PAYLOAD',
        content: {
          session: 'session-ok',
          nested: {
            customTrace: `prefix_${canarySecret}_suffix`,
          },
        },
        contentType: 'application/json',
      });

      expect(artifact).not.toBeNull();
      if (!artifact) {
        throw new Error('Expected artifact to be defined');
      }

      const persistedBytes = fsPort.files.get(artifact.relativePath);
      expect(persistedBytes).toBeDefined();
      if (!persistedBytes) {
        throw new Error('Expected persistedBytes to be defined');
      }
      const parsed = JSON.parse(new TextDecoder().decode(persistedBytes)) as {
        nested: { customTrace: string };
      };

      expect(parsed.nested.customTrace).toBe('prefix_[REDACTED]_suffix');
      expect(new TextDecoder().decode(persistedBytes)).not.toContain(canarySecret);
    });

    it('fails closed when sanitizer fails to redact sensitive pattern (0 writes, 0 rows)', async () => {
      // Create a faulty sanitizer whose sanitizeText ignores additionalSensitivePatterns,
      // but whose validateNoSensitiveData uses the standard detector to catch unredacted leaks.
      const leakySanitizer = {
        sanitizeText: (text: string) => text, // Leaks the text without redacting
        sanitizeData: <T>(data: T) => data,
        validateNoSensitiveData: (data: unknown, options?: SanitizerOptions) => {
          // Real validator from storage-sqlite detects the leak and throws SensitiveDataDetectedError
          sanitizer.validateNoSensitiveData(data, options);
        },
      };

      const failClosedService = new RawArtifactService({
        storagePort: fsPort,
        repository: repo,
        sanitizer: leakySanitizer,
        hasher,
        clock: { now: () => fixedNow },
        idGenerator: { generate: () => `art-leak-${idCounter++}` },
      });

      const initialFilesCount = fsPort.files.size;
      const initialRowsCount = repo.artifacts.size;

      await expect(
        failClosedService.storeArtifact({
          policy: 'ALL_LIMITED',
          reason: 'DIAGNOSTIC',
          kind: 'LEAK_CHECK',
          content: 'Payload with unredacted CANARY_LEAK_TOKEN_XYZ',
          contentType: 'text/plain',
          additionalSensitivePatterns: [/CANARY_LEAK_TOKEN_[A-Z]+/g],
        }),
      ).rejects.toThrow(SensitiveDataDetectedError);

      // Verify strict fail-closed: 0 writes to filesystem, 0 rows in database
      expect(fsPort.files.size).toBe(initialFilesCount);
      expect(repo.artifacts.size).toBe(initialRowsCount);
    });
  });
});
