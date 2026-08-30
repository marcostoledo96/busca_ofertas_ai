/**
 * Stable error codes for external source adapter failures.
 * Contractual Reference: docs/03_ADAPTER_SDK.md and docs/11_ERROR_MODEL_AND_OBSERVABILITY.md
 */

export const SOURCE_ERROR_CODES = [
  'AUTHENTICATION_REQUIRED',
  'MANUAL_INTERVENTION_REQUIRED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'SOURCE_UNAVAILABLE',
  'CONTRACT_CHANGED',
  'PARSER_FAILED',
  'TIMEOUT',
  'CONFIGURATION_UNSUPPORTED',
] as const;

export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

export function isSourceErrorCode(code: unknown): code is SourceErrorCode {
  return typeof code === 'string' && SOURCE_ERROR_CODES.includes(code as SourceErrorCode);
}

/**
 * Default retryability classification for each standard error code.
 * Individual adapters can override retryability when concrete context warrants it.
 */
export const DEFAULT_RETRYABLE_BY_CODE: Readonly<Record<SourceErrorCode, boolean>> = {
  AUTHENTICATION_REQUIRED: false,
  MANUAL_INTERVENTION_REQUIRED: false,
  RATE_LIMITED: true,
  NETWORK_ERROR: true,
  SOURCE_UNAVAILABLE: true,
  CONTRACT_CHANGED: false,
  PARSER_FAILED: false,
  TIMEOUT: true,
  CONFIGURATION_UNSUPPORTED: false,
};
