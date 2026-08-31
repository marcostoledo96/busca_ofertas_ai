import * as readline from 'node:readline/promises';
import { stdin as defaultStdin, stdout as defaultStdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';

/**
 * Options for terminal prompting.
 */
export interface PromptOptions {
  readonly signal?: AbortSignal;
}

/**
 * TerminalPort represents an abstract interface for terminal user I/O.
 * Decouples the CLI presentation and navigation from direct Node.js process streams.
 */
export interface TerminalPort {
  writeLine(text: string): void;
  write(text: string): void;
  prompt(question: string, options?: PromptOptions): Promise<string>;
  close(): Promise<void> | void;
}

/**
 * Node.js implementation of TerminalPort using readline/promises.
 */
export class NodeTerminalAdapter implements TerminalPort {
  private rl: readline.Interface | null = null;
  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private isClosed = false;

  constructor(options?: { stdin?: Readable; stdout?: Writable }) {
    this.stdin = options?.stdin ?? defaultStdin;
    this.stdout = options?.stdout ?? defaultStdout;
  }

  private getReadline(): readline.Interface {
    if (this.isClosed) {
      throw new Error('NodeTerminalAdapter is closed.');
    }
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: this.stdin,
        output: this.stdout,
      });
    }
    return this.rl;
  }

  public writeLine(text: string): void {
    this.stdout.write(`${text}\n`);
  }

  public write(text: string): void {
    this.stdout.write(text);
  }

  public async prompt(question: string, options?: PromptOptions): Promise<string> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const rl = this.getReadline();
    return await rl.question(question, { signal: options?.signal });
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

/**
 * In-memory implementation of TerminalPort for automated tests.
 */
export class FakeTerminal implements TerminalPort {
  private inputQueue: string[] = [];
  private outputLines: string[] = [];
  private rawOutputChunks: string[] = [];
  private closed = false;

  constructor(initialInputs: string[] = []) {
    this.inputQueue = [...initialInputs];
  }

  public enqueueInput(...inputs: string[]): void {
    this.inputQueue.push(...inputs);
  }

  public writeLine(text: string): void {
    this.outputLines.push(text);
    this.rawOutputChunks.push(`${text}\n`);
  }

  public write(text: string): void {
    this.rawOutputChunks.push(text);
    // If text contains newlines, also split and push to outputLines
    const parts = text.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part !== undefined) {
        this.outputLines.push(part);
      }
    }
  }

  public async prompt(question: string, options?: PromptOptions): Promise<string> {
    this.write(question);

    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (options?.signal) {
      const signal = options.signal;
      return new Promise<string>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          const abortError = new Error('This operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const nextInput = this.inputQueue.shift();
        if (nextInput !== undefined) {
          signal.removeEventListener('abort', onAbort);
          resolve(nextInput);
        }
      });
    }

    const nextInput = this.inputQueue.shift();
    return nextInput ?? '';
  }

  public close(): void {
    this.closed = true;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public getOutputLines(): readonly string[] {
    return [...this.outputLines];
  }

  public getRawOutput(): string {
    return this.rawOutputChunks.join('');
  }

  public clear(): void {
    this.outputLines = [];
    this.rawOutputChunks = [];
  }
}
