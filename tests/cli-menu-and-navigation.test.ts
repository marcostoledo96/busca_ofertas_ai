import { describe, it, expect, beforeEach } from 'vitest';
import {
  FakeTerminal,
  TestSignalManager,
  InMemoryDiagnosticLogger,
  InMemoryProgressReporter,
  ErrorPresenter,
  MenuFormatter,
  CONTRACTUAL_MENU_OPTIONS,
  createDefaultMenuActions,
  CliShell,
  EXIT_CODES,
  createCliApplication,
  type MenuOptionItem,
} from '@busca-ofertas-ai/cli';

describe('CLI Menu and Navigation (BOAI-006)', () => {
  let terminal: FakeTerminal;
  let signalManager: TestSignalManager;
  let diagnostics: InMemoryDiagnosticLogger;
  let progress: InMemoryProgressReporter;
  let errorPresenter: ErrorPresenter;
  let formatter: MenuFormatter;

  beforeEach(() => {
    terminal = new FakeTerminal();
    signalManager = new TestSignalManager();
    diagnostics = new InMemoryDiagnosticLogger();
    progress = new InMemoryProgressReporter();
    errorPresenter = new ErrorPresenter(terminal);
    formatter = new MenuFormatter();
  });

  it('renders exactly the 8 contractual menu options in defined order', () => {
    const menuText = formatter.formatMenu();
    expect(CONTRACTUAL_MENU_OPTIONS).toHaveLength(8);
    expect(
      CONTRACTUAL_MENU_OPTIONS.map((o: MenuOptionItem) => `${o.optionNumber}. ${o.title}`),
    ).toEqual([
      '1. Ejecutar una búsqueda',
      '2. Crear una búsqueda',
      '3. Editar una búsqueda',
      '4. Ver historial',
      '5. Revisar publicaciones dudosas',
      '6. Ver errores de fuentes',
      '7. Configuración',
      '8. Salir',
    ]);

    expect(menuText).toContain('BUSCA OFERTAS AI');
    for (const opt of CONTRACTUAL_MENU_OPTIONS) {
      expect(menuText).toContain(`${opt.optionNumber}. ${opt.title}`);
    }
  });

  it('exits cleanly with SUCCESS (0) when option 8 is selected', async () => {
    terminal.enqueueInput('8');
    const actions = createDefaultMenuActions(formatter);
    const shell = new CliShell({
      terminal,
      actions,
      errorPresenter,
      diagnostics,
      progress,
      formatter,
    });

    const exitCode = await shell.run(signalManager.signal);
    expect(exitCode).toBe(EXIT_CODES.SUCCESS);

    const rawOutput = terminal.getRawOutput();
    expect(rawOutput).toContain('BUSCA OFERTAS AI');
    expect(rawOutput).toContain('Saliendo de Busca Ofertas AI. ¡Hasta luego!');
  });

  it('displays "Todavía no implementado" and returns to menu when selecting unimplemented options 1, 4, 6', async () => {
    const unimplementedOptions = [1, 4, 6];
    for (const optNum of unimplementedOptions) {
      const term = new FakeTerminal([String(optNum), '8']);
      const sigMgr = new TestSignalManager();
      const app = createCliApplication({
        terminal: term,
        signalManager: sigMgr,
        formatter,
      });

      const exitCode = await app.run();
      expect(exitCode).toBe(EXIT_CODES.SUCCESS);

      const raw = term.getRawOutput();
      const expectedOption = CONTRACTUAL_MENU_OPTIONS.find(
        (o: MenuOptionItem) => o.optionNumber === optNum,
      )!;
      expect(raw).toContain(`[!] Todavía no implementado: "${expectedOption.title}"`);
    }
  });

  it('routes to functional wizards and review on options 2, 3, 5, and 7 without crash', async () => {
    // Option 2: Crear una búsqueda -> 3. Cancelar -> 8. Salir
    const term2 = new FakeTerminal(['2', '3', '8']);
    const app2 = createCliApplication({ terminal: term2, formatter });
    expect(await app2.run()).toBe(EXIT_CODES.SUCCESS);

    // Option 3: Modificar una búsqueda (informs no searches saved and returns to main menu)
    const term3 = new FakeTerminal(['3', '8']);
    const app3 = createCliApplication({ terminal: term3, formatter });
    expect(await app3.run()).toBe(EXIT_CODES.SUCCESS);

    // Option 5: Revisar publicaciones dudosas -> 0. Volver -> 8. Salir
    const term5 = new FakeTerminal(['5', '0', '8']);
    const app5 = createCliApplication({ terminal: term5, formatter });
    expect(await app5.run()).toBe(EXIT_CODES.SUCCESS);
    expect(term5.getRawOutput()).toContain('Revisión de Publicaciones Dudosas (REVIEW)');

    // Option 7: Configuración -> 4. Volver -> 8. Salir
    const term7 = new FakeTerminal(['7', '4', '8']);
    const app7 = createCliApplication({ terminal: term7, formatter });
    expect(await app7.run()).toBe(EXIT_CODES.SUCCESS);
    expect(term7.getRawOutput()).toContain('CONFIGURACIÓN DE BÚSQUEDAS');
  });

  it('handles invalid inputs (empty, letters, numbers out of range, symbols) and reprompts', async () => {
    terminal.enqueueInput('', '   ', 'abc', '0', '9', '-1', '99', '8');
    const actions = createDefaultMenuActions(formatter);
    const shell = new CliShell({
      terminal,
      actions,
      errorPresenter,
      diagnostics,
      progress,
      formatter,
    });

    const exitCode = await shell.run(signalManager.signal);
    expect(exitCode).toBe(EXIT_CODES.SUCCESS);

    const raw = terminal.getRawOutput();
    // Verify invalid option warnings appeared
    expect(raw).toContain('Opción inválida. Por favor, ingresá un número del 1 al 8.');
  });

  it('navigates through multiple consecutive menus iteratively without stack overflow', async () => {
    // 50 consecutive valid navigation rounds followed by exit
    const inputs: string[] = [];
    for (let i = 0; i < 50; i++) {
      inputs.push('4'); // Ver historial
    }
    inputs.push('8'); // Exit

    terminal.enqueueInput(...inputs);
    const app = createCliApplication({
      terminal,
      signalManager,
      formatter,
    });

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
  });
});
