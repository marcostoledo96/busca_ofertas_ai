/**
 * @busca-ofertas-ai/cli
 *
 * Interactive CLI shell and composition root for Busca Ofertas AI.
 * Free of business rules, SQLite drivers, Playwright browsers, or direct HTTP clients.
 */

// Package Metadata
export const CLI_PACKAGE_NAME = '@busca-ofertas-ai/cli' as const;

export interface CliPackageMetadata {
  readonly name: typeof CLI_PACKAGE_NAME;
  readonly initialized: boolean;
}

export const getCliPackageMetadata = (): CliPackageMetadata => ({
  name: CLI_PACKAGE_NAME,
  initialized: true,
});

// Exit Codes
export { EXIT_CODES, type ExitCodeName, type ExitCode, isExitCode } from './runtime/exit-codes.js';

// Terminal Port & Adapters
export {
  type PromptOptions,
  type InterruptCallback,
  type TerminalPort,
  type NodeTerminalAdapterOptions,
  NodeTerminalAdapter,
  FakeTerminal,
} from './runtime/terminal.js';

// Signal & Lifecycle Management
export {
  type CleanupCallback,
  type SignalManagerPort,
  ProcessSignalManager,
  TestSignalManager,
} from './runtime/signals.js';

// Progress
export {
  type ProgressStep,
  type ProgressReporter,
  TerminalProgressReporter,
  InMemoryProgressReporter,
} from './runtime/progress.js';

// Diagnostics & Redaction
export {
  type LogLevel,
  type DiagnosticEntry,
  type DiagnosticLogger,
  REDACTED_PLACEHOLDER,
  MAX_SANITIZATION_DEPTH,
  sanitizeString,
  sanitizeDiagnosticData,
  SanitizedDiagnosticLogger,
  InMemoryDiagnosticLogger,
} from './runtime/diagnostics.js';

// Error Presentation
export { type CliErrorParams, CliError, isCliError, ErrorPresenter } from './runtime/errors.js';

// Presentation & Menu
export {
  type MenuOptionItem,
  CONTRACTUAL_MENU_OPTIONS,
  MenuFormatter,
} from './presentation/menu-formatter.js';

// Shell & Actions
export {
  type ActionExecutionContext,
  type ActionResult,
  type MenuAction,
  NotImplementedActionHandler,
  ExitActionHandler,
} from './shell/menu-actions.js';

export { type CliShellOptions, CliShell } from './shell/cli-shell.js';

// Composition Root
export {
  type CliApplicationOptions,
  type CliApplication,
  createDefaultMenuActions,
  createCliApplication,
  runCli,
} from './composition-root.js';
