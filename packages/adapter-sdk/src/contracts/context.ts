import type { Clock } from '@busca-ofertas-ai/core';
import { sanitizeData, sanitizeString } from '../errors/sanitization.js';

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
 * Wraps a StructuredLogger so that any context passed by callers is automatically
 * sanitized through sanitizeData before forwarding to the underlying sink.
 */
export function createSanitizedLogger(logger: StructuredLogger): StructuredLogger {
  return {
    debug(event: string, context?: LogEventContext): void {
      logger.debug(sanitizeString(event), context ? sanitizeData(context) : undefined);
    },
    info(event: string, context?: LogEventContext): void {
      logger.info(sanitizeString(event), context ? sanitizeData(context) : undefined);
    },
    warn(event: string, context?: LogEventContext): void {
      logger.warn(sanitizeString(event), context ? sanitizeData(context) : undefined);
    },
    error(event: string, context?: LogEventContext): void {
      logger.error(sanitizeString(event), context ? sanitizeData(context) : undefined);
    },
  };
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
 * Wraps a RawArtifactWriter so that artifactType, contentType, and metadata
 * are automatically sanitized before forwarding to the underlying writer sink.
 *
 * NOTE on artifact content:
 * - metadata is always recursively sanitized.
 * - artifactType and contentType are sanitized strings.
 * - content holds diagnostic payloads (such as raw HTML responses, parser traces).
 *   Callers are responsible for not embedding session tokens into raw content;
 *   binary data (Uint8Array) is passed through intact without corrupting byte streams.
 */
export function createSanitizedArtifactWriter(writer: RawArtifactWriter): RawArtifactWriter {
  return {
    writeArtifact(params: WriteArtifactParams, control?: OperationControl): Promise<string> {
      const sanitizedParams: WriteArtifactParams = {
        artifactType: sanitizeString(params.artifactType),
        contentType: sanitizeString(params.contentType),
        content: params.content,
        ...(params.metadata !== undefined && {
          metadata: sanitizeData(params.metadata),
        }),
      };
      return writer.writeArtifact(sanitizedParams, control);
    },
  };
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

/**
 * Wraps an AdapterContext ensuring its logger and artifactWriter are wrapped with sanitizers.
 */
export function createSanitizedAdapterContext(context: AdapterContext): AdapterContext {
  return {
    ...context,
    logger: createSanitizedLogger(context.logger),
    artifactWriter: createSanitizedArtifactWriter(context.artifactWriter),
  };
}
