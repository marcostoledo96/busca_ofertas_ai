import { describe, it, expect } from 'vitest';
import { createSavedSearch } from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteSavedSearchRepository,
  StorageCorruptionError,
  REDACTED_PLACEHOLDER,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteSavedSearchRepository (BOAI-011)', () => {
  const minimalSearch = createSavedSearch({
    id: 'search-minimal',
    schemaVersion: 1,
    name: 'Nintendo Switch Lite Minimal',
    enabled: true,
    category: 'PRODUCT',
    sourceConfigs: [
      {
        id: 'fb-marketplace',
        enabled: true,
        queries: ['nintendo switch lite'],
      },
    ],
    query: {
      terms: ['nintendo switch lite'],
    },
    evaluation: {
      matchThreshold: 80,
      reviewThreshold: 40,
    },
    ai: {
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 10,
    },
    retention: {
      rawArtifacts: 'ERRORS_AND_REVIEW',
      rawDataDays: 30,
    },
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
    updatedAt: new Date('2026-08-30T10:00:00.000Z'),
  });

  const fullSearch = createSavedSearch({
    id: 'search-full',
    schemaVersion: 2,
    name: 'Nintendo Switch Lite Full Config',
    enabled: true,
    category: 'PRODUCT',
    sourceConfigs: [
      {
        id: 'fb-marketplace',
        enabled: true,
        queries: ['nintendo switch lite coral', 'switch lite turquesa'],
        options: {
          radiusKm: 30,
          exactMatchOnly: true,
        },
        sessionRef: 'session-opaque-ref-123',
      },
      {
        id: 'mercadolibre',
        enabled: false,
        queries: ['switch lite usada'],
      },
    ],
    query: {
      terms: ['nintendo switch lite', 'switch lite'],
      excludedTerms: ['bloqueada', 'para repuesto', 'banned', 'funda'],
    },
    price: {
      targetCurrency: 'ARS',
      maximum: 250000,
      minimumPlausible: 80000,
      foreignCurrency: {
        mode: 'MANUAL_RATE',
        onUnknown: 'REVIEW',
      },
    },
    location: {
      mode: 'REGION',
      region: 'AMBA',
      radiusKm: 35,
      coordinates: {
        latitude: -34.6037,
        longitude: -58.3816,
      },
    },
    condition: {
      accepted: ['LIKE_NEW', 'GOOD', 'FAIR'],
    },
    rules: [
      {
        id: 'rule-max-price',
        type: 'PRICE_CEILING',
        params: { maxPrice: 250000 },
      },
      {
        id: 'rule-exclude-defective',
        type: 'EXCLUDE_TERMS',
        params: { terms: ['roto', 'pantalla rota'] },
      },
    ],
    evaluation: {
      matchThreshold: 85,
      reviewThreshold: 45,
      precisionProfile: 'STRICT',
    },
    ai: {
      enabled: true,
      evaluateOnlyReview: true,
      provider: 'deepseek-chat',
      requireConfirmation: true,
      maxEvaluationsPerRun: 25,
    },
    retention: {
      rawArtifacts: 'ALL',
      rawDataDays: 60,
    },
    createdAt: new Date('2026-08-30T12:00:00.000Z'),
    updatedAt: new Date('2026-08-30T15:30:00.000Z'),
  });

  it('persists and retrieves minimal SavedSearch with exact semantic roundtrip', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      await repo.save(minimalSearch);

      const retrieved = await repo.getById(minimalSearch.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(minimalSearch);
    });
  });

  it('persists and retrieves full complex SavedSearch with multi-source, policies, and rules across DB close/reopen', async () => {
    const ctx = createTempDatabaseContext();
    try {
      // 1. Open DB, migrate, and save
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const repo1 = new SqliteSavedSearchRepository(db1);

      await repo1.save(fullSearch);
      db1.close();

      // 2. Reopen fresh DB connection to the same file
      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const repo2 = new SqliteSavedSearchRepository(db2);

      const retrieved = await repo2.getById(fullSearch.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(fullSearch);

      // Verify dates are real Date objects in UTC
      expect(retrieved!.createdAt).toBeInstanceOf(Date);
      expect(retrieved!.createdAt.toISOString()).toBe('2026-08-30T12:00:00.000Z');
      expect(retrieved!.updatedAt).toBeInstanceOf(Date);
      expect(retrieved!.updatedAt.toISOString()).toBe('2026-08-30T15:30:00.000Z');

      // Verify domain immutability / constructor validation worked
      expect(retrieved!.sourceConfigs.length).toBe(2);
      expect(retrieved!.rules.length).toBe(2);

      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('returns null when querying nonexistent SavedSearch id', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const result = await repo.getById('nonexistent-id-12345');
      expect(result).toBeNull();
    });
  });

  it('listEnabled() returns only enabled SavedSearches filtered directly via SQL', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const enabledSearch1 = createSavedSearch({
        ...minimalSearch,
        id: 'search-enabled-1',
        name: 'Enabled Search 1',
        enabled: true,
      });

      const disabledSearch = createSavedSearch({
        ...minimalSearch,
        id: 'search-disabled-2',
        name: 'Disabled Search 2',
        enabled: false,
      });

      const enabledSearch2 = createSavedSearch({
        ...minimalSearch,
        id: 'search-enabled-3',
        name: 'Enabled Search 3',
        enabled: true,
      });

      await repo.save(enabledSearch1);
      await repo.save(disabledSearch);
      await repo.save(enabledSearch2);

      const enabledList = await repo.listEnabled();
      expect(enabledList.length).toBe(2);
      expect(enabledList.map((s) => s.id).sort()).toEqual(['search-enabled-1', 'search-enabled-3']);
    });
  });

  it('maintains append-only configuration revisions when a search is updated', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // Revision 1: initial creation
      const v1 = createSavedSearch({
        ...minimalSearch,
        id: 'search-rev-test',
        name: 'Initial Name',
        evaluation: { matchThreshold: 70, reviewThreshold: 30 },
        updatedAt: new Date('2026-08-30T10:00:00.000Z'),
      });
      await repo.save(v1);

      // Revision 2: updated evaluation threshold
      const v2 = createSavedSearch({
        ...v1,
        name: 'Updated Name',
        evaluation: { matchThreshold: 85, reviewThreshold: 45 },
        updatedAt: new Date('2026-08-30T11:00:00.000Z'),
      });
      await repo.save(v2);

      // Revision 3: added query term
      const v3 = createSavedSearch({
        ...v2,
        query: { terms: ['nintendo switch lite', 'switch oled'] },
        updatedAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      await repo.save(v3);

      // Current state matches v3
      const current = await repo.getById('search-rev-test');
      expect(current).not.toBeNull();
      expect(current!.name).toBe('Updated Name');
      expect(current!.query.terms).toEqual(['nintendo switch lite', 'switch oled']);
      expect(current!.evaluation.matchThreshold).toBe(85);

      // Revisions history contains all 3 revisions in ascending order
      const revisions = await repo.listRevisions('search-rev-test');
      expect(revisions.length).toBe(3);

      expect(revisions[0]!.revisionNumber).toBe(1);
      expect(revisions[0]!.savedSearchId).toBe('search-rev-test');
      expect(revisions[0]!.recordedAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');

      expect(revisions[1]!.revisionNumber).toBe(2);
      expect(revisions[1]!.recordedAt.toISOString()).toBe('2026-08-30T11:00:00.000Z');

      expect(revisions[2]!.revisionNumber).toBe(3);
      expect(revisions[2]!.recordedAt.toISOString()).toBe('2026-08-30T12:00:00.000Z');
    });
  });

  it('redacts sensitive secrets in options before persisting', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const searchWithSecrets = createSavedSearch({
        ...minimalSearch,
        id: 'search-with-secrets',
        sourceConfigs: [
          {
            id: 'fb-marketplace',
            enabled: true,
            queries: ['nintendo switch lite'],
            options: {
              safeField: 'normal value',
              apiKey: 'super-secret-api-key-12345',
              nested: {
                auth_token: 'bearer token secret',
                cookieHeader: 'session=xyz',
                password: 'plain_password',
              },
            },
            sessionRef: 'opaque-session-pointer-id',
          },
        ],
      });

      await repo.save(searchWithSecrets);

      // Raw SQL payload inspection
      const row = db
        .prepare<{ payload: string }, [string]>('SELECT payload FROM saved_searches WHERE id = ?')
        .get('search-with-secrets');

      expect(row).toBeDefined();
      expect(row!.payload).not.toContain('super-secret-api-key-12345');
      expect(row!.payload).not.toContain('plain_password');
      expect(row!.payload).toContain(REDACTED_PLACEHOLDER);

      // Opaque sessionRef is preserved
      expect(row!.payload).toContain('opaque-session-pointer-id');
    });
  });

  it('fails closed with StorageCorruptionError when persisted JSON is corrupted or violates invariants', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();

      // Insert corrupt JSON row directly into SQLite
      db.exec(`
        INSERT INTO saved_searches (
          id, schema_version, name, category, enabled, created_at, updated_at, payload
        ) VALUES (
          'corrupt-search-1', 1, 'Corrupt Search', 'PRODUCT', 1,
          '2026-08-30T10:00:00.000Z', '2026-08-30T10:00:00.000Z',
          '{INVALID_JSON_SYNTAX'
        );
      `);

      const repo = new SqliteSavedSearchRepository(db);
      await expect(repo.getById('corrupt-search-1')).rejects.toThrow(StorageCorruptionError);

      // Insert row with invalid domain invariants (matchThreshold < reviewThreshold)
      db.exec(`
        INSERT INTO saved_searches (
          id, schema_version, name, category, enabled, created_at, updated_at, payload
        ) VALUES (
          'corrupt-search-2', 1, 'Invalid Invariants Search', 'PRODUCT', 1,
          '2026-08-30T10:00:00.000Z', '2026-08-30T10:00:00.000Z',
          '{"sourceConfigs":[{"id":"fb","enabled":true,"queries":["test"]}],"query":{"terms":["test"]},"evaluation":{"matchThreshold":30,"reviewThreshold":80},"ai":{"enabled":false,"evaluateOnlyReview":true,"requireConfirmation":true,"maxEvaluationsPerRun":10},"retention":{"rawArtifacts":"NONE","rawDataDays":10}}'
        );
      `);

      await expect(repo.getById('corrupt-search-2')).rejects.toThrow(StorageCorruptionError);
    });
  });

  it('fails closed when persisted dates are invalid', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();

      db.exec(`
        INSERT INTO saved_searches (
          id, schema_version, name, category, enabled, created_at, updated_at, payload
        ) VALUES (
          'corrupt-date-search', 1, 'Corrupt Date', 'PRODUCT', 1,
          'NOT_A_DATE', '2026-08-30T10:00:00.000Z',
          '{"sourceConfigs":[{"id":"fb","enabled":true,"queries":["test"]}],"query":{"terms":["test"]},"evaluation":{"matchThreshold":80,"reviewThreshold":40},"ai":{"enabled":false,"evaluateOnlyReview":true,"requireConfirmation":true,"maxEvaluationsPerRun":10},"retention":{"rawArtifacts":"NONE","rawDataDays":10}}'
        );
      `);

      const repo = new SqliteSavedSearchRepository(db);
      await expect(repo.getById('corrupt-date-search')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
