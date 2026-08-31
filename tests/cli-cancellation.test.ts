import { describe, it, expect, beforeEach } from 'vitest';
import {
  FakeTerminal,
  TestSignalManager,
  ProcessSignalManager,
  InMemoryDiagnosticLogger,
  InMemoryProgressReporter,
  ErrorPresenter,
  MenuFormatter,
  createDefaultMenuActions,
  CliShell,
  EXIT_CODES,
  createCliApplication,
  type MenuAction,
  type ActionExecutionContext,
} from '@busca-ofertas-ai/cli';

describe('CLI Cancellation and Signal Lifecycle (BOAI-006)', () => {
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

  it('exits with CANCELLED (130) when signal is aborted before running', async () => {
    signalManager.abort('Pre-aborted');

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
    expect(exitCode).toBe(EXIT_CODES.CANCELLED);
  });

  it('exits with CANCELLED (130) when signal is aborted during prompt', async () => {
    const app = createCliApplication({
      terminal,
      signalManager,
      formatter,
    });

    // Abort after a microtask tick
    setTimeout(() => {
      signalManager.abort('User pressed Ctrl+C');
    }, 10);

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.CANCELLED);
  });

  it('exits with CANCELLED (130) when signal is aborted during action execution', async () => {
    let actionStarted = false;
    let actionAborted = false;

    const slowAction: MenuAction = {
      id: 'slow-action',
      optionNumber: 1,
      title: 'Slow Action',
      execute: (context: ActionExecutionContext) => {
        actionStarted = true;
        return new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            actionAborted = true;
            context.signal.removeEventListener('abort', onAbort);
            const err = new Error('Action aborted');
            err.name = 'AbortError';
            reject(err);
          };
          context.signal.addEventListener('abort', onAbort);
        });
      },
    };

    terminal.enqueueInput('1');

    const defaultActions = createDefaultMenuActions(formatter);
    const app = createCliApplication({
      terminal,
      signalManager,
      actions: [slowAction, ...defaultActions.filter((a: MenuAction) => a.optionNumber !== 1)],
      formatter,
    });

    setTimeout(() => {
      signalManager.abort('SIGINT during action');
    }, 20);

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.CANCELLED);
    expect(actionStarted).toBe(true);
    expect(actionAborted).toBe(true);
  });

  it('runs registered cleanups idempotently upon disposal', async () => {
    let cleanupRuns = 0;
    let secondCleanupRuns = 0;

    signalManager.registerCleanup(() => {
      cleanupRuns++;
    });

    signalManager.registerCleanup(() => {
      secondCleanupRuns++;
    });

    await signalManager.dispose();
    expect(cleanupRuns).toBe(1);
    expect(secondCleanupRuns).toBe(1);

    // Second disposal must be a no-op
    await signalManager.dispose();
    expect(cleanupRuns).toBe(1);
    expect(secondCleanupRuns).toBe(1);
  });

  it('allows unregistering cleanups before disposal', async () => {
    let cleanupRuns = 0;
    const unregister = signalManager.registerCleanup(() => {
      cleanupRuns++;
    });

    unregister();
    await signalManager.dispose();
    expect(cleanupRuns).toBe(0);
  });

  it('closes terminal idempotently when application finishes', async () => {
    terminal.enqueueInput('8');
    const app = createCliApplication({
      terminal,
      signalManager,
      formatter,
    });

    expect(terminal.isClosed()).toBe(false);
    const code = await app.run();
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(terminal.isClosed()).toBe(true);
  });

  it('attaches and removes process signal listeners cleanly with ProcessSignalManager', async () => {
    const procManager = new ProcessSignalManager();
    expect(procManager.signal.aborted).toBe(false);

    let cleaned = false;
    procManager.registerCleanup(() => {
      cleaned = true;
    });

    await procManager.dispose();
    expect(cleaned).toBe(true);

    // Second dispose is idempotent
    await procManager.dispose();
  });
});
