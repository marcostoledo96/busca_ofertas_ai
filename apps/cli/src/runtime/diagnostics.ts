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

export const REDACTED_PLACEHOLDER = '[REDACTED]' as const;
export const MAX_SANITIZATION_DEPTH = 10;

const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /password/i,
  /secret/i,
  /auth/i,
  /cookie/i,
  /session/i,
  /(?:^|[_\-.])key$/i,
  /(?:api|access|secret|private|public|session|auth|client|encryption)[_\-.]?key/i,
  /bearer/i,
  /credential/i,
  /jwt/i,
] as const;

/**
 * Ordered list of sanitization patterns.
 * Full headers and paths are evaluated before substring assignments to prevent prefix destruction.
 */
const KNOWN_SENSITIVE_STRING_PATTERNS: readonly RegExp[] = [
  // 1. Full header redactions
  /(?:Set-Cookie|Cookie):\s*[^\r\n]+/gi,
  /Authorization:\s*[^\r\n]+/gi,

  // 2. Sensitive session / authentication storage filepaths
  /(?:[A-Za-z]:[\\/]|[\\/]|(?:\.{1,2}[\\/]))(?:[^\s"':;\r\n]*[\\/])*(?:sessions?|storage-?state|cookies)(?:[\\/][^\s"':;\r\n]*)?/gi,

  // 3. Sensitive key-value assignments (quoted or unquoted, with or without spaces)
  /(?:password|token|secret|api_?key|access_?token|refresh_token|credential)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
  /(?:token|access_token|refresh_token|api_key|apikey|secret|password)=(?:"[^"]*"|'[^']*'|[^&\s]+)/gi,

  // 4. Token schemes and vendor formats
  /Bearer\s+[^\s,;]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]+\b/gi,
] as const;

/**
 * Redacts sensitive tokens, passwords, cookies, authorization headers, and session paths from a string.
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return String(input);
  }

  let sanitized = input;
  for (const pattern of KNOWN_SENSITIVE_STRING_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return sanitized;
}

/**
 * Recursively redacts sensitive keys and values in plain objects and arrays.
 */
export function sanitizeDiagnosticData<T>(data: T, depth = 0): T {
  if (depth > MAX_SANITIZATION_DEPTH) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data) as unknown as T;
  }

  if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'symbol') {
    return data;
  }

  if (data instanceof Date) {
    return new Date(data.getTime()) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item: unknown) => sanitizeDiagnosticData(item, depth + 1)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        result[key] = REDACTED_PLACEHOLDER;
      } else {
        result[key] = sanitizeDiagnosticData(value, depth + 1);
      }
    }
    return result as unknown as T;
  }

  return data;
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
      message: sanitizeString(message),
      ...(error !== undefined
        ? {
            error:
              error instanceof Error
                ? { name: error.name, message: sanitizeString(error.message) }
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
      message: sanitizeString(message),
      ...(error !== undefined
        ? {
            error:
              error instanceof Error
                ? { name: error.name, message: sanitizeString(error.message) }
                : sanitizeDiagnosticData(error),
          }
        : {}),
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
