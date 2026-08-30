export interface SecretViolation {
  readonly path: string;
  readonly key: string;
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

export const detectForbiddenSecrets = (
  value: unknown,
  currentPath = '',
  maxDepth = 20,
): SecretViolation[] => {
  if (maxDepth <= 0 || value === null || value === undefined) {
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
        violations.push({ path: propPath, key });
      }
      violations.push(...detectForbiddenSecrets(propValue, propPath, maxDepth - 1));
    }
  }

  return violations;
};
