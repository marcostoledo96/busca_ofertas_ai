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

  it('Finding Final: sanitizeString and SanitizedDiagnosticLogger redact full Cookie, Authorization, passwords with space, and session paths', () => {
    const secretSecondCookie = 'fake_xs_secret_cookie_val_999';
    const secretBasic = 'fake_basic_auth_base64_secret_val_111';
    const secretDigest = 'fake_digest_auth_secret_val_222';
    const secretApiKey = 'fake_api_key_auth_secret_val_333';
    const secretWithSpace = 'fake password with spaces 444';
    const sensitiveSessionPath = '/home/test/.config/busca-ofertas/sessions/facebook/session.json';
    const sensitiveStorageStatePath = '/var/data/app/storageState.json';

    const testCases: Array<{ name: string; input: string; secret: string }> = [
      {
        name: 'Cookie header with multiple cookies (retaining nothing after semicolon)',
        input: `prefix Cookie: session=first; xs=${secretSecondCookie}; locale=es_AR suffix`,
        secret: secretSecondCookie,
      },
      {
        name: 'Set-Cookie header with attributes',
        input: `prefix Set-Cookie: a=first; b=${secretSecondCookie}; HttpOnly; Secure suffix`,
        secret: secretSecondCookie,
      },
      {
        name: 'Authorization Basic header',
        input: `Request failed Authorization: Basic ${secretBasic}`,
        secret: secretBasic,
      },
      {
        name: 'Authorization Digest header',
        input: `Request failed Authorization: Digest ${secretDigest}`,
        secret: secretDigest,
      },
      {
        name: 'Authorization ApiKey header',
        input: `Request failed Authorization: ApiKey ${secretApiKey}`,
        secret: secretApiKey,
      },
      {
        name: 'Quoted password with spaces',
        input: `Failed config with password="${secretWithSpace}" and user=admin`,
        secret: secretWithSpace,
      },
      {
        name: 'Sensitive session file path',
        input: `Cannot read session state at ${sensitiveSessionPath} on startup`,
        secret: sensitiveSessionPath,
      },
      {
        name: 'Sensitive storageState file path',
        input: `Failed to load storage state from ${sensitiveStorageStatePath}`,
        secret: sensitiveStorageStatePath,
      },
    ];

    for (const { name, input, secret } of testCases) {
      // 1. sanitizeString test
      const sanitized = sanitizeString(input);
      expect(sanitized, `sanitizeString failed for ${name}`).not.toContain(secret);
      expect(sanitized, `sanitizeString missing placeholder for ${name}`).toContain('[REDACTED]');

      // 2. SanitizedDiagnosticLogger test capturing stderr
      let capturedStderr = '';
      const writeSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: Uint8Array | string) => {
          capturedStderr += chunk.toString();
          return true;
        });

      try {
        const logger = new SanitizedDiagnosticLogger({ enabled: true });
        logger.error(`Error message: ${input}`, new Error(input), { detail: input });

        expect(capturedStderr, `logger.error leaked secret for ${name}`).not.toContain(secret);
        expect(capturedStderr, `logger.error missing placeholder for ${name}`).toContain(
          '[REDACTED]',
        );
      } finally {
        writeSpy.mockRestore();
      }
    }
  });

  it('sanitizeDiagnosticData redacts sensitive keys and nested objects', () => {
    const secret = 'fake-synthetic-secret-value-12345';
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

  it('InMemoryDiagnosticLogger redacts sensitive content before storing log entries', () => {
    const logger = new InMemoryDiagnosticLogger();
    logger.error(
      'Failed request',
      new Error('Auth error with Authorization: Bearer fake_token_999'),
      {
        sessionSecret: 'super_secret_payload',
      },
    );

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(JSON.stringify(entry)).not.toContain('super_secret_payload');
    expect(JSON.stringify(entry)).not.toContain('fake_token_999');
  });
});
