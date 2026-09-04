import { describe, it, expect } from 'vitest';
import {
  validateSavedSearchConfiguration,
  toDomainSavedSearch,
  parseSavedSearchYaml,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';
import { SqliteSavedSearchRepository } from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';
import { type Clock } from '@busca-ofertas-ai/core';
import { WIZARD_DEFAULT_RETENTION } from '../apps/cli/src/wizard/wizard-defaults.js';

describe('Legacy ALL Retention Canonicalization (BOAI-016)', () => {
  const fakeClock: Clock = { now: () => new Date('2026-09-03T12:00:00.000Z') };

  const baseValidConfig: SavedSearchConfigurationV1 = {
    schemaVersion: 1,
    id: 'test-legacy-all',
    name: 'Nintendo Switch Lite Search',
    enabled: true,
    category: 'PRODUCT',
    sources: [
      {
        id: 'facebook-marketplace',
        enabled: true,
        queries: ['nintendo switch lite'],
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
      rawArtifacts: 'ALL',
      rawDataDays: 30,
    },
  };

  it('accepts legacy ALL in Schema V1 validation', () => {
    const validated = validateSavedSearchConfiguration(baseValidConfig);
    expect(validated.retention.rawArtifacts).toBe('ALL');
  });

  it('parses YAML with rawArtifacts: ALL successfully', () => {
    const yaml = `
schemaVersion: 1
id: test-yaml-legacy
name: Test Legacy
enabled: true
category: PRODUCT
sources:
  - id: facebook-marketplace
    enabled: true
    queries:
      - switch lite
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ALL
  rawDataDays: 30
`;
    const parsed = parseSavedSearchYaml(yaml);
    expect(parsed.retention.rawArtifacts).toBe('ALL');

    const domain = toDomainSavedSearch(parsed, { clock: fakeClock });
    expect(domain.retention.rawArtifacts).toBe('ALL_LIMITED');
  });

  it('canonicalizes legacy ALL -> ALL_LIMITED in toDomainSavedSearch()', () => {
    const domainEntity = toDomainSavedSearch(baseValidConfig, { clock: fakeClock });
    expect(domainEntity.retention.rawArtifacts).toBe('ALL_LIMITED');
  });

  it('preserves canonical policies NONE, ERRORS_ONLY, ERRORS_AND_REVIEW, ALL_LIMITED unchanged', () => {
    const policies = ['NONE', 'ERRORS_ONLY', 'ERRORS_AND_REVIEW', 'ALL_LIMITED'] as const;

    for (const policy of policies) {
      const config: SavedSearchConfigurationV1 = {
        ...baseValidConfig,
        id: `test-${policy.toLowerCase()}`,
        retention: {
          rawArtifacts: policy,
          rawDataDays: 30,
        },
      };
      const domainEntity = toDomainSavedSearch(config, { clock: fakeClock });
      expect(domainEntity.retention.rawArtifacts).toBe(policy);
    }
  });

  it('rehydrates legacy persisted SQLite rows with rawArtifacts: ALL into domain ALL_LIMITED', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // Insert raw SQL payload simulating an existing database row with legacy "ALL"
      const legacyPayload = {
        id: 'legacy-db-search',
        schemaVersion: 1,
        name: 'Legacy Persisted Search',
        enabled: true,
        category: 'PRODUCT',
        sourceConfigs: [
          {
            id: 'facebook-marketplace',
            enabled: true,
            queries: ['switch lite'],
          },
        ],
        query: {
          terms: ['switch lite'],
          excludedTerms: [],
        },
        price: null,
        location: null,
        condition: null,
        rules: [],
        evaluation: {
          matchThreshold: 80,
          reviewThreshold: 40,
          precisionProfile: 'MIXED',
        },
        ai: {
          enabled: false,
          evaluateOnlyReview: true,
          requireConfirmation: true,
          maxEvaluationsPerRun: 5,
        },
        retention: {
          rawArtifacts: 'ALL',
          rawDataDays: 30,
        },
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
      };

      db.prepare(
        `
        INSERT INTO saved_searches (
          id, schema_version, name, category, enabled, created_at, updated_at, payload
        ) VALUES (
          'legacy-db-search', 1, 'Legacy Persisted Search', 'PRODUCT', 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z', :payload
        )
      `,
      ).run({ payload: JSON.stringify(legacyPayload) });

      const rehydrated = await repo.getById('legacy-db-search');
      expect(rehydrated).not.toBeNull();
      // Canonicalized from ALL to ALL_LIMITED
      expect(rehydrated?.retention.rawArtifacts).toBe('ALL_LIMITED');
    });
  });

  it('never emits legacy ALL in wizard default retention configuration', () => {
    expect(WIZARD_DEFAULT_RETENTION.rawArtifacts).not.toBe('ALL');
    expect(WIZARD_DEFAULT_RETENTION.rawArtifacts).toBe('ERRORS_AND_REVIEW');
  });
});
