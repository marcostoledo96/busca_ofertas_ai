import { describe, it, expect, vi } from 'vitest';
import {
  FakeTerminal,
  ErrorPresenter,
  CliError,
  EXIT_CODES,
  sanitizeDiagnosticData,
  sanitizeString,
  InMemoryDiagnosticLogger,
  SanitizedDiagnosticLogger,
} from '@busca-ofertas-ai/cli';

describe('CLI Errors, Presentation, and Security (BOAI-006)', () => {
  it('presents known CliError with code, user message, and suggested action', () => {
    const terminal = new FakeTerminal();
    const presenter = new ErrorPresenter(terminal);

    const error = new CliError({
      code: 'CONFIGURATION_INVALID',
      userMessage: 'La búsqueda no tiene una configuración válida.',
      suggestedAction: 'Revisá la configuración antes de ejecutar.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });

    presenter.present(error);

    const raw = terminal.getRawOutput();
    expect(raw).toContain('[CONFIGURATION_INVALID] La búsqueda no tiene una configuración válida.');
    expect(raw).toContain('Acción sugerida: Revisá la configuración antes de ejecutar.');
    expect(presenter.resolveExitCode(error)).toBe(EXIT_CODES.INVALID_CONFIGURATION);
  });

  it('converts unknown generic error into safe INTERNAL_ERROR output without leaking internals', () => {
    const terminal = new FakeTerminal();
    const presenter = new ErrorPresenter(terminal);

    const rawInternalError = new Error('Database connection failed on socket /tmp/secret_db.sock');
    rawInternalError.stack =
      'Error: Database connection failed\n    at internalSocketConnect (db.ts:42:1)';

    presenter.present(rawInternalError);

    const raw = terminal.getRawOutput();
    expect(raw).toContain('[INTERNAL_ERROR] Ocurrió un error interno no esperado.');
    expect(raw).toContain('Acción sugerida: Revisá los diagnósticos para más detalles.');

    // Negative assertions: ensure internals are not leaked to normal UI
    expect(raw).not.toContain('/tmp/secret_db.sock');
    expect(raw).not.toContain('internalSocketConnect');
    expect(raw).not.toContain('db.ts:42:1');
    expect(presenter.resolveExitCode(rawInternalError)).toBe(EXIT_CODES.INTERNAL_ERROR);
  });

  it('SECURITY NEGATIVE PROOF: does NOT print synthetic secrets in error cause to terminal', () => {
    const terminal = new FakeTerminal();
    const presenter = new ErrorPresenter(terminal);

    const syntheticSecret = 'fake-test-credential-bearer-token-xyz789';
    const errorWithSecretCause = new CliError({
      code: 'SOURCE_AUTHENTICATION_REQUIRED',
      userMessage: 'La sesión de la fuente expiró.',
      suggestedAction: 'Iniciá sesión nuevamente en el navegador.',
      exitCode: EXIT_CODES.MANUAL_INTERVENTION_REQUIRED,
      cause: {
        rawHeaders: {
          authorization: `Bearer ${syntheticSecret}`,
          cookie: `session_id=${syntheticSecret}`,
        },
        internalTrace: `Failed authenticating with secret=${syntheticSecret}`,
      },
    });

    presenter.present(errorWithSecretCause);

    const raw = terminal.getRawOutput();
    expect(raw).toContain('[SOURCE_AUTHENTICATION_REQUIRED] La sesión de la fuente expiró.');
    expect(raw).toContain('Acción sugerida: Iniciá sesión nuevamente en el navegador.');

    // Strict negative proofs
    expect(raw).not.toContain(syntheticSecret);
    expect(raw).not.toContain('Bearer');
    expect(raw).not.toContain('session_id');
    expect(raw).not.toContain('internalTrace');
    expect(raw).not.toContain('rawHeaders');
  });

  it('Finding 2: sanitizeString and sanitizeDiagnosticData redact all contractual sensitive formats', () => {
    const secret = 'fake-synthetic-secret-value-12345';
    const syntheticGhp = ['ghp', 'fakePersonalAccessToken36CharsHere00'].join('_');
    const syntheticPat = [
      'github',
      'pat',
      'fakeFineGrainedToken82CharsLongSecretStringHere123',
    ].join('_');

    const testStrings = [
      `request failed token=${secret}`,
      `request failed token: ${secret}`,
      `request failed password=${secret}`,
      `request failed password: ${secret}`,
      `request failed secret=${secret}`,
      `request failed secret: ${secret}`,
      `request failed api_key=${secret}`,
      `request failed apikey=${secret}`,
      `request failed access_token=${secret}`,
      `request failed refresh_token=${secret}`,
      `Cookie: session=${secret}; other=123`,
      `Set-Cookie: auth=${secret}`,
      `Authorization: Bearer ${secret}`,
      `Using ${syntheticGhp}`,
      `Using ${syntheticPat}`,
    ];

    for (const str of testStrings) {
      const sanitized = sanitizeString(str);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).not.toContain('fakePersonalAccessToken');
      expect(sanitized).not.toContain('fakeFineGrainedToken');
      expect(sanitized).toContain('[REDACTED]');
    }

    const testObject = {
      user: 'alice',
      password: secret,
      api_key: secret,
      authToken: secret,
      sessionKey: secret,
      nested: {
        cookie: `c_user=${secret}`,
        authHeader: `Bearer ${secret}`,
        safe: 'normal-value',
      },
    };

    const sanitizedObj = sanitizeDiagnosticData(testObject);
    expect(sanitizedObj.user).toBe('alice');
    expect(sanitizedObj.password).toBe('[REDACTED]');
    expect(sanitizedObj.api_key).toBe('[REDACTED]');
    expect(sanitizedObj.authToken).toBe('[REDACTED]');
    expect(sanitizedObj.sessionKey).toBe('[REDACTED]');
    expect(sanitizedObj.nested.cookie).toBe('[REDACTED]');
    expect(sanitizedObj.nested.authHeader).not.toContain(secret);
    expect(sanitizedObj.nested.safe).toBe('normal-value');
  });

  it('Finding 2: SanitizedDiagnosticLogger writes sanitized entries to stderr without leaking secrets', () => {
    const secret = 'fake-secret-999-never-leak';
    let capturedStderr = '';

    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: Uint8Array | string) => {
        capturedStderr += chunk.toString();
        return true;
      });

    try {
      const logger = new SanitizedDiagnosticLogger({ enabled: true });
      logger.error(`Failed request with token=${secret}`, new Error(`password=${secret}`), {
        apiKey: secret,
        message: `Authorization: Bearer ${secret}`,
      });

      expect(capturedStderr).not.toContain(secret);
      expect(capturedStderr).toContain('[REDACTED]');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('InMemoryDiagnosticLogger redacts sensitive content before storing log entries', () => {
    const logger = new InMemoryDiagnosticLogger();
    logger.error('Failed request', new Error('Auth error with bearer fake_token_999'), {
      sessionSecret: 'super_secret_payload',
    });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(JSON.stringify(entry)).not.toContain('super_secret_payload');
    expect(JSON.stringify(entry)).not.toContain('fake_token_999');
  });
});
