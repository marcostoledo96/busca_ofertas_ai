import type { Clock } from '@busca-ofertas-ai/core';

/**
 * Standard operation control carrying cancellation signal and optional deadline.
 * Mandatory for all external operations (search, healthCheck, details, auth).
 */
export interface OperationControl {
  readonly signal: AbortSignal;
  readonly deadlineAt?: Date;
}

/**
 * Helper to assert that an operation has not been aborted or timed out by its control.
 */
export function isAbortedOrExpired(control: OperationControl, clock?: Clock): boolean {
  if (control.signal.aborted) {
    return true;
  }
  if (control.deadlineAt) {
    const now = clock ? clock.now() : new Date();
    if (now.getTime() >= control.deadlineAt.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * Key-value context for structured logging events.
 * Never pass raw tokens, headers, cookies, or secrets in context.
 */
export type LogEventContext = Record<string, unknown>;

/**
 * Small, structured logger interface for adapters.
 * Does not require string interpolation; accepts stable event names and structured context.
 */
export interface StructuredLogger {
  debug(event: string, context?: LogEventContext): void;
  info(event: string, context?: LogEventContext): void;
  warn(event: string, context?: LogEventContext): void;
  error(event: string, context?: LogEventContext): void;
}

/**
 * Abstract provider for retrieving credentials/tokens without direct filesystem or env coupling.
 */
export interface SecretProvider {
  getSecret(key: string, control?: OperationControl): Promise<string | null>;
}

/**
 * Parameters for persisting a sanitized raw artifact for diagnostics or review.
 */
export interface WriteArtifactParams {
  readonly artifactType: string;
  readonly content: string | Uint8Array;
  readonly contentType: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Abstract writer for diagnostic and raw evidence artifacts.
 * Returns a stable reference ID, hiding storage details.
 */
export interface RawArtifactWriter {
  writeArtifact(params: WriteArtifactParams, control?: OperationControl): Promise<string>;
}

/**
 * Minimal context provided to a SourceAdapter during initialization.
 * Free of database handles, CLI formatters, and browser automation instances.
 */
export interface AdapterContext {
  readonly runId: string;
  readonly logger: StructuredLogger;
  readonly clock: Clock;
  readonly abortSignal: AbortSignal;
  readonly artifactWriter: RawArtifactWriter;
  readonly secretProvider: SecretProvider;
  readonly sessionDirectory: string;
}
