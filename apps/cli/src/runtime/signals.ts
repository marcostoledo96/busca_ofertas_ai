/**
 * Cleanup task callback.
 */
export type CleanupCallback = () => Promise<void> | void;

/**
 * SignalManagerPort handles cooperative cancellation lifecycle and signal traps.
 */
export interface SignalManagerPort {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
  registerCleanup(callback: CleanupCallback): () => void;
  dispose(): Promise<void>;
}

/**
 * Node.js process-bound SignalManager that listens to SIGINT and SIGTERM.
 */
export class ProcessSignalManager implements SignalManagerPort {
  private readonly controller: AbortController;
  private readonly cleanupCallbacks: CleanupCallback[] = [];
  private isDisposed = false;
  private isCleaningUp = false;
  private readonly sigintHandler: () => void;
  private readonly sigtermHandler: () => void;

  constructor(controller: AbortController = new AbortController()) {
    this.controller = controller;

    this.sigintHandler = () => {
      this.handleSignal('SIGINT');
    };
    this.sigtermHandler = () => {
      this.handleSignal('SIGTERM');
    };

    process.on('SIGINT', this.sigintHandler);
    process.on('SIGTERM', this.sigtermHandler);
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public abort(reason?: unknown): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason);
    }
  }

  public registerCleanup(callback: CleanupCallback): () => void {
    this.cleanupCallbacks.push(callback);
    return () => {
      const idx = this.cleanupCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.cleanupCallbacks.splice(idx, 1);
      }
    };
  }

  private handleSignal(signalName: string): void {
    this.abort(new Error(`Process received ${signalName}`));
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    // Remove process listeners
    process.removeListener('SIGINT', this.sigintHandler);
    process.removeListener('SIGTERM', this.sigtermHandler);

    // Run cleanups in LIFO order
    if (!this.isCleaningUp) {
      this.isCleaningUp = true;
      const callbacks = [...this.cleanupCallbacks].reverse();
      this.cleanupCallbacks.length = 0;

      for (const callback of callbacks) {
        try {
          await callback();
        } catch {
          // Suppress errors during cleanup disposal to avoid masking primary outcomes
        }
      }
    }
  }
}

/**
 * Isolated SignalManager for unit and integration testing without attaching to process.
 */
export class TestSignalManager implements SignalManagerPort {
  private readonly controller: AbortController;
  private readonly cleanupCallbacks: CleanupCallback[] = [];
  private isDisposed = false;
  public cleanupCount = 0;

  constructor(controller: AbortController = new AbortController()) {
    this.controller = controller;
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public abort(reason?: unknown): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason);
    }
  }

  public registerCleanup(callback: CleanupCallback): () => void {
    this.cleanupCallbacks.push(callback);
    return () => {
      const idx = this.cleanupCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.cleanupCallbacks.splice(idx, 1);
      }
    };
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    const callbacks = [...this.cleanupCallbacks].reverse();
    this.cleanupCallbacks.length = 0;

    for (const callback of callbacks) {
      try {
        this.cleanupCount++;
        await callback();
      } catch {
        // Suppress errors during test cleanup
      }
    }
  }
}
