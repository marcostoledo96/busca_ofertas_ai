/**
 * Sanitization and secret redaction utilities for Busca Ofertas AI.
 * Ensures tokens, passwords, cookies, authorization headers, and sentinel secrets
 * (such as SUPER_SECRET_TOKEN_DO_NOT_LEAK) never leak into errors, logs, diagnostics, or artifacts.
 */

export const REDACTED_PLACEHOLDER = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /auth/i,
  /cookie/i,
  /session/i,
  /key/i,
  /bearer/i,
  /credential/i,
];

const KNOWN_SENSITIVE_STRING_PATTERNS: RegExp[] = [
  /SUPER_SECRET_TOKEN_DO_NOT_LEAK/g,
  /Bearer\s+[A-Za-z0-9_\-.~+/=]+/gi,
  /(?:password|token|secret|api_?key|access_?token)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi,
  /(?:Set-Cookie|Cookie):\s*[^;\r\n]+/gi,
];

/**
 * Redacts known sensitive substring patterns from a string.
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
 * Sanitizes an array of evidence strings.
 */
export function sanitizeEvidence(evidence?: readonly string[]): readonly string[] {
  if (!evidence || !Array.isArray(evidence)) {
    return [];
  }
  return Object.freeze(evidence.map((item: string) => sanitizeString(item)));
}

/**
 * Recursively redacts sensitive keys and values in plain objects and arrays.
 */
export function sanitizeData<T>(data: T, depth = 0): T {
  if (depth > 10 || data === null || data === undefined) {
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
    const arr: unknown[] = data as unknown[];
    return arr.map((item: unknown) => sanitizeData(item, depth + 1)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        result[key] = REDACTED_PLACEHOLDER;
      } else {
        result[key] = sanitizeData(value, depth + 1);
      }
    }
    return result as unknown as T;
  }

  return data;
}
