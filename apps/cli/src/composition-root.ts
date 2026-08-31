import * as path from 'node:path';
import { SourceRegistry } from '@busca-ofertas-ai/configuration';
import { resolveXdgAppPaths } from './platform/xdg-paths.js';
import type { ExitCode } from './runtime/exit-codes.js';
import { TerminalPort, NodeTerminalAdapter } from './runtime/terminal.js';
import { SignalManagerPort, ProcessSignalManager } from './runtime/signals.js';
import { ProgressReporter, TerminalProgressReporter } from './runtime/progress.js';
import { DiagnosticLogger, SanitizedDiagnosticLogger } from './runtime/diagnostics.js';
import { ErrorPresenter } from './runtime/errors.js';
import { MenuFormatter, CONTRACTUAL_MENU_OPTIONS } from './presentation/menu-formatter.js';
import {
  type MenuAction,
  CreateSearchActionHandler,
  EditSearchActionHandler,
  ConfigurationActionHandler,
  NotImplementedActionHandler,
  ExitActionHandler,
} from './shell/menu-actions.js';
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
 * Creates default menu action handlers for the 8 contractual options.
 */
export function createDefaultMenuActions(
  param?:
    | MenuFormatter
    | {
        formatter?: MenuFormatter | undefined;
        sourceRegistry?: SourceRegistry | undefined;
        configStore?: SavedSearchConfigStore | undefined;
        textFilePort?: TextFilePort | undefined;
        searchConfigDirectory?: string | undefined;
      },
): MenuAction[] {
  const actions: MenuAction[] = [];
  const fmt = param instanceof MenuFormatter ? param : (param?.formatter ?? new MenuFormatter());
  const reg =
    param instanceof MenuFormatter
      ? new SourceRegistry()
      : (param?.sourceRegistry ?? new SourceRegistry());
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
    } else if (item.optionNumber === 7) {
      actions.push(
        new ConfigurationActionHandler({
          sourceRegistry: reg,
          configStore: store,
          textFilePort: textPort,
        }),
      );
    } else {
      const idMap: Record<number, string> = {
        1: 'run-search',
        4: 'view-history',
        5: 'review-listings',
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

  const sourceRegistry = options?.sourceRegistry ?? new SourceRegistry();
  const defaultStorageDir = resolveDefaultSearchConfigDirectory(options?.searchConfigDirectory);
  const configStore =
    options?.configStore ?? new NodeFileSystemSavedSearchConfigStore(defaultStorageDir);
  const textFilePort = options?.textFilePort ?? new NodeTextFileAdapter();

  const actions =
    options?.actions ??
    createDefaultMenuActions({
      formatter,
      sourceRegistry,
      configStore,
      textFilePort,
      searchConfigDirectory: options?.searchConfigDirectory,
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
    run: async (): Promise<ExitCode> => {
      try {
        signalManager.registerCleanup(async () => {
          if (unsubscribeInterrupt) {
            unsubscribeInterrupt();
            unsubscribeInterrupt = undefined;
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
