/**
 * Diagnostic log level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Diagnostic log record.
 */
export interface DiagnosticEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly error?: unknown;
  readonly context?: Record<string, unknown>;
}

/**
 * DiagnosticLogger port for technical tracing and observability.
 * Keeps sensitive infrastructure and diagnostic data separate from user-facing UI.
 */
export interface DiagnosticLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}

const SENSITIVE_KEY_PATTERN =
  /(?:password|token|secret|cookie|authorization|session|apiKey|credential|auth)/i;
const SENSITIVE_VALUE_PATTERN =
  /(?:bearer\s+[A-Za-z0-9_.-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/gi;

/**
 * Redacts sensitive fields and values from objects and strings.
 */
export function sanitizeDiagnosticData<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_VALUE_PATTERN, '[REDACTED]') as unknown as T;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitizeDiagnosticData(item)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = sanitizeDiagnosticData(v);
    }
  }
  return sanitized as T;
}

/**
 * Sanitizing diagnostic logger that writes to stderr or provided stream.
 */
export class SanitizedDiagnosticLogger implements DiagnosticLogger {
  private readonly enabled: boolean;

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? process.env['DEBUG'] === '1';
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (this.enabled) {
      this.write('debug', message, undefined, context);
    }
  }

  public info(message: string, context?: Record<string, unknown>): void {
    if (this.enabled) {
      this.write('info', message, undefined, context);
    }
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, undefined, context);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.write('error', message, error, context);
  }

  private write(
    level: LogLevel,
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: sanitizeDiagnosticData(message),
      ...(error !== undefined
        ? {
            error:
              error instanceof Error
                ? { name: error.name, message: sanitizeDiagnosticData(error.message) }
                : sanitizeDiagnosticData(error),
          }
        : {}),
      ...(context !== undefined ? { context: sanitizeDiagnosticData(context) } : {}),
    };
    if (this.enabled || level === 'error' || level === 'warn') {
      process.stderr.write(`[diagnostic] ${JSON.stringify(entry)}\n`);
    }
  }
}

/**
 * In-memory diagnostic logger for tests.
 */
export class InMemoryDiagnosticLogger implements DiagnosticLogger {
  private readonly entries: DiagnosticEntry[] = [];

  public debug(message: string, context?: Record<string, unknown>): void {
    this.record('debug', message, undefined, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.record('info', message, undefined, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.record('warn', message, undefined, context);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.record('error', message, error, context);
  }

  private record(
    level: LogLevel,
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: sanitizeDiagnosticData(message),
      ...(error !== undefined ? { error: sanitizeDiagnosticData(error) } : {}),
      ...(context !== undefined ? { context: sanitizeDiagnosticData(context) } : {}),
    };
    this.entries.push(entry);
  }

  public getEntries(): readonly DiagnosticEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries.length = 0;
  }
}
