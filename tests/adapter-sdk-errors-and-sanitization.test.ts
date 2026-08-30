import { describe, it, expect } from 'vitest';
import {
  createSourceDiagnostics,
  DEFAULT_RETRYABLE_BY_CODE,
  isSourceAdapterError,
  isSourceErrorCode,
  REDACTED_PLACEHOLDER,
  sanitizeData,
  sanitizeEvidence,
  sanitizeString,
  SOURCE_ERROR_CODES,
  SourceAdapterError,
  type SourceErrorCode,
} from '@busca-ofertas-ai/adapter-sdk';

describe('Adapter SDK Error Model and Secret Sanitization (BOAI-003)', () => {
  const SENTINEL_SECRET = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';

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

  describe('Secret Safety Proof: Sentinel Token Redaction', () => {
    it('redacts sentinel secret from error message and safeMessage', () => {
      const rawMessage = `Failed with auth error using token: ${SENTINEL_SECRET}`;
      const error = new SourceAdapterError({
        code: 'AUTHENTICATION_REQUIRED',
        message: rawMessage,
      });

      expect(error.message).not.toContain(SENTINEL_SECRET);
      expect(error.safeMessage).not.toContain(SENTINEL_SECRET);
      expect(error.message).toContain(REDACTED_PLACEHOLDER);
    });

    it('redacts sentinel secret from evidence array', () => {
      const rawEvidence = [
        `Header Authorization: Bearer ${SENTINEL_SECRET}`,
        `URL parameter &token=${SENTINEL_SECRET}&mode=query`,
      ];
      const error = new SourceAdapterError({
        code: 'NETWORK_ERROR',
        message: 'Connection failed',
        evidence: rawEvidence,
      });

      for (const ev of error.evidence) {
        expect(ev).not.toContain(SENTINEL_SECRET);
        expect(ev).toContain(REDACTED_PLACEHOLDER);
      }
    });

    it('redacts sentinel secret from JSON serialization representation', () => {
      const error = new SourceAdapterError({
        code: 'RATE_LIMITED',
        message: `Query failed with secret: ${SENTINEL_SECRET}`,
        evidence: [`evidence containing ${SENTINEL_SECRET}`],
      });

      const jsonOutput = JSON.stringify(error);
      expect(jsonOutput).not.toContain(SENTINEL_SECRET);
      expect(jsonOutput).toContain(REDACTED_PLACEHOLDER);
    });

    it('redacts sentinel secret from artifactIds in SourceAdapterError', () => {
      const error = new SourceAdapterError({
        code: 'PARSER_FAILED',
        message: 'Schema mismatch',
        artifactIds: [`artifact-${SENTINEL_SECRET}`, SENTINEL_SECRET],
      });

      expect(error.artifactIds[0]).not.toContain(SENTINEL_SECRET);
      expect(error.artifactIds[0]).toBe(`artifact-${REDACTED_PLACEHOLDER}`);
      expect(error.artifactIds[1]).toBe(REDACTED_PLACEHOLDER);

      const jsonOutput = JSON.stringify(error);
      expect(jsonOutput).not.toContain(SENTINEL_SECRET);
      expect(JSON.stringify(error.toJSON())).not.toContain(SENTINEL_SECRET);
    });

    it('redacts sentinel secret from createSourceDiagnostics boundary', () => {
      const diagnostics = createSourceDiagnostics({
        pagesRequested: 2,
        pagesCompleted: 1,
        rawItemsCount: 10,
        parsedItemsCount: 8,
        rejectedItemsCount: 2,
        stopReason: 'ALL_PAGES_FETCHED',
        sanitizedCursor: `cursor-${SENTINEL_SECRET}`,
        warnings: [`warning with ${SENTINEL_SECRET}`, `Bearer ${SENTINEL_SECRET}`],
        collectorId: `collector-${SENTINEL_SECRET}`,
      });

      expect(diagnostics.sanitizedCursor).toBe(`cursor-${REDACTED_PLACEHOLDER}`);
      expect(diagnostics.warnings[0]).toBe(`warning with ${REDACTED_PLACEHOLDER}`);
      expect(diagnostics.warnings[1]).toBe(`Bearer ${REDACTED_PLACEHOLDER}`);
      expect(diagnostics.collectorId).toBe(`collector-${REDACTED_PLACEHOLDER}`);

      const jsonOutput = JSON.stringify(diagnostics);
      expect(jsonOutput).not.toContain(SENTINEL_SECRET);
      expect(jsonOutput).not.toContain('SUPER_SECRET');
    });

    it('redacts nested keys and string patterns in structured data', () => {
      const payload = {
        publicInfo: 'Nintendo Switch',
        secretToken: SENTINEL_SECRET,
        authorization: `Bearer ${SENTINEL_SECRET}`,
        nested: {
          password: 'my-password-123',
          cookie: 'session=abc',
          details: `Contains ${SENTINEL_SECRET} inline`,
        },
      };

      const sanitized = sanitizeData(payload);
      expect(JSON.stringify(sanitized)).not.toContain(SENTINEL_SECRET);
      expect(JSON.stringify(sanitized)).not.toContain('my-password-123');
      expect(sanitized.secretToken).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.authorization).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.password).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.cookie).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.nested.details).toBe(`Contains ${REDACTED_PLACEHOLDER} inline`);
      expect(sanitized.publicInfo).toBe('Nintendo Switch');
    });

    it('sanitizes structured logger context and artifact metadata', () => {
      const logContext = {
        adapterId: 'facebook-graphql',
        token: SENTINEL_SECRET,
        headers: {
          authorization: `Bearer ${SENTINEL_SECRET}`,
          cookie: 'c_user=12345; xs=abc',
        },
      };
      const sanitizedLogContext = sanitizeData(logContext);
      expect(JSON.stringify(sanitizedLogContext)).not.toContain(SENTINEL_SECRET);
      expect(JSON.stringify(sanitizedLogContext)).not.toContain('12345');

      const artifactMetadata = {
        sourceId: 'facebook',
        sessionToken: SENTINEL_SECRET,
      };
      const sanitizedMetadata = sanitizeData(artifactMetadata);
      expect(JSON.stringify(sanitizedMetadata)).not.toContain(SENTINEL_SECRET);
    });

    it('sanitizes strings and evidence arrays with utility functions', () => {
      expect(sanitizeString(`raw message with secret ${SENTINEL_SECRET}`)).toBe(
        `raw message with secret ${REDACTED_PLACEHOLDER}`,
      );
      expect(sanitizeString(`token: ${SENTINEL_SECRET}`)).toBe(REDACTED_PLACEHOLDER);
      expect(sanitizeEvidence([`Bearer ${SENTINEL_SECRET}`])).toEqual([
        `Bearer ${REDACTED_PLACEHOLDER}`,
      ]);
      expect(sanitizeEvidence(undefined)).toEqual([]);
    });
  });
});
