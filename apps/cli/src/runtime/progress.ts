import type { TerminalPort } from './terminal.js';

/**
 * Structured stage progress update.
 */
export interface ProgressStep {
  readonly current: number;
  readonly total: number;
  readonly label: string;
}

/**
 * ProgressReporter port for multi-stage processes.
 * Decoupled from concrete collectors or execution stages.
 */
export interface ProgressReporter {
  report(step: ProgressStep): void;
}

/**
 * Textual terminal progress presenter.
 * Formats: `[current/total] label`
 */
export class TerminalProgressReporter implements ProgressReporter {
  private readonly terminal: TerminalPort;

  constructor(terminal: TerminalPort) {
    this.terminal = terminal;
  }

  public report(step: ProgressStep): void {
    this.terminal.writeLine(`[${step.current}/${step.total}] ${step.label}`);
  }
}

/**
 * In-memory ProgressReporter for automated verification and test assertions.
 */
export class InMemoryProgressReporter implements ProgressReporter {
  private readonly steps: ProgressStep[] = [];

  public report(step: ProgressStep): void {
    this.steps.push({ ...step });
  }

  public getSteps(): readonly ProgressStep[] {
    return [...this.steps];
  }

  public clear(): void {
    this.steps.length = 0;
  }
}
