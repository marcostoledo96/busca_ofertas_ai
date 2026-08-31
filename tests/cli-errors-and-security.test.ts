import { describe, it, expect } from 'vitest';
import {
  FakeTerminal,
  ErrorPresenter,
  CliError,
  EXIT_CODES,
  sanitizeDiagnosticData,
  InMemoryDiagnosticLogger,
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

  it('SECURITY: sanitizeDiagnosticData redacts sensitive object keys and bearer tokens', () => {
    const rawContext = {
      username: 'test_user',
      password: 'fake_password_123',
      apiKey: 'fake_api_key_456',
      authToken: 'fake_auth_token_789',
      nested: {
        cookie: 'c_user=12345; xs=abcdef;',
        safeField: 'hello world',
      },
      message: 'Calling endpoint with bearer fake_token_abc_xyz',
    };

    const sanitized = sanitizeDiagnosticData(rawContext);
    expect(sanitized.username).toBe('test_user');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.authToken).toBe('[REDACTED]');
    expect(sanitized.nested.cookie).toBe('[REDACTED]');
    expect(sanitized.nested.safeField).toBe('hello world');
    expect(sanitized.message).toContain('[REDACTED]');
    expect(sanitized.message).not.toContain('fake_token_abc_xyz');
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
