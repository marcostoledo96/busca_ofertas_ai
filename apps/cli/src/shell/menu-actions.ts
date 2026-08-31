import type { SourceRegistry } from '@busca-ofertas-ai/configuration';
import { EXIT_CODES, type ExitCode } from '../runtime/exit-codes.js';
import type { TerminalPort } from '../runtime/terminal.js';
import type { ProgressReporter } from '../runtime/progress.js';
import type { DiagnosticLogger } from '../runtime/diagnostics.js';
import { MenuFormatter } from '../presentation/menu-formatter.js';
import type { SavedSearchConfigStore } from '../storage/saved-search-store.js';
import type { TextFilePort } from '../storage/text-file-port.js';
import { CreateSearchWizard } from '../wizard/create-search-wizard.js';
import { EditSearchWizard } from '../wizard/edit-search-wizard.js';
import { ConfigurationSubmenu } from '../wizard/configuration-submenu.js';

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
 * Outcome returned by a MenuAction execution.
 * Allows actions to indicate whether the shell loop should continue to the main menu
 * or terminate the application process with a specific exit code.
 */
export type ActionResult =
  { readonly kind: 'continue' } | { readonly kind: 'finish'; readonly exitCode: ExitCode };

/**
 * MenuAction represents an executable handler bound to a menu item.
 */
export interface MenuAction {
  readonly id: string;
  readonly optionNumber: number;
  readonly title: string;
  execute(context: ActionExecutionContext): Promise<ActionResult>;
}

/**
 * Handler for menu option 2: Crear una búsqueda.
 */
export class CreateSearchActionHandler implements MenuAction {
  public readonly id = 'create-search';
  public readonly optionNumber = 2;
  public readonly title = 'Crear una búsqueda';
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;

  constructor(params: { sourceRegistry: SourceRegistry; configStore: SavedSearchConfigStore }) {
    this.sourceRegistry = params.sourceRegistry;
    this.configStore = params.configStore;
  }

  public async execute(context: ActionExecutionContext): Promise<ActionResult> {
    context.diagnostics.info('User started search creation wizard.');
    const wizard = new CreateSearchWizard({
      terminal: context.terminal,
      signal: context.signal,
      sourceRegistry: this.sourceRegistry,
      configStore: this.configStore,
    });

    await wizard.run();
    return { kind: 'continue' };
  }
}

/**
 * Handler for menu option 3: Editar una búsqueda.
 */
export class EditSearchActionHandler implements MenuAction {
  public readonly id = 'edit-search';
  public readonly optionNumber = 3;
  public readonly title = 'Editar una búsqueda';
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;

  constructor(params: { sourceRegistry: SourceRegistry; configStore: SavedSearchConfigStore }) {
    this.sourceRegistry = params.sourceRegistry;
    this.configStore = params.configStore;
  }

  public async execute(context: ActionExecutionContext): Promise<ActionResult> {
    context.diagnostics.info('User started search edit wizard.');
    const wizard = new EditSearchWizard({
      terminal: context.terminal,
      signal: context.signal,
      sourceRegistry: this.sourceRegistry,
      configStore: this.configStore,
    });

    await wizard.run();
    return { kind: 'continue' };
  }
}

/**
 * Handler for menu option 7: Configuración.
 */
export class ConfigurationActionHandler implements MenuAction {
  public readonly id = 'configuration';
  public readonly optionNumber = 7;
  public readonly title = 'Configuración';
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;
  private readonly textFilePort: TextFilePort;

  constructor(params: {
    sourceRegistry: SourceRegistry;
    configStore: SavedSearchConfigStore;
    textFilePort: TextFilePort;
  }) {
    this.sourceRegistry = params.sourceRegistry;
    this.configStore = params.configStore;
    this.textFilePort = params.textFilePort;
  }

  public async execute(context: ActionExecutionContext): Promise<ActionResult> {
    context.diagnostics.info('User entered configuration submenu.');
    const submenu = new ConfigurationSubmenu({
      terminal: context.terminal,
      signal: context.signal,
      sourceRegistry: this.sourceRegistry,
      configStore: this.configStore,
      textFilePort: this.textFilePort,
    });

    await submenu.run();
    return { kind: 'continue' };
  }
}

/**
 * Handler for menu options whose domain/infrastructure is planned for subsequent issues.
 * Informs the user clearly without throwing, crashing, or faking execution, returning to menu loop.
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

  public execute(context: ActionExecutionContext): Promise<ActionResult> {
    context.diagnostics.info(
      `User selected unimplemented action: [${this.optionNumber}] ${this.title}`,
    );
    context.terminal.writeLine(this.formatter.formatNotImplementedMessage(this.title));
    return Promise.resolve({ kind: 'continue' });
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

  public execute(context: ActionExecutionContext): Promise<ActionResult> {
    context.diagnostics.info('User requested clean exit.');
    context.terminal.writeLine(this.formatter.formatExitMessage());
    return Promise.resolve({ kind: 'finish', exitCode: EXIT_CODES.SUCCESS });
  }
}
