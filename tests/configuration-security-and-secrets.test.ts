import { describe, it, expect } from 'vitest';
import {
  validateSavedSearchConfiguration,
  ConfigurationError,
  detectForbiddenSecrets,
} from '@busca-ofertas-ai/configuration';

describe('Configuration Security and Inline Secret Prevention (BOAI-004)', () => {
  const SECRET_SENTINEL = 'INLINE_SECRET_MUST_NOT_LEAK_82F1';

  const createBaseConfig = (): Record<string, unknown> => ({
    schemaVersion: 1,
    id: 'security-test-search',
    name: 'Security Test Search',
    enabled: true,
    category: 'PRODUCT',
    sources: [
      {
        id: 'facebook-marketplace',
        enabled: true,
        queries: ['switch lite'],
        sessionRef: 'facebook-personal',
      },
    ],
    evaluation: {
      matchThreshold: 80,
      reviewThreshold: 40,
    },
    ai: {
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 5,
    },
    retention: {
      rawArtifacts: 'ERRORS_AND_REVIEW',
      rawDataDays: 30,
    },
  });

  it('allows safe session references (sessionRef)', () => {
    const config = createBaseConfig();
    expect(() => validateSavedSearchConfiguration(config)).not.toThrow();
  });

  it('detects and rejects forbidden password in sources[0].options without leaking secret sentinel', () => {
    const config = createBaseConfig();
    const sources = config['sources'] as Array<Record<string, unknown>>;
    sources[0] = {
      ...sources[0],
      options: {
        password: SECRET_SENTINEL,
      },
    };

    try {
      validateSavedSearchConfiguration(config);
      expect.unreachable('Should have thrown ConfigurationError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;

      expect(configErr.code).toBe('CONFIG_SECRET_FORBIDDEN');
      expect(configErr.path).toBe('sources[0].options.password');
      expect(configErr.message).toContain('Inline secret is forbidden');
      expect(configErr.suggestion).toContain('sessionRef');

      // CRITICAL VERIFICATION: Ensure the sentinel NEVER appears in any error representation
      expect(configErr.message.includes(SECRET_SENTINEL)).toBe(false);
      expect(configErr.toFormattedString().includes(SECRET_SENTINEL)).toBe(false);
      expect(JSON.stringify(configErr.toJSON()).includes(SECRET_SENTINEL)).toBe(false);
      expect(JSON.stringify(configErr).includes(SECRET_SENTINEL)).toBe(false);
    }
  });

  it('detects and rejects inline tokens, cookies, and apiKeys across various nested paths', () => {
    const testCases: Array<{
      pathModifier: (cfg: Record<string, unknown>) => void;
      expectedPath: string;
    }> = [
      {
        pathModifier: (cfg) => {
          const sources = cfg['sources'] as Array<Record<string, unknown>>;
          sources[0] = { ...sources[0], options: { accessToken: SECRET_SENTINEL } };
        },
        expectedPath: 'sources[0].options.accessToken',
      },
      {
        pathModifier: (cfg) => {
          const sources = cfg['sources'] as Array<Record<string, unknown>>;
          sources[0] = { ...sources[0], options: { cookies: SECRET_SENTINEL } };
        },
        expectedPath: 'sources[0].options.cookies',
      },
      {
        pathModifier: (cfg) => {
          cfg['product'] = {
            expectedModels: ['LITE'],
            apiKey: SECRET_SENTINEL,
          };
        },
        expectedPath: 'product.apiKey',
      },
      {
        pathModifier: (cfg) => {
          cfg['rules'] = {
            profile: 'test',
            clientSecret: SECRET_SENTINEL,
          };
        },
        expectedPath: 'rules.clientSecret',
      },
      {
        pathModifier: (cfg) => {
          cfg['report'] = {
            bearerToken: SECRET_SENTINEL,
          };
        },
        expectedPath: 'report.bearerToken',
      },
    ];

    for (const { pathModifier, expectedPath } of testCases) {
      const config = createBaseConfig();
      pathModifier(config);

      try {
        validateSavedSearchConfiguration(config);
        expect.unreachable(`Should have rejected secret at ${expectedPath}`);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;

        const allIssues = configErr.issues.length > 0 ? configErr.issues : [configErr];
        const hasMatchingSecretIssue = allIssues.some(
          (issue) =>
            (issue.code === 'CONFIG_SECRET_FORBIDDEN' ||
              configErr.code === 'CONFIG_SECRET_FORBIDDEN') &&
            issue.path.includes(expectedPath),
        );
        expect(hasMatchingSecretIssue).toBe(true);

        // Verify no sentinel leakage
        expect(configErr.message.includes(SECRET_SENTINEL)).toBe(false);
        expect(configErr.toFormattedString().includes(SECRET_SENTINEL)).toBe(false);
        expect(JSON.stringify(configErr.toJSON()).includes(SECRET_SENTINEL)).toBe(false);
      }
    }
  });

  it('detectForbiddenSecrets pure function returns violations without values', () => {
    const payload = {
      nested: {
        deep: {
          password: 'sensitive_value_123',
          apiKey: 'key_value_456',
        },
        allowedField: 'safe',
        sessionRef: 'safe-session',
      },
    };

    const violations = detectForbiddenSecrets(payload);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.path).toBe('nested.deep.password');
    expect(violations[0]?.key).toBe('password');
    expect(violations[1]?.path).toBe('nested.deep.apiKey');
    expect(violations[1]?.key).toBe('apiKey');

    // Values must not exist on violation objects
    expect((violations[0] as unknown as Record<string, unknown>)['value']).toBeUndefined();
    expect((violations[1] as unknown as Record<string, unknown>)['value']).toBeUndefined();
  });
});
