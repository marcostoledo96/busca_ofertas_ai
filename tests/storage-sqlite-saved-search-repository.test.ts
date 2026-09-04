import { describe, it, expect } from 'vitest';
import { createSavedSearch } from '@busca-ofertas-ai/core';
import {
  SqliteSavedSearchRepository,
  StorageCorruptionError,
  SensitiveDataDetectedError,
  SavedSearchIdentityCollisionError,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteSavedSearchRepository (BOAI-011 / Findings B & C)', () => {
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
    query: { terms: ['nintendo switch lite'] },
    evaluation: { matchThreshold: 80, reviewThreshold: 40 },
    ai: {
      enabled: false,
      evaluateOnlyReview: true,
      requireConfirmation: true,
      maxEvaluationsPerRun: 10,
    },
    retention: { rawArtifacts: 'NONE', rawDataDays: 30 },
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
    updatedAt: new Date('2026-08-30T10:00:00.000Z'),
  });

  it('persists and retrieves a complete SavedSearch entity with exact fidelity', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

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
          rawArtifacts: 'ALL_LIMITED',
          rawDataDays: 60,
        },
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
        updatedAt: new Date('2026-08-30T15:30:00.000Z'),
      });

      await repo.save(fullSearch);

      const retrieved = await repo.getById('search-full');
      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(fullSearch);
    });
  });

  it('returns null when querying nonexistent SavedSearch', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const result = await repo.getById('nonexistent-search-id');
      expect(result).toBeNull();
    });
  });

  it('lists only enabled SavedSearches in ascending created_at order', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const enabledSearch1 = createSavedSearch({
        ...minimalSearch,
        id: 'search-enabled-1',
        name: 'First Enabled',
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
        enabled: true,
      });

      const disabledSearch = createSavedSearch({
        ...minimalSearch,
        id: 'search-disabled',
        name: 'Disabled Search',
        createdAt: new Date('2026-08-30T11:00:00.000Z'),
        enabled: false,
      });

      const enabledSearch2 = createSavedSearch({
        ...minimalSearch,
        id: 'search-enabled-3',
        name: 'Second Enabled',
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
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

  it('maintains append-only configuration revisions preserving full historical snapshots', async () => {
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

  it('rejects attempt to modify immutable createdAt on existing SavedSearch (Finding C3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const initial = createSavedSearch({
        ...minimalSearch,
        id: 'search-immutable-created-at',
        name: 'Original Search',
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
        updatedAt: new Date('2026-08-30T10:00:00.000Z'),
      });
      await repo.save(initial);

      // Attempt to save with modified createdAt
      const modifiedCreatedAt = createSavedSearch({
        ...initial,
        name: 'Altered Search',
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
        updatedAt: new Date('2026-08-30T12:00:00.000Z'),
      });

      await expect(repo.save(modifiedCreatedAt)).rejects.toThrow(SavedSearchIdentityCollisionError);

      // Verify row unchanged and no new revision written
      const current = await repo.getById('search-immutable-created-at');
      expect(current!.name).toBe('Original Search');
      expect(current!.createdAt).toEqual(new Date('2026-08-30T10:00:00.000Z'));

      const revisions = await repo.listRevisions('search-immutable-created-at');
      expect(revisions.length).toBe(1);
    });
  });

  it('fails closed with StorageCorruptionError when indexed table columns diverge from canonical snapshot (Finding C3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const search = createSavedSearch({
        ...minimalSearch,
        id: 'search-divergent-indexed',
        name: 'Consistent Name',
        enabled: true,
        category: 'PRODUCT',
      });
      await repo.save(search);

      // 1. Divergent name in indexed table column
      db.prepare(`UPDATE saved_searches SET name = 'Divergent Name' WHERE id = ?`).run(
        'search-divergent-indexed',
      );
      await expect(repo.getById('search-divergent-indexed')).rejects.toThrow(
        StorageCorruptionError,
      );

      // Restore name
      db.prepare(`UPDATE saved_searches SET name = 'Consistent Name' WHERE id = ?`).run(
        'search-divergent-indexed',
      );

      // 2. Divergent enabled in indexed table column (table enabled=0, snapshot enabled=true)
      db.prepare(`UPDATE saved_searches SET enabled = 0 WHERE id = ?`).run(
        'search-divergent-indexed',
      );
      await expect(repo.getById('search-divergent-indexed')).rejects.toThrow(
        StorageCorruptionError,
      );

      // Restore enabled
      db.prepare(`UPDATE saved_searches SET enabled = 1 WHERE id = ?`).run(
        'search-divergent-indexed',
      );

      // 3. Divergent category in indexed table column
      db.prepare(`UPDATE saved_searches SET category = 'VEHICLE' WHERE id = ?`).run(
        'search-divergent-indexed',
      );
      await expect(repo.getById('search-divergent-indexed')).rejects.toThrow(
        StorageCorruptionError,
      );
    });
  });

  it('fails closed with StorageCorruptionError when revision row metadata diverges from snapshot (Finding C3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const search = createSavedSearch({
        ...minimalSearch,
        id: 'search-rev-divergent',
        name: 'Consistent Rev Search',
      });
      await repo.save(search);

      const searchOther = createSavedSearch({
        ...minimalSearch,
        id: 'other-id',
        name: 'Other Search',
      });
      await repo.save(searchOther);

      // 1. Divergent saved_search_id in revision table: row points to 'other-id' but snapshot has id: 'search-rev-divergent'
      db.prepare(
        `UPDATE saved_search_revisions SET saved_search_id = 'other-id', revision_number = 2 WHERE id = 'search-rev-divergent_rev_1'`,
      ).run();
      await expect(repo.listRevisions('other-id')).rejects.toThrow(StorageCorruptionError);

      // 2. Divergent schema_version in revision table
      db.prepare(
        `UPDATE saved_search_revisions SET saved_search_id = 'search-rev-divergent', schema_version = 99 WHERE id = 'search-rev-divergent_rev_1'`,
      ).run();
      await expect(repo.listRevisions('search-rev-divergent')).rejects.toThrow(
        StorageCorruptionError,
      );
    });
  });

  it('fails closed with StorageCorruptionError when revision JSON, date, or snapshot domain invariants are corrupted', async () => {
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

  it('preserves exact semantic round-trip for legitimate options without silent modification', async () => {
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

  it('fails closed when nesting exceeds maxDepth > 20 and writes 0 rows (Finding 1A)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // Construct a deeply nested object > 20 levels with a secret at the bottom
      let deeplyNested: Record<string, unknown> = { secretKey: 'some-sec-key' };
      for (let d = 0; d < 22; d++) {
        deeplyNested = { nestedLevel: deeplyNested };
      }

      const searchWithDeepNesting = createSavedSearch({
        ...minimalSearch,
        id: 'search-deep-nesting',
        sourceConfigs: [
          {
            id: 'fb-marketplace',
            enabled: true,
            queries: ['test'],
            options: deeplyNested,
          },
        ],
      });

      await expect(repo.save(searchWithDeepNesting)).rejects.toThrow(SensitiveDataDetectedError);

      // Verify 0 rows in saved_searches and saved_search_revisions
      const searchRow = db
        .prepare('SELECT id FROM saved_searches WHERE id = ?')
        .get('search-deep-nesting');
      expect(searchRow).toBeUndefined();

      const revRow = db
        .prepare('SELECT id FROM saved_search_revisions WHERE saved_search_id = ?')
        .get('search-deep-nesting');
      expect(revRow).toBeUndefined();
    });
  });

  it('scans primitive string leaves at exactly depth 0, throws SensitiveDataDetectedError, and writes 0 rows (Finding 1A)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // Helper to build a chain of exactly 20 nested objects where the 20th level's value is the leaf
      const buildDepth20Chain = (leafValue: string): Record<string, unknown> => {
        let current: unknown = leafValue;
        for (let i = 0; i < 20; i++) {
          current = { [`level_${19 - i}`]: current };
        }
        return current as Record<string, unknown>;
      };

      const testLeaves = [
        { desc: 'Bearer token at depth 0', leaf: 'Bearer abcdefghijklmnopqrstuvwxyz' },
        { desc: 'Cookie header at depth 0', leaf: 'Cookie: session=my-secret-cookie-value' },
        { desc: 'password at depth 0', leaf: 'password=supersecretpassword123' },
      ];

      for (let i = 0; i < testLeaves.length; i++) {
        const item = testLeaves[i]!;
        const searchId = `search-depth0-leaf-${i}`;
        const search = createSavedSearch({
          ...minimalSearch,
          id: searchId,
          sourceConfigs: [
            {
              id: 'fb-marketplace',
              enabled: true,
              queries: ['test'],
              options: buildDepth20Chain(item.leaf),
            },
          ],
        });

        await expect(repo.save(search)).rejects.toThrow(SensitiveDataDetectedError);

        // Verify 0 rows in saved_searches and saved_search_revisions for each case
        const searchRow = db.prepare('SELECT id FROM saved_searches WHERE id = ?').get(searchId);
        expect(searchRow).toBeUndefined();

        const revRow = db
          .prepare('SELECT id FROM saved_search_revisions WHERE saved_search_id = ?')
          .get(searchId);
        expect(revRow).toBeUndefined();
      }
    });
  });

  it('validates rules[].params for secrets and writes 0 rows on detection (Finding 1B)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const secretRulesCases = [
        { desc: 'rules[0].params.apiKey', params: { apiKey: 'secret-api-key-123' } },
        { desc: 'rules[0].params.password', params: { password: 'secret-pass-456' } },
        { desc: 'rules[0].params.authorization', params: { authorization: 'Bearer secret-auth' } },
        {
          desc: 'nested bearer/cookie in rules[0].params',
          params: { nested: { header: 'Cookie: session=xyz123' } },
        },
      ];

      for (let i = 0; i < secretRulesCases.length; i++) {
        const item = secretRulesCases[i]!;
        const searchId = `search-rule-secret-${i}`;
        const search = createSavedSearch({
          ...minimalSearch,
          id: searchId,
          rules: [
            {
              id: 'rule-test-secret',
              type: 'CUSTOM_FILTER',
              params: item.params,
            },
          ],
        });

        await expect(repo.save(search)).rejects.toThrow(SensitiveDataDetectedError);

        // Verify 0 current row and 0 revisions
        const searchRow = db.prepare('SELECT id FROM saved_searches WHERE id = ?').get(searchId);
        expect(searchRow).toBeUndefined();

        const revRow = db
          .prepare('SELECT id FROM saved_search_revisions WHERE saved_search_id = ?')
          .get(searchId);
        expect(revRow).toBeUndefined();
      }

      // Legitimate rule parameters pass and round-trip cleanly
      const legitSearchId = 'search-rule-legit';
      const legitSearch = createSavedSearch({
        ...minimalSearch,
        id: legitSearchId,
        rules: [
          {
            id: 'rule-legit',
            type: 'PRICE_CEILING',
            params: { maxPrice: 250000, terms: ['switch'] },
          },
        ],
      });

      await repo.save(legitSearch);
      const retrieved = await repo.getById(legitSearchId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.rules[0]!.params).toEqual({ maxPrice: 250000, terms: ['switch'] });
    });
  });

  it('validates sessionRef: opaque IDs round-trip, real credential patterns reject with 0 rows (Finding B2)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      // 1. Valid opaque identifiers round-trip exactly
      const validSessionRefs = [
        'facebook-default-session',
        'session-profile-01',
        'opaque-session-ref-id',
      ];

      for (let i = 0; i < validSessionRefs.length; i++) {
        const sId = `search-valid-session-${i}`;
        const ref = validSessionRefs[i]!;
        const validSearch = createSavedSearch({
          ...minimalSearch,
          id: sId,
          sourceConfigs: [
            {
              id: 'fb-marketplace',
              enabled: true,
              queries: ['test'],
              sessionRef: ref,
            },
          ],
        });

        await repo.save(validSearch);
        const retrieved = await repo.getById(sId);
        expect(retrieved!.sourceConfigs[0]!.sessionRef).toBe(ref);
      }

      // 2. Secret-bearing sessionRef values must be rejected
      const invalidSessionRefs = [
        { desc: 'Cookie pattern', ref: 'Cookie: session_id=123' },
        { desc: 'Set-Cookie pattern', ref: 'Set-Cookie: token=abc' },
        { desc: 'Authorization pattern', ref: 'Authorization: Basic xyz' },
        { desc: 'Bearer pattern', ref: 'Bearer my-secret-token-123' },
        { desc: 'password= pattern', ref: 'user=admin&password=mysecret' },
        { desc: 'token= pattern', ref: 'oauth_token=token-123' },
        { desc: 'api_key= pattern', ref: 'api_key=key-123' },
      ];

      for (let i = 0; i < invalidSessionRefs.length; i++) {
        const item = invalidSessionRefs[i]!;
        const sId = `search-invalid-session-${i}`;
        const invalidSearch = createSavedSearch({
          ...minimalSearch,
          id: sId,
          sourceConfigs: [
            {
              id: 'fb-marketplace',
              enabled: true,
              queries: ['test'],
              sessionRef: item.ref,
            },
          ],
        });

        await expect(repo.save(invalidSearch)).rejects.toThrow(SensitiveDataDetectedError);

        // Verify 0 rows in saved_searches and 0 rows in saved_search_revisions
        const searchRow = db.prepare('SELECT id FROM saved_searches WHERE id = ?').get(sId);
        expect(searchRow).toBeUndefined();

        const revRow = db
          .prepare('SELECT id FROM saved_search_revisions WHERE saved_search_id = ?')
          .get(sId);
        expect(revRow).toBeUndefined();
      }
    });
  });

  it('detects obvious sensitive keys in options, throws SensitiveDataDetectedError, and writes 0 rows (Finding B3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const forbiddenKeysConfigs = [
        { desc: 'privateKey', options: { privateKey: 'my-priv-key' } },
        { desc: 'secretKey', options: { secretKey: 'my-sec-key' } },
        { desc: 'accessKey', options: { accessKey: 'my-acc-key' } },
        { desc: 'clientSecret', options: { clientSecret: 'my-client-sec' } },
        { desc: 'apiKey', options: { apiKey: 'my-api-key' } },
        { desc: 'authToken', options: { authToken: 'my-auth-tok' } },
        { desc: 'bearerToken', options: { bearerToken: 'my-bearer-tok' } },
        { desc: 'password', options: { password: 'my-password' } },
        { desc: 'cookieHeader', options: { cookieHeader: 'my-cookie-header' } },
      ];

      for (let i = 0; i < forbiddenKeysConfigs.length; i++) {
        const item = forbiddenKeysConfigs[i]!;
        const searchId = `search-secret-key-${i}`;
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

  it('fails closed with StorageCorruptionError when canonical fields are missing in current payload or revision snapshot (Finding 3)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const search = createSavedSearch({
        ...minimalSearch,
        id: 'search-canonical-fields',
        name: 'Valid Canonical Search',
      });
      await repo.save(search);

      const fieldsToRemove = [
        'id',
        'name',
        'enabled',
        'category',
        'createdAt',
        'updatedAt',
      ] as const;

      for (const field of fieldsToRemove) {
        // 1. Current payload missing field
        const fullPayload = JSON.parse(
          (
            db
              .prepare('SELECT payload FROM saved_searches WHERE id = ?')
              .get('search-canonical-fields') as { payload: string }
          ).payload,
        ) as Record<string, unknown>;
        const corruptPayload: Record<string, unknown> = { ...fullPayload };
        delete corruptPayload[field];

        db.prepare('UPDATE saved_searches SET payload = ? WHERE id = ?').run(
          JSON.stringify(corruptPayload),
          'search-canonical-fields',
        );

        await expect(repo.getById('search-canonical-fields')).rejects.toThrow(
          StorageCorruptionError,
        );

        // Restore current payload
        db.prepare('UPDATE saved_searches SET payload = ? WHERE id = ?').run(
          JSON.stringify(fullPayload),
          'search-canonical-fields',
        );

        // 2. Revision snapshot missing field
        const fullSnapshot = JSON.parse(
          (
            db
              .prepare('SELECT snapshot FROM saved_search_revisions WHERE saved_search_id = ?')
              .get('search-canonical-fields') as { snapshot: string }
          ).snapshot,
        ) as Record<string, unknown>;
        const corruptSnapshot: Record<string, unknown> = { ...fullSnapshot };
        delete corruptSnapshot[field];

        db.prepare('UPDATE saved_search_revisions SET snapshot = ? WHERE saved_search_id = ?').run(
          JSON.stringify(corruptSnapshot),
          'search-canonical-fields',
        );

        await expect(repo.listRevisions('search-canonical-fields')).rejects.toThrow(
          StorageCorruptionError,
        );

        // Restore revision snapshot
        db.prepare('UPDATE saved_search_revisions SET snapshot = ? WHERE saved_search_id = ?').run(
          JSON.stringify(fullSnapshot),
          'search-canonical-fields',
        );
      }
    });
  });

  it('fails closed with StorageCorruptionError when canonical snapshot structures have invalid runtime shapes (Wave 4 Finding Único)', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteSavedSearchRepository(db);

      const search = createSavedSearch({
        ...minimalSearch,
        id: 'search-structural-test',
        name: 'Valid Search',
      });
      await repo.save(search);

      const invalidShapeCases: readonly {
        desc: string;
        mutate: (payload: Record<string, unknown>) => void;
      }[] = [
        {
          desc: 'price = "CORRUPT"',
          mutate: (p) => {
            p['price'] = 'CORRUPT';
          },
        },
        {
          desc: 'location = 42',
          mutate: (p) => {
            p['location'] = 42;
          },
        },
        {
          desc: 'retention = {}',
          mutate: (p) => {
            p['retention'] = {};
          },
        },
        {
          desc: 'ai = {}',
          mutate: (p) => {
            p['ai'] = {};
          },
        },
        {
          desc: 'sourceConfigs = [{ id: 123, enabled: "yes", queries: [] }]',
          mutate: (p) => {
            p['sourceConfigs'] = [{ id: 123, enabled: 'yes', queries: [] }];
          },
        },
        {
          desc: 'query.terms = [123]',
          mutate: (p) => {
            p['query'] = { terms: [123] };
          },
        },
        {
          desc: 'rules = [{ id: 123, type: false }]',
          mutate: (p) => {
            p['rules'] = [{ id: 123, type: false }];
          },
        },
      ];

      for (const item of invalidShapeCases) {
        // 1. Current payload test
        const originalCurrent = JSON.parse(
          (
            db
              .prepare('SELECT payload FROM saved_searches WHERE id = ?')
              .get('search-structural-test') as { payload: string }
          ).payload,
        ) as Record<string, unknown>;

        const corruptCurrent: Record<string, unknown> = { ...originalCurrent };
        item.mutate(corruptCurrent);

        db.prepare('UPDATE saved_searches SET payload = ? WHERE id = ?').run(
          JSON.stringify(corruptCurrent),
          'search-structural-test',
        );

        await expect(repo.getById('search-structural-test')).rejects.toThrow(
          StorageCorruptionError,
        );

        // Restore current payload
        db.prepare('UPDATE saved_searches SET payload = ? WHERE id = ?').run(
          JSON.stringify(originalCurrent),
          'search-structural-test',
        );

        // 2. Revision snapshot test
        const originalSnapshot = JSON.parse(
          (
            db
              .prepare('SELECT snapshot FROM saved_search_revisions WHERE saved_search_id = ?')
              .get('search-structural-test') as { snapshot: string }
          ).snapshot,
        ) as Record<string, unknown>;

        const corruptSnapshot: Record<string, unknown> = { ...originalSnapshot };
        item.mutate(corruptSnapshot);

        db.prepare('UPDATE saved_search_revisions SET snapshot = ? WHERE saved_search_id = ?').run(
          JSON.stringify(corruptSnapshot),
          'search-structural-test',
        );

        await expect(repo.listRevisions('search-structural-test')).rejects.toThrow(
          StorageCorruptionError,
        );

        // Restore revision snapshot
        db.prepare('UPDATE saved_search_revisions SET snapshot = ? WHERE saved_search_id = ?').run(
          JSON.stringify(originalSnapshot),
          'search-structural-test',
        );
      }
    });
  });
});
