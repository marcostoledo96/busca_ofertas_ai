import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Clock } from '@busca-ofertas-ai/core';
import {
  importSavedSearchYaml,
  exportSavedSearchYaml,
  parseSavedSearchYaml,
  toDomainSavedSearch,
  ConfigurationError,
} from '@busca-ofertas-ai/configuration';

describe('Configuration YAML Parsing, Serialization, and Semantic Round-Trip (BOAI-004)', () => {
  it('executes lossless domain-aware semantic round-trip on config/searches/switch-lite-amba.example.yml', () => {
    const examplePath = path.resolve(__dirname, '../config/searches/switch-lite-amba.example.yml');
    const originalYaml = fs.readFileSync(examplePath, 'utf8');

    const fakeClock: Clock = { now: () => new Date('2026-08-30T12:00:00.000Z') };

    // 1. Import YAML -> ImportedSavedSearchConfiguration (validated config + domain SavedSearch entity)
    const imported1 = importSavedSearchYaml(originalYaml, { clock: fakeClock });

    expect(imported1.configuration).toBeDefined();
    expect(imported1.savedSearch).toBeDefined();
    expect(imported1.savedSearch.id).toBe('switch-lite-amba');
    expect(imported1.savedSearch.createdAt).toEqual(new Date('2026-08-30T12:00:00.000Z'));
    expect(imported1.savedSearch.updatedAt).toEqual(new Date('2026-08-30T12:00:00.000Z'));
    expect(imported1.savedSearch.sourceConfigs).toHaveLength(
      imported1.configuration.sources.length,
    );

    // 2. Export through domain-aware imported representation
    const exportedYaml = exportSavedSearchYaml(imported1);
    expect(typeof exportedYaml).toBe('string');
    expect(exportedYaml.length).toBeGreaterThan(0);

    // 3. Re-import from exported YAML
    const imported2 = importSavedSearchYaml(exportedYaml, { clock: fakeClock });

    // 4. Semantic Equality Verification of both Configuration and Domain representations
    expect(imported2.configuration).toEqual(imported1.configuration);
    expect(imported2.savedSearch).toEqual(imported1.savedSearch);

    // Specific field preservation checks:
    expect(imported2.configuration.sources).toEqual(imported1.configuration.sources);
    expect(imported2.configuration.sources[0]?.options).toEqual(
      imported1.configuration.sources[0]?.options,
    );
    expect(imported2.configuration.product).toEqual(imported1.configuration.product);
    expect(imported2.configuration.rules).toEqual(imported1.configuration.rules);
    expect(imported2.configuration.rules?.profile).toEqual(imported1.configuration.rules?.profile);
    expect(imported2.configuration.rules?.include).toEqual(imported1.configuration.rules?.include);
    expect(imported2.configuration.rules?.exclude).toEqual(imported1.configuration.rules?.exclude);
    expect(imported2.configuration.report).toEqual(imported1.configuration.report);
    expect(imported2.configuration.report?.openAutomatically).toBe(true);
    expect(imported2.configuration.report?.includeRejected).toBe('COLLAPSED');
    expect(imported2.configuration.report?.exports).toEqual(['HTML', 'JSON', 'CSV']);
    expect(imported2.configuration.price?.minimumPlausible).toBeNull();
    expect(imported2.configuration.ai).toEqual(imported1.configuration.ai);
    expect(imported2.configuration.retention).toEqual(imported1.configuration.retention);
  });

  it('rejects domain projection if neither Clock nor explicit timestamps are provided', () => {
    const config = parseSavedSearchYaml(`
schemaVersion: 1
id: test-search
name: Test Search
enabled: true
category: PRODUCT
sources:
  - id: fb
    enabled: true
    queries: ["nintendo switch"]
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`);

    expect(() => toDomainSavedSearch(config)).toThrow(ConfigurationError);
    try {
      toDomainSavedSearch(config);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const cfgErr = err as ConfigurationError;
      expect(cfgErr.code).toBe('CONFIG_INVARIANT_VIOLATION');
      expect(cfgErr.path).toBe('toDomainSavedSearch');
      expect(cfgErr.message).toContain('Clock');
    }
  });

  describe('YAML Syntax and Structural Error Handling', () => {
    it('rejects empty YAML text with CONFIG_PARSE_ERROR', () => {
      expect(() => parseSavedSearchYaml('')).toThrow(ConfigurationError);
      expect(() => parseSavedSearchYaml('   \n  \n')).toThrow(ConfigurationError);
      try {
        parseSavedSearchYaml('');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;
        expect(configErr.code).toBe('CONFIG_PARSE_ERROR');
      }
    });

    it('rejects invalid YAML syntax with CONFIG_PARSE_ERROR', () => {
      const invalidYaml = `
schemaVersion: 1
id: test-search
name: [unclosed array
  foo: bar
`;
      try {
        parseSavedSearchYaml(invalidYaml);
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;
        expect(configErr.code).toBe('CONFIG_PARSE_ERROR');
        expect(configErr.message).toContain('YAML');
      }
    });

    it('rejects multiple YAML documents stream (---) with CONFIG_PARSE_ERROR', () => {
      const multiDocYaml = `
schemaVersion: 1
id: search-1
name: Search 1
enabled: true
category: PRODUCT
sources:
  - id: source-1
    enabled: true
    queries: ["query 1"]
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
---
schemaVersion: 1
id: search-2
name: Search 2
enabled: true
category: PRODUCT
sources:
  - id: source-2
    enabled: true
    queries: ["query 2"]
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`;
      try {
        parseSavedSearchYaml(multiDocYaml);
        expect.unreachable('Should have rejected multiple documents');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const configErr = err as ConfigurationError;
        expect(configErr.code).toBe('CONFIG_PARSE_ERROR');
        expect(configErr.message).toContain('Multiple YAML documents found');
      }
    });
  });
});
