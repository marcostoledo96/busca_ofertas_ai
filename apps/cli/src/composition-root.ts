import type { ExitCode } from './runtime/exit-codes.js';
import { TerminalPort, NodeTerminalAdapter } from './runtime/terminal.js';
import { SignalManagerPort, ProcessSignalManager } from './runtime/signals.js';
import { ProgressReporter, TerminalProgressReporter } from './runtime/progress.js';
import { DiagnosticLogger, SanitizedDiagnosticLogger } from './runtime/diagnostics.js';
import { ErrorPresenter } from './runtime/errors.js';
import { MenuFormatter, CONTRACTUAL_MENU_OPTIONS } from './presentation/menu-formatter.js';
import {
  type MenuAction,
  NotImplementedActionHandler,
  ExitActionHandler,
} from './shell/menu-actions.js';
import { CliShell } from './shell/cli-shell.js';

export interface CliApplicationOptions {
  readonly terminal?: TerminalPort;
  readonly signalManager?: SignalManagerPort;
  readonly diagnostics?: DiagnosticLogger;
  readonly progress?: ProgressReporter;
  readonly actions?: readonly MenuAction[];
  readonly formatter?: MenuFormatter;
  readonly errorPresenter?: ErrorPresenter;
}

export interface CliApplication {
  readonly shell: CliShell;
  readonly terminal: TerminalPort;
  readonly signalManager: SignalManagerPort;
  readonly diagnostics: DiagnosticLogger;
  readonly progress: ProgressReporter;
  readonly errorPresenter: ErrorPresenter;
  run(): Promise<ExitCode>;
}

/**
 * Creates default menu action handlers for the 8 contractual options.
 */
export function createDefaultMenuActions(formatter?: MenuFormatter): MenuAction[] {
  const actions: MenuAction[] = [];
  const fmt = formatter ?? new MenuFormatter();

  for (const item of CONTRACTUAL_MENU_OPTIONS) {
    if (item.optionNumber === 8) {
      actions.push(new ExitActionHandler(fmt));
    } else {
      const idMap: Record<number, string> = {
        1: 'run-search',
        2: 'create-search',
        3: 'edit-search',
        4: 'view-history',
        5: 'review-listings',
        6: 'source-errors',
        7: 'configuration',
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
 * and CLI shell without instantiating business rules, SQLite, Playwright, or network clients.
 */
export function createCliApplication(options?: CliApplicationOptions): CliApplication {
  const terminal = options?.terminal ?? new NodeTerminalAdapter();
  const signalManager = options?.signalManager ?? new ProcessSignalManager();
  const diagnostics = options?.diagnostics ?? new SanitizedDiagnosticLogger();
  const progress = options?.progress ?? new TerminalProgressReporter(terminal);
  const errorPresenter = options?.errorPresenter ?? new ErrorPresenter(terminal);
  const formatter = options?.formatter ?? new MenuFormatter();
  const actions = options?.actions ?? createDefaultMenuActions(formatter);

  // Finding 1: Connect terminal interrupt (Ctrl+C during readline) to central SignalManager
  if (terminal.onInterrupt) {
    terminal.onInterrupt((reason) => {
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
    run: async (): Promise<ExitCode> => {
      try {
        // Finding 4: Single ownership of terminal closing through signalManager cleanup
        signalManager.registerCleanup(async () => {
          await terminal.close();
        });

        return await shell.run(signalManager.signal);
      } catch (fatalError) {
        diagnostics.error('Fatal unhandled error in CLI application', fatalError);
        errorPresenter.present(fatalError);
        return errorPresenter.resolveExitCode(fatalError);
      } finally {
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
