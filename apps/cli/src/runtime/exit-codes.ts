/**
 * Contractual process exit codes for the Busca Ofertas AI CLI application.
 *
 * Distinct exit codes enable scripted and automated invocations to differentiate
 * between clean success, partial runs, configuration errors, external intervention
 * requirements, unexpected internal crashes, and user cancellation.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL_SUCCESS: 10,
  INVALID_CONFIGURATION: 20,
  TOTAL_SOURCE_FAILURE: 30,
  MANUAL_INTERVENTION_REQUIRED: 40,
  INTERNAL_ERROR: 70,
  CANCELLED: 130,
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;
export type ExitCode = (typeof EXIT_CODES)[ExitCodeName];

const VALID_EXIT_CODES = new Set<number>(Object.values(EXIT_CODES));

/**
 * Type guard to check if a numeric value is a valid contractual ExitCode.
 */
export function isExitCode(value: unknown): value is ExitCode {
  return typeof value === 'number' && VALID_EXIT_CODES.has(value);
}
