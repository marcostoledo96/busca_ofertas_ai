import * as fs from 'node:fs';
import * as path from 'node:path';
import { SourceRegistry } from '@busca-ofertas-ai/configuration';
import {
  SyntheticAdapter,
  SYNTHETIC_ADAPTER_ID,
  SYNTHETIC_ADAPTER_VERSION,
  SYNTHETIC_ADAPTER_SDK_VERSION,
  SYNTHETIC_ADAPTER_CAPABILITIES,
} from '@busca-ofertas-ai/adapter-synthetic';
import {
  openSqliteDatabase,
  createSqliteRepositories,
  createSqliteArtifactSanitizer,
  createNodeCryptoHasher,
  type SqliteDatabase,
} from '@busca-ofertas-ai/storage-sqlite';
import { resolveXdgAppPaths } from './platform/xdg-paths.js';
import { NodeArtifactFileSystemAdapter } from './platform/node-artifact-filesystem.js';
import type { ExitCode } from './runtime/exit-codes.js';
import { TerminalPort, NodeTerminalAdapter } from './runtime/terminal.js';
import { SignalManagerPort, ProcessSignalManager } from './runtime/signals.js';
import { ProgressReporter, TerminalProgressReporter } from './runtime/progress.js';
import { DiagnosticLogger, SanitizedDiagnosticLogger } from './runtime/diagnostics.js';
import { ErrorPresenter } from './runtime/errors.js';
import { MenuFormatter, CONTRACTUAL_MENU_OPTIONS } from './presentation/menu-formatter.js';
import {
  ReviewQueueService,
  RecordReviewFeedbackUseCase,
  RawArtifactService,
  SystemClock,
  UuidIdGenerator,
  type ExternalUrlOpenerPort,
} from '@busca-ofertas-ai/core';
import {
  type MenuAction,
  CreateSearchActionHandler,
  EditSearchActionHandler,
  ConfigurationActionHandler,
  ReviewListingsActionHandler,
  NotImplementedActionHandler,
  ExitActionHandler,
} from './shell/menu-actions.js';
import { NodeExternalUrlOpener } from './platform/node-external-url-opener.js';
import { CliShell } from './shell/cli-shell.js';
import {
  type SavedSearchConfigStore,
  NodeFileSystemSavedSearchConfigStore,
} from './storage/saved-search-store.js';
import { type TextFilePort, NodeTextFileAdapter } from './storage/text-file-port.js';

export interface CliApplicationOptions {
  readonly terminal?: TerminalPort;
  readonly signalManager?: SignalManagerPort;
  readonly diagnostics?: DiagnosticLogger;
  readonly progress?: ProgressReporter;
  readonly actions?: readonly MenuAction[];
  readonly formatter?: MenuFormatter;
  readonly errorPresenter?: ErrorPresenter;
  readonly sourceRegistry?: SourceRegistry;
  readonly configStore?: SavedSearchConfigStore;
  readonly textFilePort?: TextFilePort;
  readonly searchConfigDirectory?: string;
  readonly databasePath?: string;
  readonly sqliteDatabase?: SqliteDatabase;
  readonly reviewQueueService?: ReviewQueueService;
  readonly recordFeedbackUseCase?: RecordReviewFeedbackUseCase;
  readonly externalUrlOpener?: ExternalUrlOpenerPort;
  readonly rawArtifactService?: RawArtifactService;
  readonly cleanupOnStartup?: boolean;
}

export interface CliApplication {
  readonly shell: CliShell;
  readonly terminal: TerminalPort;
  readonly signalManager: SignalManagerPort;
  readonly diagnostics: DiagnosticLogger;
  readonly progress: ProgressReporter;
  readonly errorPresenter: ErrorPresenter;
  readonly sourceRegistry: SourceRegistry;
  readonly configStore: SavedSearchConfigStore;
  readonly textFilePort: TextFilePort;
  readonly rawArtifactService?: RawArtifactService;
  run(): Promise<ExitCode>;
}

/**
 * Resolves the default storage directory for saved searches according to XDG specification.
 * Falls back to $HOME/.config/busca-ofertas-ai/searches when unconfigured.
 */
export function resolveDefaultSearchConfigDirectory(explicitDir?: string): string {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  return resolveXdgAppPaths().searchesDir;
}

/**
 * Creates the default SourceRegistry pre-configured with available source adapters.
 * In MVP Stage 1, registers the offline SyntheticAdapter.
 */
export function createDefaultSourceRegistry(): SourceRegistry {
  const registry = new SourceRegistry();
  registry.register({
    id: SYNTHETIC_ADAPTER_ID,
    version: SYNTHETIC_ADAPTER_VERSION,
    sdkVersion: SYNTHETIC_ADAPTER_SDK_VERSION,
    capabilities: SYNTHETIC_ADAPTER_CAPABILITIES,
    status: 'ENABLED',
    factory: () => new SyntheticAdapter(),
  });
  return registry;
}

export interface CreateDefaultMenuActionsOptions {
  readonly formatter?: MenuFormatter | undefined;
  readonly sourceRegistry?: SourceRegistry | undefined;
  readonly configStore?: SavedSearchConfigStore | undefined;
  readonly textFilePort?: TextFilePort | undefined;
  readonly searchConfigDirectory?: string | undefined;
  readonly databasePath?: string | undefined;
  readonly sqliteDatabase?: SqliteDatabase | undefined;
  readonly reviewQueueService?: ReviewQueueService | undefined;
  readonly recordFeedbackUseCase?: RecordReviewFeedbackUseCase | undefined;
  readonly externalUrlOpener?: ExternalUrlOpenerPort | undefined;
  readonly rawArtifactService?: RawArtifactService | undefined;
}

/**
 * Creates default menu action handlers for the 8 contractual options.
 */
export function createDefaultMenuActions(
  param?: MenuFormatter | CreateDefaultMenuActionsOptions,
): MenuAction[] {
  const actions: MenuAction[] = [];
  const fmt = param instanceof MenuFormatter ? param : (param?.formatter ?? new MenuFormatter());
  const reg =
    param instanceof MenuFormatter
      ? createDefaultSourceRegistry()
      : (param?.sourceRegistry ?? createDefaultSourceRegistry());
  const defaultDir = resolveDefaultSearchConfigDirectory(
    param instanceof MenuFormatter ? undefined : param?.searchConfigDirectory,
  );
  const store =
    param instanceof MenuFormatter
      ? new NodeFileSystemSavedSearchConfigStore(defaultDir)
      : (param?.configStore ?? new NodeFileSystemSavedSearchConfigStore(defaultDir));
  const textPort =
    param instanceof MenuFormatter
      ? new NodeTextFileAdapter()
      : (param?.textFilePort ?? new NodeTextFileAdapter());

  let reviewQueue = param instanceof MenuFormatter ? undefined : param?.reviewQueueService;
  let recordFeedback = param instanceof MenuFormatter ? undefined : param?.recordFeedbackUseCase;
  let rawArtifacts = param instanceof MenuFormatter ? undefined : param?.rawArtifactService;
  const urlOpener =
    param instanceof MenuFormatter
      ? new NodeExternalUrlOpener()
      : (param?.externalUrlOpener ?? new NodeExternalUrlOpener());

  if (!reviewQueue || !recordFeedback || !rawArtifacts) {
    const db = param instanceof MenuFormatter ? undefined : param?.sqliteDatabase;
    const resolvedDb =
      db ??
      (() => {
        const dbPath =
          (param instanceof MenuFormatter ? undefined : param?.databasePath) ??
          resolveXdgAppPaths().databasePath;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
        return openSqliteDatabase({ databasePath: dbPath, createParentDirectory: true });
      })();
    resolvedDb.migrate();
    const repos = createSqliteRepositories(resolvedDb);

    reviewQueue =
      reviewQueue ??
      new ReviewQueueService({
        opportunityRepo: repos.opportunities,
        evaluationRepo: repos.evaluations,
        observationRepo: repos.observations,
        listingRepo: repos.listings,
        feedbackRepo: repos.feedback,
      });

    recordFeedback =
      recordFeedback ??
      new RecordReviewFeedbackUseCase({
        opportunityRepo: repos.opportunities,
        evaluationRepo: repos.evaluations,
        feedbackRepo: repos.feedback,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

    if (!rawArtifacts) {
      const paths = resolveXdgAppPaths();
      const artifactFs = new NodeArtifactFileSystemAdapter(paths.artifactsDir);
      rawArtifacts = new RawArtifactService({
        storagePort: artifactFs,
        repository: repos.rawArtifacts,
        sanitizer: createSqliteArtifactSanitizer(),
        hasher: createNodeCryptoHasher(),
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });
    }
  }

  for (const item of CONTRACTUAL_MENU_OPTIONS) {
    if (item.optionNumber === 8) {
      actions.push(new ExitActionHandler(fmt));
    } else if (item.optionNumber === 2) {
      actions.push(
        new CreateSearchActionHandler({
          sourceRegistry: reg,
          configStore: store,
        }),
      );
    } else if (item.optionNumber === 3) {
      actions.push(
        new EditSearchActionHandler({
          sourceRegistry: reg,
          configStore: store,
        }),
      );
    } else if (item.optionNumber === 5) {
      actions.push(
        new ReviewListingsActionHandler({
          reviewQueueService: reviewQueue,
          recordFeedbackUseCase: recordFeedback,
          externalUrlOpener: urlOpener,
        }),
      );
    } else if (item.optionNumber === 7) {
      actions.push(
        new ConfigurationActionHandler({
          sourceRegistry: reg,
          configStore: store,
          textFilePort: textPort,
          rawArtifactService: rawArtifacts,
        }),
      );
    } else {
      const idMap: Record<number, string> = {
        1: 'run-search',
        4: 'view-history',
        6: 'source-errors',
      };
      actions.push(
        new NotImplementedActionHandler({
          id: idMap[item.optionNumber] ?? `action-${item.optionNumber}`,
          optionNumber: item.optionNumber,
          title: item.title,
          formatter: fmt,
        }),
      );
    }
  }

  return actions;
}

/**
 * Composition Root: wires the terminal, signal handling, diagnostics, error presentation,
 * source registry, storage seams, and CLI shell.
 */
export function createCliApplication(options?: CliApplicationOptions): CliApplication {
  const terminal = options?.terminal ?? new NodeTerminalAdapter();
  const signalManager = options?.signalManager ?? new ProcessSignalManager();
  const diagnostics = options?.diagnostics ?? new SanitizedDiagnosticLogger();
  const progress = options?.progress ?? new TerminalProgressReporter(terminal);
  const errorPresenter = options?.errorPresenter ?? new ErrorPresenter(terminal);
  const formatter = options?.formatter ?? new MenuFormatter();

  const sourceRegistry = options?.sourceRegistry ?? createDefaultSourceRegistry();
  const defaultStorageDir = resolveDefaultSearchConfigDirectory(options?.searchConfigDirectory);
  const configStore =
    options?.configStore ?? new NodeFileSystemSavedSearchConfigStore(defaultStorageDir);
  const textFilePort = options?.textFilePort ?? new NodeTextFileAdapter();

  // Wire SQLite persistence for review infrastructure and raw artifacts
  let dbToClose: SqliteDatabase | undefined;
  let reviewQueueService = options?.reviewQueueService;
  let recordFeedbackUseCase = options?.recordFeedbackUseCase;
  let rawArtifactService = options?.rawArtifactService;

  if (!reviewQueueService || !recordFeedbackUseCase || !rawArtifactService) {
    let db = options?.sqliteDatabase;
    if (!db) {
      const dbPath = options?.databasePath ?? resolveXdgAppPaths().databasePath;
      fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
      db = openSqliteDatabase({ databasePath: dbPath, createParentDirectory: true });
      dbToClose = db;
    }
    db.migrate();
    const repos = createSqliteRepositories(db);

    reviewQueueService =
      reviewQueueService ??
      new ReviewQueueService({
        opportunityRepo: repos.opportunities,
        evaluationRepo: repos.evaluations,
        observationRepo: repos.observations,
        listingRepo: repos.listings,
        feedbackRepo: repos.feedback,
      });

    recordFeedbackUseCase =
      recordFeedbackUseCase ??
      new RecordReviewFeedbackUseCase({
        opportunityRepo: repos.opportunities,
        evaluationRepo: repos.evaluations,
        feedbackRepo: repos.feedback,
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });

    if (!rawArtifactService) {
      const paths = resolveXdgAppPaths();
      const artifactFs = new NodeArtifactFileSystemAdapter(paths.artifactsDir);
      rawArtifactService = new RawArtifactService({
        storagePort: artifactFs,
        repository: repos.rawArtifacts,
        sanitizer: createSqliteArtifactSanitizer(),
        hasher: createNodeCryptoHasher(),
        clock: new SystemClock(),
        idGenerator: new UuidIdGenerator(),
      });
    }
  }

  const actions =
    options?.actions ??
    createDefaultMenuActions({
      formatter,
      sourceRegistry,
      configStore,
      textFilePort,
      searchConfigDirectory: options?.searchConfigDirectory,
      databasePath: options?.databasePath,
      sqliteDatabase: options?.sqliteDatabase ?? dbToClose,
      reviewQueueService,
      recordFeedbackUseCase,
      externalUrlOpener: options?.externalUrlOpener,
      rawArtifactService,
    });

  // Connect terminal interrupt to central SignalManager and capture unsubscription
  let unsubscribeInterrupt: (() => void) | undefined;
  if (terminal.onInterrupt) {
    unsubscribeInterrupt = terminal.onInterrupt((reason) => {
      signalManager.abort(reason);
    });
  }

  const shell = new CliShell({
    terminal,
    actions,
    errorPresenter,
    diagnostics,
    progress,
    formatter,
  });

  return {
    shell,
    terminal,
    signalManager,
    diagnostics,
    progress,
    errorPresenter,
    sourceRegistry,
    configStore,
    textFilePort,
    rawArtifactService,
    run: async (): Promise<ExitCode> => {
      try {
        if (options?.cleanupOnStartup === true && rawArtifactService) {
          try {
            const cleanupResult = await rawArtifactService.cleanupExpiredArtifacts();
            diagnostics.info(
              `Startup cleanup finished: found=${cleanupResult.found}, deleted=${cleanupResult.deleted}, alreadyMissing=${cleanupResult.alreadyMissing}, failed=${cleanupResult.failed}`,
            );
          } catch (cleanupErr) {
            diagnostics.warn(
              `Startup raw artifacts cleanup encountered an error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
            );
          }
        }
        signalManager.registerCleanup(async () => {
          if (unsubscribeInterrupt) {
            unsubscribeInterrupt();
            unsubscribeInterrupt = undefined;
          }
          if (dbToClose) {
            try {
              dbToClose.close();
            } catch {
              // Ignore if already closed
            }
          }
          await terminal.close();
        });

        return await shell.run(signalManager.signal);
      } catch (fatalError) {
        diagnostics.error('Fatal unhandled error in CLI application', fatalError);
        errorPresenter.present(fatalError);
        return errorPresenter.resolveExitCode(fatalError);
      } finally {
        if (unsubscribeInterrupt) {
          unsubscribeInterrupt();
          unsubscribeInterrupt = undefined;
        }
        await signalManager.dispose();
      }
    },
  };
}

/**
 * Top-level runner invoked by executable entrypoint.
 */
export async function runCli(options?: CliApplicationOptions): Promise<ExitCode> {
  const app = createCliApplication(options);
  return await app.run();
}
