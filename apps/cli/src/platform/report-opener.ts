import * as childProcess from 'node:child_process';

export interface ReportOpenResult {
  readonly opened: boolean;
  readonly reportPath: string;
  readonly reason?: string | undefined;
}

export interface ReportOpenerOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * ReportOpenerPort defines the platform boundary for opening local HTML reports.
 * Allows the CLI to request operating-system level opening without coupling to
 * browser engines or server architectures.
 */
export interface ReportOpenerPort {
  openLocalReport(reportPath: string, options?: ReportOpenerOptions): Promise<ReportOpenResult>;
}

export type SpawnFunction = typeof childProcess.spawn;

export interface NodeXdgReportOpenerOptions {
  readonly openerCommand?: string | undefined;
  readonly spawnFn?: SpawnFunction | undefined;
}

/**
 * Ubuntu / Linux implementation of ReportOpenerPort using xdg-open.
 *
 * Security & Reliability guarantees:
 * - Executes xdg-open with separate arguments and shell: false (no shell injection possible).
 * - Handles ENOENT (xdg-open not present) gracefully without throwing or crashing the run.
 * - Handles non-zero exit codes (no browser, DISPLAY unavailable, etc.) returning opened: false.
 * - Supports clean cancellation via AbortSignal.
 */
export class NodeXdgReportOpener implements ReportOpenerPort {
  private readonly openerCommand: string;
  private readonly spawnFn: SpawnFunction;

  constructor(options?: NodeXdgReportOpenerOptions) {
    this.openerCommand = options?.openerCommand ?? 'xdg-open';
    this.spawnFn = options?.spawnFn ?? childProcess.spawn;
  }

  public openLocalReport(
    reportPath: string,
    options?: ReportOpenerOptions,
  ): Promise<ReportOpenResult> {
    const signal = options?.signal;

    if (signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let child: childProcess.ChildProcess | null = null;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        if (child && !child.killed) {
          try {
            child.kill('SIGTERM');
          } catch {
            // Ignore kill error
          }
        }
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        // Explicitly set shell: false and pass arguments as array
        child = this.spawnFn(this.openerCommand, [reportPath], {
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (spawnError) {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (settled) return;
        settled = true;
        const msg = spawnError instanceof Error ? spawnError.message : String(spawnError);
        resolve({
          opened: false,
          reportPath,
          reason: `No se pudo iniciar el proceso ${this.openerCommand}: ${msg}`,
        });
        return;
      }

      let stderrOutput = '';
      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderrOutput += chunk.toString();
        });
      }

      child.on('error', (err: Error & { code?: string }) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (settled) return;
        settled = true;

        if (err.code === 'ENOENT') {
          resolve({
            opened: false,
            reportPath,
            reason: `El comando '${this.openerCommand}' no está instalado en el sistema.`,
          });
        } else {
          resolve({
            opened: false,
            reportPath,
            reason: `Error al ejecutar '${this.openerCommand}': ${err.message}`,
          });
        }
      });

      child.on('close', (code) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (settled) return;
        settled = true;

        if (code === 0) {
          resolve({
            opened: true,
            reportPath,
          });
        } else {
          const detail = stderrOutput.trim() ? ` (${stderrOutput.trim()})` : '';
          resolve({
            opened: false,
            reportPath,
            reason: `El comando '${this.openerCommand}' finalizó con código de error ${code}${detail}.`,
          });
        }
      });
    });
  }
}

export interface FakeReportOpenerOptions {
  readonly shouldSucceed?: boolean | undefined;
  readonly failureReason?: string | undefined;
}

/**
 * In-memory test fake for ReportOpenerPort.
 */
export class FakeReportOpener implements ReportOpenerPort {
  public readonly openedReports: string[] = [];
  public shouldSucceed: boolean;
  public failureReason: string | undefined;

  constructor(options?: FakeReportOpenerOptions) {
    this.shouldSucceed = options?.shouldSucceed ?? true;
    this.failureReason = options?.failureReason;
  }

  public openLocalReport(
    reportPath: string,
    options?: ReportOpenerOptions,
  ): Promise<ReportOpenResult> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    this.openedReports.push(reportPath);

    if (this.shouldSucceed) {
      return Promise.resolve({
        opened: true,
        reportPath,
      });
    }

    return Promise.resolve({
      opened: false,
      reportPath,
      reason: this.failureReason ?? 'Fake opener simulated failure.',
    });
  }
}
