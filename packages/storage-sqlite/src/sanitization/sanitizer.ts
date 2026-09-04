/**
 * Secret redaction and sanitization utilities for SQLite persistence.
 *
 * Ensures tokens, passwords, cookies, authorization headers, and API keys
 * are never persisted into error columns, JSON snapshots, or operational tables.
 */

import type { SanitizerOptions } from '@busca-ofertas-ai/core';

export const REDACTED_PLACEHOLDER = '[REDACTED]' as const;
export const MAX_SANITIZATION_DEPTH = 10;

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
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
];

const KNOWN_SENSITIVE_STRING_PATTERNS: RegExp[] = [
  /\b(?:Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi,
  /\b(?:Authorization|Proxy-Authorization)\s*:\s*[^\r\n]+/gi,
  /\bBearer\s+\S+/gi,
  /(?:password|token|secret|api_?key|access_?token|credential|authorization|proxy_?authorization)\s*[:=]\s*["']?[^"'\r\n,;]+["']?/gi,
  /(?:token|access_token|refresh_token|api_key|apikey|secret|password)=[^&\s]+/gi,
];

/**
 * Redacts known sensitive patterns from strings (e.g. error messages, URLs, headers).
 */
export function sanitizeString(input: string, options?: SanitizerOptions): string {
  if (typeof input !== 'string') {
    return String(input);
  }

  let sanitized = input;
  for (const pattern of KNOWN_SENSITIVE_STRING_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_PLACEHOLDER);
  }

  if (options?.additionalSensitiveKeys) {
    for (const customKey of options.additionalSensitiveKeys) {
      const escaped = customKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:${escaped})\\s*[:=]\\s*["']?[^"'\\r\\n,;]+["']?`, 'gi');
      sanitized = sanitized.replace(pattern, REDACTED_PLACEHOLDER);
    }
  }

  if (options?.additionalSensitivePatterns) {
    for (const pattern of options.additionalSensitivePatterns) {
      if (pattern.global || pattern.sticky) {
        pattern.lastIndex = 0;
      }
      sanitized = sanitized.replace(pattern, REDACTED_PLACEHOLDER);
    }
  }

  return sanitized;
}

/**
 * Sanitizes an error message or string before persisting.
 */
export function sanitizeErrorMessage(error?: string | null): string | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }
  const clean = sanitizeString(error).trim();
  return clean.length > 0 ? clean : undefined;
}

/**
 * Recursively sanitizes objects and arrays before JSON serialization.
 */
export function sanitizeObject<T>(data: T, depth = 0, options?: SanitizerOptions): T {
  if (depth > MAX_SANITIZATION_DEPTH) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data, options) as unknown as T;
  }

  if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'symbol') {
    return data;
  }

  if (data instanceof Date) {
    return new Date(data.getTime()) as unknown as T;
  }

  if (Array.isArray(data)) {
    const arr: unknown[] = data as unknown[];
    return arr.map((item: unknown) => sanitizeObject(item, depth + 1, options)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isBaseSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      const isCustomSensitiveKey = Boolean(
        options?.additionalSensitiveKeys?.some((customKey) => {
          const normKey = key.toLowerCase().replace(/[-_]/g, '');
          const normCustom = customKey.toLowerCase().replace(/[-_]/g, '');
          return normKey === normCustom || normKey.includes(normCustom);
        }),
      );

      if (isBaseSensitiveKey || isCustomSensitiveKey) {
        result[key] = REDACTED_PLACEHOLDER;
      } else {
        result[key] = sanitizeObject(value, depth + 1, options);
      }
    }
    return result as unknown as T;
  }

  return data;
}
