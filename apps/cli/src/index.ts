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
  CreateSearchActionHandler,
  EditSearchActionHandler,
  ConfigurationActionHandler,
  NotImplementedActionHandler,
  ExitActionHandler,
} from './shell/menu-actions.js';

export { type CliShellOptions, CliShell } from './shell/cli-shell.js';

// Storage & Transfer Seams
export {
  type WriteSearchOptions,
  type RemoveSearchOptions,
  type SavedSearchConfigStore,
  KEBAB_CASE_ID_REGEX,
  validateSearchId,
  NodeFileSystemSavedSearchConfigStore,
  InMemorySavedSearchConfigStore,
} from './storage/saved-search-store.js';

export {
  type ReadTextFileOptions,
  type WriteTextFileOptions,
  type TextFilePort,
  NodeTextFileAdapter,
  InMemoryTextFileAdapter,
} from './storage/text-file-port.js';

// Wizard Infrastructure & Helpers
export {
  WIZARD_DEFAULT_ENABLED,
  WIZARD_DEFAULT_EVALUATION,
  WIZARD_DEFAULT_AI,
  WIZARD_DEFAULT_RETENTION,
  WIZARD_DEFAULT_REPORT,
} from './wizard/wizard-defaults.js';

export {
  type DiffChange,
  calculateStructuralDiff,
  formatStructuralDiff,
} from './wizard/structural-diff.js';

export { formatSearchSummary } from './wizard/summary-formatter.js';

export {
  type PromptTextOptions,
  type PromptNumberOptions,
  type ChoiceItem,
  type MultiChoiceOptions,
  WizardPrompter,
} from './wizard/wizard-prompter.js';

export {
  type CreateSearchWizardOptions,
  CreateSearchWizard,
} from './wizard/create-search-wizard.js';

export { type EditSearchWizardOptions, EditSearchWizard } from './wizard/edit-search-wizard.js';

export {
  type ConfigurationSubmenuOptions,
  ConfigurationSubmenu,
} from './wizard/configuration-submenu.js';

// Composition Root
export {
  type CliApplicationOptions,
  type CliApplication,
  createDefaultSourceRegistry,
  resolveDefaultSearchConfigDirectory,
  createDefaultMenuActions,
  createCliApplication,
  runCli,
} from './composition-root.js';

// Platform & Linux Integration (XDG, Permissions, Launcher, Report Opener)
export {
  DEFAULT_APP_NAMESPACE,
  DEFAULT_DATABASE_FILENAME,
  type XdgEnvironment,
  type AppPaths,
  type ResolveXdgAppPathsOptions,
  resolveXdgAppPaths,
  PRIVATE_DIRECTORY_MODE,
  ensureAppDirectories,
  type ReportOpenResult,
  type ReportOpenerOptions,
  type ReportOpenerPort,
  type SpawnFunction,
  type NodeXdgReportOpenerOptions,
  NodeXdgReportOpener,
  type FakeReportOpenerOptions,
  FakeReportOpener,
  PRIVATE_REPORT_FILE_MODE,
  type PersistReportHtmlOptions,
  type PersistedReportLocation,
  generateSearchSlug,
  sanitizeShortRunId,
  formatRunTimestamp,
  persistReportHtml,
} from './platform/index.js';

// Reporting Orchestration
export {
  type GenerateAndOpenReportOptions,
  type GenerateAndOpenReportResult,
  generateAndOpenReport,
} from './reporting/index.js';
