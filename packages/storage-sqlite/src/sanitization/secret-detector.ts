import type { SanitizerOptions } from '@busca-ofertas-ai/core';
import { SensitiveDataDetectedError } from '../errors/storage-errors.js';

const FORBIDDEN_NORMALIZED_KEYS = new Set<string>([
  'password',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'authorization',
  'proxyauthorization',
  'proxyauth',
  'cookie',
  'cookies',
  'cookieheader',
  'apikey',
  'secret',
  'clientsecret',
  'secretkey',
  'privatekey',
  'accesskey',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:Authorization|Proxy-Authorization)\s*:/i,
  /\b(?:Set-Cookie|Cookie)\s*:/i,
  /\bBearer\s+\S+/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/i,
  /\bpassword\s*=/i,
  /\bapi_key\s*=/i,
  /\btoken\s*=/i,
] as const;

const FORBIDDEN_SESSION_REF_PATTERNS: readonly RegExp[] = [
  /(?:Set-Cookie|Cookie)\s*:/i,
  /(?:Authorization|Proxy-Authorization)\s*:/i,
  /\bBearer\b/i,
  /password\s*=/i,
  /token\s*=/i,
  /api_key\s*=/i,
] as const;

export function validateNoSensitiveData(
  value: unknown,
  path = 'options',
  maxDepth = 20,
  options?: SanitizerOptions,
): void {
  if (value === null || value === undefined) {
    return;
  }

  // Primitive string: ALWAYS execute secret-pattern validation, even at depth limit (Finding 1A)
  if (typeof value === 'string') {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new SensitiveDataDetectedError(
          `Sensitive credential pattern detected at '${path}'. Direct persistence of secrets is forbidden.`,
        );
      }
    }
    if (options?.additionalSensitivePatterns) {
      for (const pattern of options.additionalSensitivePatterns) {
        if (pattern.test(value)) {
          throw new SensitiveDataDetectedError(
            `Sensitive custom pattern detected at '${path}'. Direct persistence of secrets is forbidden.`,
          );
        }
      }
    }
    return;
  }

  // Safe primitives: numbers, booleans, bigints, symbols
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return;
  }

  // Object/array traversal: fail closed if depth is exhausted and deeper inspection is required
  if (maxDepth <= 0) {
    if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
      throw new SensitiveDataDetectedError(
        `Maximum object nesting depth exceeded at '${path}'. Cannot verify absence of sensitive data; failing closed.`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateNoSensitiveData(value[i], `${path}[${i}]`, maxDepth - 1, options);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const normalized = normalizeKey(k);
      const isCustomSensitiveUnredacted =
        Boolean(
          options?.additionalSensitiveKeys?.some(
            (customKey) => normalizeKey(customKey) === normalized,
          ),
        ) && v !== '[REDACTED]';

      if (FORBIDDEN_NORMALIZED_KEYS.has(normalized) || isCustomSensitiveUnredacted) {
        throw new SensitiveDataDetectedError(
          `Forbidden sensitive key '${k}' detected at '${path}.${k}'. Direct persistence of secrets is forbidden.`,
        );
      }
      validateNoSensitiveData(v, `${path}.${k}`, maxDepth - 1, options);
    }
  }
}

export function validateSessionRef(sessionRef: unknown, path = 'sessionRef'): void {
  if (sessionRef === null || sessionRef === undefined) {
    return;
  }
  if (typeof sessionRef !== 'string') {
    throw new SensitiveDataDetectedError(
      `sessionRef must be a string identifier at '${path}', got ${typeof sessionRef}`,
    );
  }
  for (const pattern of FORBIDDEN_SESSION_REF_PATTERNS) {
    if (pattern.test(sessionRef)) {
      throw new SensitiveDataDetectedError(
        `Sensitive credential pattern detected in sessionRef at '${path}'. Direct persistence of session contents is forbidden. Use an opaque session pointer instead.`,
      );
    }
  }
}
