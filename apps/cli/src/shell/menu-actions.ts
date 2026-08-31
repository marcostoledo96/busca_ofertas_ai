import type { TerminalPort } from '../runtime/terminal.js';
import type { ProgressReporter } from '../runtime/progress.js';
import type { DiagnosticLogger } from '../runtime/diagnostics.js';
import { MenuFormatter } from '../presentation/menu-formatter.js';

/**
 * Execution context passed to menu action handlers.
 */
export interface ActionExecutionContext {
  readonly signal: AbortSignal;
  readonly terminal: TerminalPort;
  readonly progress: ProgressReporter;
  readonly diagnostics: DiagnosticLogger;
}

/**
 * MenuAction represents an executable handler bound to a menu item.
 */
export interface MenuAction {
  readonly id: string;
  readonly optionNumber: number;
  readonly title: string;
  execute(context: ActionExecutionContext): Promise<void>;
}

/**
 * Handler for menu options whose domain/infrastructure is planned for subsequent issues.
 * Informs the user clearly without throwing, crashing, or faking execution.
 */
export class NotImplementedActionHandler implements MenuAction {
  public readonly id: string;
  public readonly optionNumber: number;
  public readonly title: string;
  private readonly formatter: MenuFormatter;

  constructor(params: {
    id: string;
    optionNumber: number;
    title: string;
    formatter?: MenuFormatter;
  }) {
    this.id = params.id;
    this.optionNumber = params.optionNumber;
    this.title = params.title;
    this.formatter = params.formatter ?? new MenuFormatter();
  }

  public execute(context: ActionExecutionContext): Promise<void> {
    context.diagnostics.info(
      `User selected unimplemented action: [${this.optionNumber}] ${this.title}`,
    );
    context.terminal.writeLine(this.formatter.formatNotImplementedMessage(this.title));
    return Promise.resolve();
  }
}

/**
 * Handler for option 8: Salir.
 */
export class ExitActionHandler implements MenuAction {
  public readonly id = 'exit';
  public readonly optionNumber = 8;
  public readonly title = 'Salir';
  private readonly formatter: MenuFormatter;

  constructor(formatter?: MenuFormatter) {
    this.formatter = formatter ?? new MenuFormatter();
  }

  public execute(context: ActionExecutionContext): Promise<void> {
    context.diagnostics.info('User requested clean exit.');
    context.terminal.writeLine(this.formatter.formatExitMessage());
    return Promise.resolve();
  }
}
