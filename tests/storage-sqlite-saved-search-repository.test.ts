import { describe, it, expect } from 'vitest';
import { createSavedSearch } from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteSavedSearchRepository,
  StorageCorruptionError,
  SensitiveDataDetectedError,
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

  it('maintains append-only configuration revisions preserving full historical snapshots (Finding 3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // Revision 1: initial creation
      const v1 = createSavedSearch({
        ...minimalSearch,
        id: 'search-rev-test',
        name: 'Initial Name',
        category: 'PRODUCT',
        enabled: true,
        evaluation: { matchThreshold: 70, reviewThreshold: 30 },
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
        updatedAt: new Date('2026-08-30T10:00:00.000Z'),
      });
      await repo.save(v1);

      // Revision 2: updated name, category, and evaluation threshold
      const v2 = createSavedSearch({
        ...v1,
        name: 'Updated Name',
        category: 'VEHICLE',
        enabled: false,
        evaluation: { matchThreshold: 85, reviewThreshold: 45 },
        updatedAt: new Date('2026-08-30T11:00:00.000Z'),
      });
      await repo.save(v2);

      // Current state matches v2
      const current = await repo.getById('search-rev-test');
      expect(current).not.toBeNull();
      expect(current!.name).toBe('Updated Name');
      expect(current!.category).toBe('VEHICLE');
      expect(current!.enabled).toBe(false);
      expect(current!.evaluation.matchThreshold).toBe(85);

      // Revisions history contains both complete historical snapshots
      const revisions = await repo.listRevisions('search-rev-test');
      expect(revisions.length).toBe(2);

      // Revision 1 still reconstructs name = 'Initial Name', category = 'PRODUCT', enabled = true
      const rev1 = revisions[0]!;
      expect(rev1.revisionNumber).toBe(1);
      expect(rev1.savedSearchId).toBe('search-rev-test');
      expect(rev1.recordedAt).toEqual(new Date('2026-08-30T10:00:00.000Z'));
      expect(rev1.snapshot.name).toBe('Initial Name');
      expect(rev1.snapshot.category).toBe('PRODUCT');
      expect(rev1.snapshot.enabled).toBe(true);
      expect(rev1.snapshot.evaluation.matchThreshold).toBe(70);
      expect(rev1.snapshot.createdAt).toBeInstanceOf(Date);
      expect(rev1.snapshot.updatedAt).toBeInstanceOf(Date);

      // Revision 2 reconstructs updated state
      const rev2 = revisions[1]!;
      expect(rev2.revisionNumber).toBe(2);
      expect(rev2.recordedAt).toEqual(new Date('2026-08-30T11:00:00.000Z'));
      expect(rev2.snapshot.name).toBe('Updated Name');
      expect(rev2.snapshot.category).toBe('VEHICLE');
      expect(rev2.snapshot.enabled).toBe(false);
      expect(rev2.snapshot.evaluation.matchThreshold).toBe(85);
    });
  });

  it('fails closed with StorageCorruptionError when revision JSON, date, or snapshot is corrupted (Finding 3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const search = createSavedSearch({
        ...minimalSearch,
        id: 'search-corrupt-rev',
        name: 'Valid Search',
      });
      await repo.save(search);

      // 1. Corrupt revision JSON
      db.prepare(
        `UPDATE saved_search_revisions SET snapshot = '{CORRUPT_JSON' WHERE saved_search_id = ?`,
      ).run('search-corrupt-rev');

      await expect(repo.listRevisions('search-corrupt-rev')).rejects.toThrow(
        StorageCorruptionError,
      );

      // 2. Corrupt recorded_at date
      db.prepare(
        `UPDATE saved_search_revisions SET snapshot = '{}', recorded_at = 'NOT_A_DATE' WHERE saved_search_id = ?`,
      ).run('search-corrupt-rev');

      await expect(repo.listRevisions('search-corrupt-rev')).rejects.toThrow(
        StorageCorruptionError,
      );

      // 3. Corrupt historical domain invariants (matchThreshold < reviewThreshold)
      db.prepare(
        `UPDATE saved_search_revisions
         SET snapshot = '{"id":"search-corrupt-rev","name":"S","schemaVersion":1,"enabled":true,"category":"PRODUCT","sourceConfigs":[{"id":"fb","enabled":true,"queries":["test"]}],"query":{"terms":["test"]},"evaluation":{"matchThreshold":20,"reviewThreshold":80},"ai":{"enabled":false,"evaluateOnlyReview":true,"requireConfirmation":true,"maxEvaluationsPerRun":10},"retention":{"rawArtifacts":"NONE","rawDataDays":10},"createdAt":"2026-08-30T10:00:00.000Z","updatedAt":"2026-08-30T10:00:00.000Z"}',
             recorded_at = '2026-08-30T10:00:00.000Z'
         WHERE saved_search_id = ?`,
      ).run('search-corrupt-rev');

      await expect(repo.listRevisions('search-corrupt-rev')).rejects.toThrow(
        StorageCorruptionError,
      );
    });
  });

  it('preserves exact semantic round-trip for legitimate options without silent modification (Finding 4)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const legitimateSearch = createSavedSearch({
        ...minimalSearch,
        id: 'search-legit-options',
        sourceConfigs: [
          {
            id: 'fb-marketplace',
            enabled: true,
            queries: ['nintendo switch'],
            options: {
              authMode: 'interactive',
              sessionRequired: true,
              authenticationStrategy: 'manual',
              nested: {
                deepSetting: 42,
                allowedFlag: true,
              },
            },
            sessionRef: 'opaque-session-ref-id',
          },
        ],
      });

      await repo.save(legitimateSearch);

      const retrieved = await repo.getById('search-legit-options');
      expect(retrieved).not.toBeNull();
      const options = retrieved!.sourceConfigs[0]!.options;

      // MUST NOT be mutated or replaced with [REDACTED]
      expect(options).toEqual({
        authMode: 'interactive',
        sessionRequired: true,
        authenticationStrategy: 'manual',
        nested: {
          deepSetting: 42,
          allowedFlag: true,
        },
      });

      // sessionRef is preserved as opaque pointer
      expect(retrieved!.sourceConfigs[0]!.sessionRef).toBe('opaque-session-ref-id');
    });
  });

  it('detects forbidden secrets in options, throws SensitiveDataDetectedError, and writes 0 rows (Finding 4)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const forbiddenConfigs = [
        {
          desc: 'forbidden password',
          options: { password: 'test-user-pass' },
        },
        {
          desc: 'forbidden apiKey',
          options: { apiKey: 'test-api-key' },
        },
        {
          desc: 'forbidden authToken',
          options: { nested: { auth_token: 'test-token' } },
        },
        {
          desc: 'forbidden cookieHeader',
          options: { cookieHeader: 'session=xyz' },
        },
      ];

      for (let i = 0; i < forbiddenConfigs.length; i++) {
        const item = forbiddenConfigs[i]!;
        const searchId = `search-secret-${i}`;
        const searchWithSecret = createSavedSearch({
          ...minimalSearch,
          id: searchId,
          sourceConfigs: [
            {
              id: 'fb-marketplace',
              enabled: true,
              queries: ['test'],
              options: item.options,
            },
          ],
        });

        await expect(repo.save(searchWithSecret)).rejects.toThrow(SensitiveDataDetectedError);

        // Verify 0 rows in saved_searches and 0 rows in saved_search_revisions
        const searchRow = db.prepare('SELECT id FROM saved_searches WHERE id = ?').get(searchId);
        expect(searchRow).toBeUndefined();

        const revRow = db
          .prepare('SELECT id FROM saved_search_revisions WHERE saved_search_id = ?')
          .get(searchId);
        expect(revRow).toBeUndefined();
      }
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
          '{"id":"corrupt-search-2","schemaVersion":1,"name":"Invalid Invariants Search","enabled":true,"category":"PRODUCT","sourceConfigs":[{"id":"fb","enabled":true,"queries":["test"]}],"query":{"terms":["test"]},"evaluation":{"matchThreshold":30,"reviewThreshold":80},"ai":{"enabled":false,"evaluateOnlyReview":true,"requireConfirmation":true,"maxEvaluationsPerRun":10},"retention":{"rawArtifacts":"NONE","rawDataDays":10},"createdAt":"2026-08-30T10:00:00.000Z","updatedAt":"2026-08-30T10:00:00.000Z"}'
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
          '{"id":"corrupt-date-search","schemaVersion":1,"name":"Corrupt Date","enabled":true,"category":"PRODUCT","sourceConfigs":[{"id":"fb","enabled":true,"queries":["test"]}],"query":{"terms":["test"]},"evaluation":{"matchThreshold":80,"reviewThreshold":40},"ai":{"enabled":false,"evaluateOnlyReview":true,"requireConfirmation":true,"maxEvaluationsPerRun":10},"retention":{"rawArtifacts":"NONE","rawDataDays":10},"createdAt":"2026-08-30T10:00:00.000Z","updatedAt":"2026-08-30T10:00:00.000Z"}'
        );
      `);

      const repo = new SqliteSavedSearchRepository(db);
      await expect(repo.getById('corrupt-date-search')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
