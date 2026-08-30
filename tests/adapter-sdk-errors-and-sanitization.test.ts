import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createSanitizedArtifactWriter,
  createSanitizedLogger,
  createSourceDiagnostics,
  DEFAULT_RETRYABLE_BY_CODE,
  isSourceAdapterError,
  isSourceErrorCode,
  type LogEventContext,
  MAX_SANITIZATION_DEPTH,
  type RawArtifactWriter,
  REDACTED_PLACEHOLDER,
  sanitizeData,
  sanitizeEvidence,
  sanitizeString,
  SOURCE_ERROR_CODES,
  SourceAdapterError,
  type SourceErrorCode,
  type StructuredLogger,
  type WriteArtifactParams,
} from '@busca-ofertas-ai/adapter-sdk';

describe('Adapter SDK Error Model and Secret Sanitization (BOAI-003)', () => {
  const SENTINEL_1 = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';
  const SENTINEL_2 = 'ANOTHER_OPAQUE_SECRET_82f1d1';
  const SENTINEL_DEEP = 'DEEP_SECRET_SHOULD_NOT_LEAK';

  describe('SourceErrorCode Contract', () => {
    it('defines all contractual error codes from ADR-002 and docs', () => {
      const expectedCodes: SourceErrorCode[] = [
        'AUTHENTICATION_REQUIRED',
        'MANUAL_INTERVENTION_REQUIRED',
        'RATE_LIMITED',
        'NETWORK_ERROR',
        'SOURCE_UNAVAILABLE',
        'CONTRACT_CHANGED',
        'PARSER_FAILED',
        'TIMEOUT',
        'CONFIGURATION_UNSUPPORTED',
      ];

      expect(SOURCE_ERROR_CODES).toEqual(expectedCodes);
      for (const code of expectedCodes) {
        expect(isSourceErrorCode(code)).toBe(true);
        expect(typeof DEFAULT_RETRYABLE_BY_CODE[code]).toBe('boolean');
      }
    });

    it('classifies retryability consistently with documentation', () => {
      expect(DEFAULT_RETRYABLE_BY_CODE['NETWORK_ERROR']).toBe(true);
      expect(DEFAULT_RETRYABLE_BY_CODE['RATE_LIMITED']).toBe(true);
      expect(DEFAULT_RETRYABLE_BY_CODE['TIMEOUT']).toBe(true);
      expect(DEFAULT_RETRYABLE_BY_CODE['SOURCE_UNAVAILABLE']).toBe(true);

      expect(DEFAULT_RETRYABLE_BY_CODE['AUTHENTICATION_REQUIRED']).toBe(false);
      expect(DEFAULT_RETRYABLE_BY_CODE['MANUAL_INTERVENTION_REQUIRED']).toBe(false);
      expect(DEFAULT_RETRYABLE_BY_CODE['CONTRACT_CHANGED']).toBe(false);
      expect(DEFAULT_RETRYABLE_BY_CODE['PARSER_FAILED']).toBe(false);
      expect(DEFAULT_RETRYABLE_BY_CODE['CONFIGURATION_UNSUPPORTED']).toBe(false);
    });

    it('rejects unknown error codes via type guard', () => {
      expect(isSourceErrorCode('UNKNOWN_ERROR')).toBe(false);
      expect(isSourceErrorCode('')).toBe(false);
      expect(isSourceErrorCode(null)).toBe(false);
    });
  });

  describe('SourceAdapterError Structure and Serialization', () => {
    it('creates a structured error with default retryability', () => {
      const error = new SourceAdapterError({
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to gateway',
        evidence: ['DNS lookup timeout', 'GET /search status 503'],
      });

      expect(error.name).toBe('SourceAdapterError');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.evidence).toHaveLength(2);
      expect(error.artifactIds).toHaveLength(0);
      expect(error.safeMessage).toBe('Failed to connect to gateway');
      expect(isSourceAdapterError(error)).toBe(true);
    });

    it('allows overriding default retryability when context dictates', () => {
      const error = new SourceAdapterError({
        code: 'NETWORK_ERROR',
        message: 'TLS certificate expired (non-retryable)',
        retryable: false,
      });

      expect(error.retryable).toBe(false);
    });

    it('serializes cleanly to JSON without leaking stack or raw cause', () => {
      const internalCause = { rawHeaders: { authorization: 'Bearer secret' } };
      const error = new SourceAdapterError({
        code: 'PARSER_FAILED',
        message: 'Schema mismatch in JSON response',
        evidence: ['missing field price_amount'],
        artifactIds: ['art-001'],
        cause: internalCause,
      });

      const serialized = error.toJSON();
      expect(serialized).toEqual({
        name: 'SourceAdapterError',
        code: 'PARSER_FAILED',
        message: 'Schema mismatch in JSON response',
        retryable: false,
        evidence: ['missing field price_amount'],
        artifactIds: ['art-001'],
      });

      const jsonString = JSON.stringify(error);
      expect(jsonString).not.toContain('rawHeaders');
      expect(jsonString).not.toContain('authorization');
      expect(error.getInternalCause()).toBe(internalCause);
    });

    it('rejects construction with invalid error code', () => {
      expect(
        () =>
          new SourceAdapterError({
            code: 'INVALID_CODE' as unknown as SourceErrorCode,
            message: 'test',
          }),
      ).toThrow("Invalid SourceErrorCode: 'INVALID_CODE'");
    });
  });

  describe('Secret Safety & Sentinel Independence', () => {
    it('ensures production SDK source files do not contain test sentinel literals', () => {
      const srcDir = path.resolve(__dirname, '../packages/adapter-sdk/src');
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
      const sentinels = [SENTINEL_1, SENTINEL_2, SENTINEL_DEEP];

      for (const file of files) {
        const fullPath = path.join(srcDir, file);
        if (fs.statSync(fullPath).isFile() && (file.endsWith('.ts') || file.endsWith('.js'))) {
          const code = fs.readFileSync(fullPath, 'utf8');
          for (const s of sentinels) {
            expect(
              code.includes(s),
              `Test sentinel '${s}' must not appear in production source file '${file}'`,
            ).toBe(false);
          }
        }
      }
    });

    it('redacts Bearer and contextual token patterns from error message and safeMessage', () => {
      const rawMessage = `Failed with auth error: Bearer ${SENTINEL_1}`;
      const error = new SourceAdapterError({
        code: 'AUTHENTICATION_REQUIRED',
        message: rawMessage,
      });

      expect(error.message).not.toContain(SENTINEL_1);
      expect(error.safeMessage).not.toContain(SENTINEL_1);
      expect(error.message).toContain(REDACTED_PLACEHOLDER);
    });

    it('redacts contextual secrets from evidence array', () => {
      const rawEvidence = [
        `Header Authorization: Bearer ${SENTINEL_1}`,
        `URL parameter token=${SENTINEL_2}&mode=query`,
      ];
      const error = new SourceAdapterError({
        code: 'NETWORK_ERROR',
        message: 'Connection failed',
        evidence: rawEvidence,
      });

      for (const ev of error.evidence) {
        expect(ev).not.toContain(SENTINEL_1);
        expect(ev).not.toContain(SENTINEL_2);
        expect(ev).toContain(REDACTED_PLACEHOLDER);
      }
    });

    it('redacts contextual secrets from JSON serialization representation', () => {
      const error = new SourceAdapterError({
        code: 'RATE_LIMITED',
        message: `Query failed with Bearer ${SENTINEL_1}`,
        evidence: [`evidence containing password=${SENTINEL_2}`],
      });

      const jsonOutput = JSON.stringify(error);
      expect(jsonOutput).not.toContain(SENTINEL_1);
      expect(jsonOutput).not.toContain(SENTINEL_2);
      expect(jsonOutput).toContain(REDACTED_PLACEHOLDER);
    });

    it('redacts contextual secrets from artifactIds in SourceAdapterError', () => {
      const error = new SourceAdapterError({
        code: 'PARSER_FAILED',
        message: 'Schema mismatch',
        artifactIds: [`artifact-Bearer ${SENTINEL_1}`, `token=${SENTINEL_2}`],
      });

      expect(error.artifactIds[0]).not.toContain(SENTINEL_1);
      expect(error.artifactIds[1]).not.toContain(SENTINEL_2);
      expect(error.artifactIds[0]).toBe(`artifact-${REDACTED_PLACEHOLDER}`);
      expect(error.artifactIds[1]).toBe(REDACTED_PLACEHOLDER);

      const jsonOutput = JSON.stringify(error);
      expect(jsonOutput).not.toContain(SENTINEL_1);
      expect(jsonOutput).not.toContain(SENTINEL_2);
      expect(JSON.stringify(error.toJSON())).not.toContain(SENTINEL_1);
    });

    it('redacts contextual secrets from createSourceDiagnostics boundary', () => {
      const diagnostics = createSourceDiagnostics({
        pagesRequested: 2,
        pagesCompleted: 1,
        rawItemsCount: 10,
        parsedItemsCount: 8,
        rejectedItemsCount: 2,
        stopReason: 'ALL_PAGES_FETCHED',
        sanitizedCursor: `cursor-token=${SENTINEL_1}`,
        warnings: [`warning with Bearer ${SENTINEL_2}`, `password=${SENTINEL_1}`],
        collectorId: `collector-Bearer ${SENTINEL_2}`,
      });

      expect(diagnostics.sanitizedCursor).toBe(`cursor-${REDACTED_PLACEHOLDER}`);
      expect(diagnostics.warnings[0]).toBe(`warning with ${REDACTED_PLACEHOLDER}`);
      expect(diagnostics.warnings[1]).toBe(REDACTED_PLACEHOLDER);
      expect(diagnostics.collectorId).toBe(`collector-${REDACTED_PLACEHOLDER}`);

      const jsonOutput = JSON.stringify(diagnostics);
      expect(jsonOutput).not.toContain(SENTINEL_1);
      expect(jsonOutput).not.toContain(SENTINEL_2);
    });

    it('redacts sensitive keys and string patterns in structured data', () => {
      const payload = {
        publicInfo: 'Nintendo Switch',
        secretToken: SENTINEL_1,
        authorization: `Bearer ${SENTINEL_2}`,
        apiKey: SENTINEL_1,
        nested: {
          password: 'my-password-123',
          cookie: 'session=abc',
          details: `Contains Bearer ${SENTINEL_2} inline`,
        },
      };

      const sanitized = sanitizeData(payload);
      expect(JSON.stringify(sanitized)).not.toContain(SENTINEL_1);
      expect(JSON.stringify(sanitized)).not.toContain(SENTINEL_2);
      expect(JSON.stringify(sanitized)).not.toContain('my-password-123');
      expect(sanitized.secretToken).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.authorization).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.apiKey).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.password).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.cookie).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.details).toBe(`Contains ${REDACTED_PLACEHOLDER} inline`);
      expect(sanitized.publicInfo).toBe('Nintendo Switch');
    });

    it('does not over-redact innocent keys like keyboard, monkey, hockey', () => {
      const payload = {
        keyboard: 'mechanical',
        monkey: 'curious',
        hockey: 'sport',
        title: 'Nintendo Switch Lite',
      };

      const sanitized = sanitizeData(payload);
      expect(sanitized).toEqual(payload);
      expect(sanitized.keyboard).toBe('mechanical');
      expect(sanitized.monkey).toBe('curious');
      expect(sanitized.hockey).toBe('sport');
    });

    it('prevents deep nesting bypass and replaces subtrees beyond max depth with placeholder', () => {
      expect(MAX_SANITIZATION_DEPTH).toBe(10);

      interface NestedObj {
        level: number;
        nested?: NestedObj | { token: string };
      }

      let deeplyNested: NestedObj | { token: string } = { token: SENTINEL_DEEP };
      for (let i = 12; i >= 0; i--) {
        deeplyNested = { level: i, nested: deeplyNested };
      }

      const sanitized = sanitizeData(deeplyNested);
      const json = JSON.stringify(sanitized);

      expect(json).not.toContain(SENTINEL_DEEP);
      expect(json).toContain(REDACTED_PLACEHOLDER);
    });

    it('sanitizes logger context automatically through createSanitizedLogger wrapper', () => {
      interface CapturedLog {
        event: string;
        context?: LogEventContext | undefined;
      }
      const captured: CapturedLog[] = [];
      const underlyingLogger: StructuredLogger = {
        debug: (event, context) => captured.push({ event, context }),
        info: (event, context) => captured.push({ event, context }),
        warn: (event, context) => captured.push({ event, context }),
        error: (event, context) => captured.push({ event, context }),
      };

      const safeLogger = createSanitizedLogger(underlyingLogger);
      safeLogger.info('source.search.completed', {
        sourceId: 'facebook',
        token: SENTINEL_1,
        auth: {
          bearerToken: SENTINEL_2,
        },
        keyboard: 'mechanical',
        monkey: 'island',
      });

      expect(captured).toHaveLength(1);
      const received = captured[0]?.context;
      expect(received).toBeDefined();
      if (received) {
        expect(received['sourceId']).toBe('facebook');
        expect(received['token']).toBe(REDACTED_PLACEHOLDER);
        expect(received['keyboard']).toBe('mechanical');
        expect(received['monkey']).toBe('island');
        expect(JSON.stringify(received)).not.toContain(SENTINEL_1);
        expect(JSON.stringify(received)).not.toContain(SENTINEL_2);
      }
    });

    it('sanitizes artifact metadata automatically through createSanitizedArtifactWriter wrapper', async () => {
      const captured: WriteArtifactParams[] = [];
      const underlyingWriter: RawArtifactWriter = {
        writeArtifact: (params) => {
          captured.push(params);
          return Promise.resolve('art-ref-123');
        },
      };

      const safeWriter = createSanitizedArtifactWriter(underlyingWriter);
      const ref = await safeWriter.writeArtifact({
        artifactType: 'diagnostic',
        contentType: 'application/json',
        content: '{"raw": "html"}',
        metadata: {
          sessionToken: SENTINEL_1,
          apiKey: SENTINEL_2,
          safeName: 'Switch Lite',
        },
      });

      expect(ref).toBe('art-ref-123');
      expect(captured).toHaveLength(1);
      const received = captured[0];
      expect(received).toBeDefined();
      expect(received?.metadata).toBeDefined();
      const metadata = received?.metadata;
      if (metadata) {
        expect(metadata['safeName']).toBe('Switch Lite');
        expect(metadata['sessionToken']).toBe(REDACTED_PLACEHOLDER);
        expect(metadata['apiKey']).toBe(REDACTED_PLACEHOLDER);
        expect(JSON.stringify(metadata)).not.toContain(SENTINEL_1);
        expect(JSON.stringify(metadata)).not.toContain(SENTINEL_2);
      }
    });

    it('sanitizes strings and evidence arrays with utility functions', () => {
      expect(sanitizeString(`raw message with Bearer ${SENTINEL_1}`)).toBe(
        `raw message with ${REDACTED_PLACEHOLDER}`,
      );
      expect(sanitizeString(`token=${SENTINEL_2}`)).toBe(REDACTED_PLACEHOLDER);
      expect(sanitizeEvidence([`Bearer ${SENTINEL_1}`, `password=${SENTINEL_2}`])).toEqual([
        REDACTED_PLACEHOLDER,
        REDACTED_PLACEHOLDER,
      ]);
      expect(sanitizeEvidence(undefined)).toEqual([]);
    });
  });
});
