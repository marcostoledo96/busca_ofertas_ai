import { EXIT_CODES, type ExitCode } from './exit-codes.js';
import type { TerminalPort } from './terminal.js';

export interface CliErrorParams {
  readonly code: string;
  readonly userMessage: string;
  readonly suggestedAction?: string | undefined;
  readonly exitCode?: ExitCode | undefined;
  readonly cause?: unknown;
}

/**
 * Known domain/application CLI error with structured presentation metadata.
 */
export class CliError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly suggestedAction?: string | undefined;
  public readonly exitCode: ExitCode;
  public override readonly cause?: unknown;

  constructor(params: CliErrorParams) {
    super(`[${params.code}] ${params.userMessage}`);
    this.name = 'CliError';
    this.code = params.code;
    this.userMessage = params.userMessage;
    this.suggestedAction = params.suggestedAction;
    this.exitCode = params.exitCode ?? EXIT_CODES.INTERNAL_ERROR;
    this.cause = params.cause;
  }
}

/**
 * Type guard for CliError.
 */
export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

/**
 * ErrorPresenter formats errors for safe user-facing terminal display.
 * Strictly prevents stack traces, raw error payloads, or technical causes from leaking into standard UI.
 */
export class ErrorPresenter {
  private readonly terminal: TerminalPort;

  constructor(terminal: TerminalPort) {
    this.terminal = terminal;
  }

  /**
   * Formats and writes the user-facing error to terminal output.
   */
  public present(error: unknown): void {
    if (isCliError(error)) {
      this.terminal.writeLine(`\n[${error.code}] ${error.userMessage}`);
      if (error.suggestedAction) {
        this.terminal.writeLine(`Acción sugerida: ${error.suggestedAction}`);
      }
      return;
    }

    // Generic/Unknown error fallback
    this.terminal.writeLine('\n[INTERNAL_ERROR] Ocurrió un error interno no esperado.');
    this.terminal.writeLine('Acción sugerida: Revisá los diagnósticos para más detalles.');
  }

  /**
   * Resolves the appropriate ExitCode for an error.
   */
  public resolveExitCode(error: unknown): ExitCode {
    if (isCliError(error)) {
      return error.exitCode;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return EXIT_CODES.CANCELLED;
    }
    return EXIT_CODES.INTERNAL_ERROR;
  }
}
