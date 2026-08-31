import { EXIT_CODES, type ExitCode } from '../runtime/exit-codes.js';
import type { TerminalPort } from '../runtime/terminal.js';
import type { ProgressReporter } from '../runtime/progress.js';
import type { DiagnosticLogger } from '../runtime/diagnostics.js';
import { isCliError, type ErrorPresenter } from '../runtime/errors.js';
import { MenuFormatter, type MenuOptionItem } from '../presentation/menu-formatter.js';
import type { MenuAction, ActionExecutionContext } from './menu-actions.js';

export interface CliShellOptions {
  readonly terminal: TerminalPort;
  readonly actions: readonly MenuAction[];
  readonly errorPresenter: ErrorPresenter;
  readonly diagnostics: DiagnosticLogger;
  readonly progress: ProgressReporter;
  readonly formatter?: MenuFormatter;
}

/**
 * CliShell drives the interactive main loop.
 * Operates purely iteratively (no recursion) and handles signal cancellation cooperatively.
 */
export class CliShell {
  private readonly terminal: TerminalPort;
  private readonly actionsByNumber: Map<number, MenuAction>;
  private readonly menuOptions: readonly MenuOptionItem[];
  private readonly errorPresenter: ErrorPresenter;
  private readonly diagnostics: DiagnosticLogger;
  private readonly progress: ProgressReporter;
  private readonly formatter: MenuFormatter;

  constructor(options: CliShellOptions) {
    this.terminal = options.terminal;
    this.errorPresenter = options.errorPresenter;
    this.diagnostics = options.diagnostics;
    this.progress = options.progress;
    this.formatter = options.formatter ?? new MenuFormatter();

    this.actionsByNumber = new Map();
    const items: MenuOptionItem[] = [];

    for (const action of options.actions) {
      this.actionsByNumber.set(action.optionNumber, action);
      items.push({
        optionNumber: action.optionNumber,
        title: action.title,
      });
    }

    // Sort menu items by option number ascending
    items.sort((a, b) => a.optionNumber - b.optionNumber);
    this.menuOptions = items;
  }

  /**
   * Runs the interactive menu loop until the user exits, an abort signal triggers, or a terminal action completes.
   */
  public async run(signal: AbortSignal): Promise<ExitCode> {
    this.diagnostics.info('Starting CLI interactive shell loop.');

    while (!signal.aborted) {
      try {
        // 1. Display menu
        this.terminal.writeLine(this.formatter.formatMenu(this.menuOptions));

        // 2. Prompt user
        const rawInput = await this.terminal.prompt(this.formatter.formatPrompt(), { signal });

        if (signal.aborted) {
          return EXIT_CODES.CANCELLED;
        }

        const trimmedInput = rawInput.trim();
        const selectedNumber = Number(trimmedInput);

        // 3. Validate selection
        if (
          !trimmedInput ||
          Number.isNaN(selectedNumber) ||
          !this.actionsByNumber.has(selectedNumber)
        ) {
          this.terminal.writeLine(`\n${this.formatter.formatInvalidOptionMessage()}\n`);
          continue;
        }

        const selectedAction = this.actionsByNumber.get(selectedNumber)!;

        // 4. Execute action
        const context: ActionExecutionContext = {
          signal,
          terminal: this.terminal,
          progress: this.progress,
          diagnostics: this.diagnostics,
        };

        try {
          const actionResult = await selectedAction.execute(context);

          if (signal.aborted) {
            return EXIT_CODES.CANCELLED;
          }

          if (actionResult.kind === 'finish') {
            return actionResult.exitCode;
          }

          this.terminal.writeLine(''); // Separator line after action execution before next menu loop
        } catch (actionError) {
          if (
            signal.aborted ||
            (actionError instanceof Error && actionError.name === 'AbortError')
          ) {
            return EXIT_CODES.CANCELLED;
          }

          this.diagnostics.error('Error executing menu action', actionError, {
            optionNumber: selectedNumber,
            actionId: selectedAction.id,
          });
          this.errorPresenter.present(actionError);

          // Unhandled action errors terminate execution with their specific exit code
          if (isCliError(actionError)) {
            return actionError.exitCode;
          }
          return EXIT_CODES.INTERNAL_ERROR;
        }
      } catch (promptError) {
        if (signal.aborted || (promptError instanceof Error && promptError.name === 'AbortError')) {
          return EXIT_CODES.CANCELLED;
        }

        this.diagnostics.error('Unexpected error in shell loop', promptError);
        this.errorPresenter.present(promptError);
        return this.errorPresenter.resolveExitCode(promptError);
      }
    }

    return EXIT_CODES.CANCELLED;
  }
}
