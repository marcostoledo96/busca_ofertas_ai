import { SensitiveDataDetectedError } from '../errors/storage-errors.js';

const FORBIDDEN_NORMALIZED_KEYS = new Set<string>([
  'password',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'authorization',
  'cookie',
  'cookies',
  'cookieheader',
  'apikey',
  'secret',
  'clientsecret',
  'bearertoken',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bAuthorization\s*:\s*\S+/i,
  /\b(?:Set-Cookie|Cookie)\s*:\s*\S+/i,
  /\bBearer\s+[A-Za-z0-9_\-.~+/=]{8,}\b/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/i,
] as const;

export function validateNoSensitiveData(value: unknown, path = 'options', maxDepth = 20): void {
  if (value === null || value === undefined) {
    return;
  }
  if (maxDepth <= 0) {
    return;
  }

  if (typeof value === 'string') {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new SensitiveDataDetectedError(
          `Sensitive credential pattern detected at '${path}'. Direct persistence of secrets is forbidden.`,
        );
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateNoSensitiveData(value[i], `${path}[${i}]`, maxDepth - 1);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const normalized = normalizeKey(k);
      if (FORBIDDEN_NORMALIZED_KEYS.has(normalized)) {
        throw new SensitiveDataDetectedError(
          `Forbidden sensitive key '${k}' detected at '${path}.${k}'. Direct persistence of secrets is forbidden. Use sessionRef instead.`,
        );
      }
      validateNoSensitiveData(v, `${path}.${k}`, maxDepth - 1);
    }
  }
}
