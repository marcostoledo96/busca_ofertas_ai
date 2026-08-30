import {
  DEFAULT_RETRYABLE_BY_CODE,
  isSourceErrorCode,
  type SourceErrorCode,
} from './error-codes.js';
import { sanitizeEvidence, sanitizeString } from './sanitization.js';

export interface SourceAdapterErrorParams {
  readonly code: SourceErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly evidence?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly cause?: unknown;
}

export interface SerializedSourceAdapterError {
  readonly name: 'SourceAdapterError';
  readonly code: SourceErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly evidence: readonly string[];
  readonly artifactIds: readonly string[];
}

/**
 * Structured typed error thrown by source adapters on external failures.
 * Never serializes raw HTTP headers, cookies, or sensitive secrets.
 */
export class SourceAdapterError extends Error {
  readonly code: SourceErrorCode;
  readonly retryable: boolean;
  readonly evidence: readonly string[];
  readonly artifactIds: readonly string[];
  readonly safeMessage: string;
  private readonly _causeInternal?: unknown;

  constructor(params: SourceAdapterErrorParams) {
    if (!isSourceErrorCode(params.code)) {
      throw new Error(`Invalid SourceErrorCode: '${String(params.code)}'`);
    }

    const sanitizedMsg = sanitizeString(params.message);
    super(sanitizedMsg);

    this.name = 'SourceAdapterError';
    this.code = params.code;
    this.safeMessage = sanitizedMsg;
    this.retryable =
      params.retryable !== undefined ? params.retryable : DEFAULT_RETRYABLE_BY_CODE[params.code];
    this.evidence = sanitizeEvidence(params.evidence);
    this.artifactIds = sanitizeEvidence(params.artifactIds);
    this._causeInternal = params.cause;

    // Ensure proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, SourceAdapterError.prototype);
  }

  /**
   * Returns a sanitized serializable representation safe for logs, UI, and JSON persistence.
   */
  toJSON(): SerializedSourceAdapterError {
    return {
      name: 'SourceAdapterError',
      code: this.code,
      message: this.safeMessage,
      retryable: this.retryable,
      evidence: this.evidence,
      artifactIds: this.artifactIds,
    };
  }

  /**
   * Internal cause accessor.
   */
  getInternalCause(): unknown {
    return this._causeInternal;
  }
}

/**
 * Type guard for SourceAdapterError.
 */
export function isSourceAdapterError(error: unknown): error is SourceAdapterError {
  return (
    error instanceof SourceAdapterError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'SourceAdapterError' &&
      isSourceErrorCode((error as { code?: unknown }).code))
  );
}
