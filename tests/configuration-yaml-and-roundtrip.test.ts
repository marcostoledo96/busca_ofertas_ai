import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseSavedSearchYaml,
  serializeSavedSearchYaml,
  toDomainSavedSearch,
  ConfigurationError,
} from '@busca-ofertas-ai/configuration';

describe('Configuration YAML Parsing, Serialization, and Semantic Round-Trip (BOAI-004)', () => {
  it('executes lossless semantic round-trip on config/searches/switch-lite-amba.example.yml', () => {
    const examplePath = path.resolve(__dirname, '../config/searches/switch-lite-amba.example.yml');
    const originalYaml = fs.readFileSync(examplePath, 'utf8');

    // 1. Parse YAML -> Validated SavedSearchConfigurationV1
    const parsed1 = parseSavedSearchYaml(originalYaml);

    // 2. Project to domain model
    const fixedDate = new Date('2026-08-30T12:00:00.000Z');
    const domainSearch = toDomainSavedSearch(parsed1, {
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    expect(domainSearch.id).toBe(parsed1.id);
    expect(domainSearch.name).toBe(parsed1.name);
    expect(domainSearch.schemaVersion).toBe(parsed1.schemaVersion);
    expect(domainSearch.sourceConfigs).toHaveLength(parsed1.sources.length);
    expect(domainSearch.createdAt).toEqual(fixedDate);
    expect(domainSearch.updatedAt).toEqual(fixedDate);

    // 3. Serialize back to YAML
    const serializedYaml = serializeSavedSearchYaml(parsed1);
    expect(typeof serializedYaml).toBe('string');
    expect(serializedYaml.length).toBeGreaterThan(0);

    // 4. Re-parse serialized YAML
    const parsed2 = parseSavedSearchYaml(serializedYaml);

    // 5. Semantic Equality Verification (deep equality of all fields)
    expect(parsed2).toEqual(parsed1);

    // Specific field preservation checks:
    expect(parsed2.sources).toEqual(parsed1.sources);
    expect(parsed2.sources[0]?.options).toEqual(parsed1.sources[0]?.options);
    expect(parsed2.product).toEqual(parsed1.product);
    expect(parsed2.rules).toEqual(parsed1.rules);
    expect(parsed2.rules?.exclude).toEqual(parsed1.rules?.exclude);
    expect(parsed2.report).toEqual(parsed1.report);
    expect(parsed2.report?.exports).toEqual(['HTML', 'JSON', 'CSV']);
    expect(parsed2.price?.minimumPlausible).toBeNull();
    expect(parsed2.ai).toEqual(parsed1.ai);
    expect(parsed2.retention).toEqual(parsed1.retention);
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
