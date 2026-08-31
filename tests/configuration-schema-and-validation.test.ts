import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseSavedSearchYaml,
  validateSavedSearchConfiguration,
  ConfigurationError,
  MAX_PAGES_LIMIT,
  MAX_ITEMS_LIMIT,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';

describe('Configuration Schema and Validation (BOAI-004)', () => {
  it('validates minimal valid SavedSearch configuration', () => {
    const minimalDoc: SavedSearchConfigurationV1 = {
      schemaVersion: 1,
      id: 'minimal-search',
      name: 'Minimal Valid Search',
      enabled: true,
      category: 'PRODUCT',
      sources: [
        {
          id: 'test-source',
          enabled: true,
          queries: ['test query'],
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
    };

    const validated = validateSavedSearchConfiguration(minimalDoc);
    expect(validated.id).toBe('minimal-search');
    expect(validated.schemaVersion).toBe(1);
    expect(validated.enabled).toBe(true);
    expect(validated.sources).toHaveLength(1);
  });

  it('validates full example config/searches/switch-lite-amba.example.yml without special-case logic', () => {
    const examplePath = path.resolve(__dirname, '../config/searches/switch-lite-amba.example.yml');
    const content = fs.readFileSync(examplePath, 'utf8');

    const config = parseSavedSearchYaml(content);

    expect(config.id).toBe('switch-lite-amba');
    expect(config.schemaVersion).toBe(1);
    expect(config.name).toBe('Nintendo Switch Lite en AMBA');
    expect(config.enabled).toBe(true);
    expect(config.category).toBe('PRODUCT');
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.id).toBe('facebook-marketplace');
    expect(config.sources[0]?.options?.['maxPages']).toBe(3);
    expect(config.sources[0]?.options?.['maxItems']).toBe(200);
    expect(config.location?.region).toBe('AMBA');
    expect(config.price?.maximum).toBe(250000);
    expect(config.price?.minimumPlausible).toBeNull();
    expect(config.product?.expectedModels).toContain('NINTENDO_SWITCH_LITE');
    expect(config.rules?.profile).toBe('switch-lite');
    expect(config.rules?.exclude).toContain('funda');
    expect(config.evaluation.matchThreshold).toBe(80);
    expect(config.evaluation.reviewThreshold).toBe(40);
    expect(config.ai.provider).toBe('deepseek');
    expect(config.report?.exports).toEqual(['HTML', 'JSON', 'CSV']);
  });

  describe('Validation Failures and Actionable Errors', () => {
    const baseValid = (): Record<string, unknown> => ({
      schemaVersion: 1,
      id: 'valid-search-id',
      name: 'Valid Search',
      enabled: true,
      category: 'PRODUCT',
      sources: [
        {
          id: 'test-source',
          enabled: true,
          queries: ['test'],
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

    it('rejects missing schemaVersion with CONFIG_SCHEMA_VERSION_REQUIRED', () => {
      const doc = baseValid();
      delete doc['schemaVersion'];

      expect(() => validateSavedSearchConfiguration(doc)).toThrow(ConfigurationError);
      try {
        validateSavedSearchConfiguration(doc);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('schemaVersion');
        expect(configErr.code).toBe('CONFIG_SCHEMA_VERSION_REQUIRED');
      }
    });

    it('rejects unsupported schemaVersion with CONFIG_SCHEMA_VALIDATION_ERROR', () => {
      const doc = { ...baseValid(), schemaVersion: 999 };

      expect(() => validateSavedSearchConfiguration(doc)).toThrow(ConfigurationError);
      try {
        validateSavedSearchConfiguration(doc);
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('schemaVersion');
        expect(configErr.message).toContain('schemaVersion must be 1');
      }
    });

    it('rejects invalid kebab-case id formats', () => {
      const invalidIds = [
        'Switch Lite',
        'switch_lite',
        'SWITCH-LITE',
        'switch--lite',
        'switch/lite',
        '',
      ];

      for (const id of invalidIds) {
        const doc = { ...baseValid(), id };
        expect(() => validateSavedSearchConfiguration(doc)).toThrow(ConfigurationError);
        try {
          validateSavedSearchConfiguration(doc);
        } catch (err: unknown) {
          const configErr = err as ConfigurationError;
          expect(configErr.path).toBe('id');
        }
      }
    });

    it('rejects invalid types (e.g. string for threshold, number for name)', () => {
      const doc = {
        ...baseValid(),
        evaluation: {
          matchThreshold: 'eighty',
          reviewThreshold: 40,
        },
      };

      try {
        validateSavedSearchConfiguration(doc);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('evaluation.matchThreshold');
      }
    });

    it('rejects invariant violation: matchThreshold <= reviewThreshold', () => {
      const doc = {
        ...baseValid(),
        evaluation: {
          matchThreshold: 40,
          reviewThreshold: 80,
        },
      };

      try {
        validateSavedSearchConfiguration(doc);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('evaluation.matchThreshold');
        expect(configErr.message).toContain('strictly greater than');
        expect(configErr.suggestion).toBe('Ensure matchThreshold is greater than reviewThreshold.');
      }
    });

    it('rejects invariant violation: price.maximum < price.minimumPlausible', () => {
      const doc = {
        ...baseValid(),
        price: {
          targetCurrency: 'ARS',
          maximum: 1000,
          minimumPlausible: 5000,
        },
      };

      try {
        validateSavedSearchConfiguration(doc);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('price.maximum');
        expect(configErr.message).toContain('cannot be less than');
        expect(configErr.suggestion).toBe(
          'Ensure price.maximum is greater than or equal to price.minimumPlausible.',
        );
      }
    });

    it('rejects empty sources array and all-disabled sources', () => {
      const emptySources = { ...baseValid(), sources: [] };
      expect(() => validateSavedSearchConfiguration(emptySources)).toThrow(ConfigurationError);

      const allDisabled = {
        ...baseValid(),
        sources: [
          { id: 'source-1', enabled: false, queries: ['a'] },
          { id: 'source-2', enabled: false, queries: ['b'] },
        ],
      };
      try {
        validateSavedSearchConfiguration(allDisabled);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('sources');
        expect(configErr.message).toContain('At least one source must be enabled');
      }
    });

    it('rejects duplicate source IDs in configuration', () => {
      const duplicateSources = {
        ...baseValid(),
        sources: [
          { id: 'facebook-marketplace', enabled: true, queries: ['switch'] },
          { id: 'facebook-marketplace', enabled: true, queries: ['lite'] },
        ],
      };

      try {
        validateSavedSearchConfiguration(duplicateSources);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.path).toBe('sources[1].id');
        expect(configErr.message).toContain('Duplicate source ID');
      }
    });

    it('rejects pagination bounds outside allowed limits', () => {
      const invalidPages = {
        ...baseValid(),
        sources: [
          {
            id: 'test-source',
            enabled: true,
            queries: ['test'],
            options: { maxPages: 0 },
          },
        ],
      };
      expect(() => validateSavedSearchConfiguration(invalidPages)).toThrow(ConfigurationError);

      const exceedsMaxPages = {
        ...baseValid(),
        sources: [
          {
            id: 'test-source',
            enabled: true,
            queries: ['test'],
            options: { maxPages: MAX_PAGES_LIMIT + 1 },
          },
        ],
      };
      expect(() => validateSavedSearchConfiguration(exceedsMaxPages)).toThrow(ConfigurationError);

      const exceedsMaxItems = {
        ...baseValid(),
        sources: [
          {
            id: 'test-source',
            enabled: true,
            queries: ['test'],
            options: { maxItems: MAX_ITEMS_LIMIT + 1 },
          },
        ],
      };
      expect(() => validateSavedSearchConfiguration(exceedsMaxItems)).toThrow(ConfigurationError);
    });

    it('rejects unknown top-level keys (strictness)', () => {
      const docWithTypo = {
        ...baseValid(),
        evalution: {
          matchThreshold: 80,
          reviewThreshold: 40,
        },
      };

      expect(() => validateSavedSearchConfiguration(docWithTypo)).toThrow(ConfigurationError);
      try {
        validateSavedSearchConfiguration(docWithTypo);
      } catch (err: unknown) {
        const configErr = err as ConfigurationError;
        expect(configErr.message).toContain('Unrecognized key');
      }
    });

    it('rejects unknown nested keys in product, rules, report (strictness)', () => {
      const docWithNestedUnknown = {
        ...baseValid(),
        product: {
          expectedModels: ['LITE'],
          unknownProductField: true,
        },
      };
      expect(() => validateSavedSearchConfiguration(docWithNestedUnknown)).toThrow(
        ConfigurationError,
      );

      const docWithRulesUnknown = {
        ...baseValid(),
        rules: {
          profile: 'switch-lite',
          customScript: 'eval()',
        },
      };
      expect(() => validateSavedSearchConfiguration(docWithRulesUnknown)).toThrow(
        ConfigurationError,
      );
    });

    it('allows open source.options for adapter-specific parameters', () => {
      const doc = {
        ...baseValid(),
        sources: [
          {
            id: 'custom-adapter',
            enabled: true,
            queries: ['test'],
            options: {
              customFilter: 'blue',
              nestedSetting: { speed: 'fast' },
            },
          },
        ],
      };

      const validated = validateSavedSearchConfiguration(doc);
      expect(validated.sources[0]?.options?.['customFilter']).toBe('blue');
    });
  });
});
