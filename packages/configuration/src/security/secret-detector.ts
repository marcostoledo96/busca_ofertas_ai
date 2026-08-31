export interface SecretViolation {
  readonly path: string;
  readonly key: string;
  readonly code?: 'CONFIG_SECRET_FORBIDDEN' | 'CONFIG_MAX_DEPTH_EXCEEDED' | undefined;
}

const FORBIDDEN_NORMALIZED_KEYS = new Set<string>([
  'password',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'cookies',
  'apikey',
  'secret',
  'clientsecret',
  'bearertoken',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

const isForbiddenKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return FORBIDDEN_NORMALIZED_KEYS.has(normalized);
};

export const MAX_ALLOWED_NESTING_DEPTH = 20;

export const detectForbiddenSecrets = (
  value: unknown,
  currentPath = '',
  maxDepth = MAX_ALLOWED_NESTING_DEPTH,
): SecretViolation[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (maxDepth <= 0) {
    if (typeof value === 'object') {
      return [
        {
          path: currentPath || 'root',
          key: '__MAX_DEPTH__',
          code: 'CONFIG_MAX_DEPTH_EXCEEDED',
        },
      ];
    }
    return [];
  }

  const violations: SecretViolation[] = [];

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
      violations.push(...detectForbiddenSecrets(value[i], itemPath, maxDepth - 1));
    }
  } else if (typeof value === 'object') {
    for (const [key, propValue] of Object.entries(value)) {
      const propPath = currentPath ? `${currentPath}.${key}` : key;
      if (isForbiddenKey(key)) {
        violations.push({ path: propPath, key, code: 'CONFIG_SECRET_FORBIDDEN' });
      }
      violations.push(...detectForbiddenSecrets(propValue, propPath, maxDepth - 1));
    }
  }

  return violations;
};
