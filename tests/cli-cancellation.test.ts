import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  FakeTerminal,
  TestSignalManager,
  ProcessSignalManager,
  NodeTerminalAdapter,
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
  type ActionResult,
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

    setTimeout(() => {
      signalManager.abort('User pressed Ctrl+C');
    }, 10);

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.CANCELLED);
  });

  it('Finding 1: Ctrl+C / readline interrupt triggers central AbortController and aborts shared signal', async () => {
    let sharedSignalAbortedObserved = false;

    const observingAction: MenuAction = {
      id: 'observing-action',
      optionNumber: 1,
      title: 'Observing Action',
      execute: (context: ActionExecutionContext): Promise<ActionResult> => {
        context.signal.addEventListener('abort', () => {
          sharedSignalAbortedObserved = true;
        });
        return Promise.resolve({ kind: 'continue' });
      },
    };

    const defaultActions = createDefaultMenuActions(formatter);
    const app = createCliApplication({
      terminal,
      signalManager,
      actions: [observingAction, ...defaultActions.filter((a: MenuAction) => a.optionNumber !== 1)],
      formatter,
    });

    expect(signalManager.signal.aborted).toBe(false);

    // Simulate readline Ctrl+C interrupt
    terminal.triggerInterrupt(new Error('Terminal Ctrl+C received'));

    expect(signalManager.signal.aborted).toBe(true);

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.CANCELLED);
    expect(sharedSignalAbortedObserved).toBe(false);
  });

  it('Finding 1: NodeTerminalAdapter with streams triggers onInterrupt and central AbortController on SIGINT', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    let interruptCalled = false;
    const nodeTerminal = new NodeTerminalAdapter({
      stdin,
      stdout,
      onInterrupt: () => {
        interruptCalled = true;
      },
    });

    const sigMgr = new TestSignalManager();
    const app = createCliApplication({
      terminal: nodeTerminal,
      signalManager: sigMgr,
    });

    expect(sigMgr.signal.aborted).toBe(false);

    // Start running app in background
    const runPromise = app.run();

    // Abort signal manager
    sigMgr.abort('User interrupt');

    const code = await runPromise;
    expect(code).toBe(EXIT_CODES.CANCELLED);
    expect(sigMgr.signal.aborted).toBe(true);
    expect(interruptCalled).toBe(true);

    stdin.end();
    stdout.end();
  });

  it('exits with CANCELLED (130) when signal is aborted during action execution and propagates to observer', async () => {
    let actionStarted = false;
    let actionAborted = false;

    const slowAction: MenuAction = {
      id: 'slow-action',
      optionNumber: 1,
      title: 'Slow Action',
      execute: (context: ActionExecutionContext): Promise<ActionResult> => {
        actionStarted = true;
        return new Promise<ActionResult>((resolve, reject) => {
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
    expect(signalManager.signal.aborted).toBe(true);
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

  it('closes terminal exactly once upon completion', async () => {
    terminal.enqueueInput('8');
    const app = createCliApplication({
      terminal,
      signalManager,
      formatter,
    });

    expect(terminal.closeCount).toBe(0);
    const code = await app.run();
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(terminal.closeCount).toBe(1);
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
