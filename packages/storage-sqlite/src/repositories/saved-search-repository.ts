import {
  type SavedSearch,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
  type CreateSavedSearchParams,
  createSavedSearch,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  StorageCorruptionError,
  SavedSearchIdentityCollisionError,
} from '../errors/storage-errors.js';
import { validateNoSensitiveData, validateSessionRef } from '../sanitization/secret-detector.js';

interface SavedSearchRow {
  readonly id: string;
  readonly schema_version: number;
  readonly name: string;
  readonly category: string;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly payload: string;
}

interface SavedSearchRevisionRow {
  readonly id: string;
  readonly saved_search_id: string;
  readonly revision_number: number;
  readonly schema_version: number;
  readonly snapshot: string;
  readonly recorded_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(isoString: unknown, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${entityId}': '${fieldName}' must be a string, got ${typeof isoString}`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || !isoString.includes('T')) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

interface CanonicalSavedSearchSnapshot {
  readonly id?: unknown;
  readonly schemaVersion?: unknown;
  readonly name?: unknown;
  readonly enabled?: unknown;
  readonly category?: unknown;
  readonly sourceConfigs?: unknown;
  readonly query?: unknown;
  readonly price?: unknown;
  readonly location?: unknown;
  readonly condition?: unknown;
  readonly rules?: unknown;
  readonly evaluation?: unknown;
  readonly ai?: unknown;
  readonly retention?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

function serializeSavedSearch(search: SavedSearch): string {
  const canonical: Required<CreateSavedSearchParams> = {
    id: search.id,
    schemaVersion: search.schemaVersion,
    name: search.name,
    enabled: search.enabled,
    category: search.category,
    sourceConfigs: search.sourceConfigs,
    query: search.query,
    price: search.price ?? null,
    location: search.location ?? null,
    condition: search.condition ?? null,
    rules: search.rules,
    evaluation: search.evaluation,
    ai: search.ai,
    retention: search.retention,
    createdAt: search.createdAt,
    updatedAt: search.updatedAt,
  };
  return JSON.stringify(canonical);
}

function rehydrateSavedSearchFromSnapshot(
  rawJson: string,
  entityContext: string,
  fallbackRow?: SavedSearchRow,
): SavedSearch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': invalid JSON payload`,
      { cause: err },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': snapshot is not an object`,
    );
  }

  const data = parsed as CanonicalSavedSearchSnapshot;

  try {
    const id =
      typeof data.id === 'string'
        ? data.id
        : (fallbackRow?.id ?? entityContext.replace(/^revision:/, ''));

    if (fallbackRow) {
      parseIsoDate(fallbackRow.created_at, 'created_at', id);
      parseIsoDate(fallbackRow.updated_at, 'updated_at', id);
    }

    const rawCreatedAt = data.createdAt ?? fallbackRow?.created_at;
    const rawUpdatedAt = data.updatedAt ?? fallbackRow?.updated_at;

    const createdAt = parseIsoDate(rawCreatedAt, 'createdAt', id);
    const updatedAt = parseIsoDate(rawUpdatedAt, 'updatedAt', id);

    const schemaVersion =
      typeof data.schemaVersion === 'number'
        ? data.schemaVersion
        : (fallbackRow?.schema_version ?? 1);

    const name = typeof data.name === 'string' ? data.name : (fallbackRow?.name ?? '');

    const enabled =
      typeof data.enabled === 'boolean'
        ? data.enabled
        : fallbackRow
          ? fallbackRow.enabled === 1
          : true;

    const category = (
      typeof data.category === 'string' ? data.category : (fallbackRow?.category ?? 'PRODUCT')
    ) as SavedSearch['category'];

    // Cross-validate indexed table columns vs canonical snapshot (Finding C3)
    if (fallbackRow) {
      if (fallbackRow.id !== id) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed id '${fallbackRow.id}' does not match snapshot id '${id}'`,
        );
      }
      if (fallbackRow.schema_version !== schemaVersion) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed schema_version '${fallbackRow.schema_version}' does not match snapshot schemaVersion '${schemaVersion}'`,
        );
      }
      if (fallbackRow.name !== name) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed name '${fallbackRow.name}' does not match snapshot name '${name}'`,
        );
      }
      if ((fallbackRow.enabled === 1) !== enabled) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed enabled '${fallbackRow.enabled}' does not match snapshot enabled '${enabled}'`,
        );
      }
      if (fallbackRow.category !== category) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed category '${fallbackRow.category}' does not match snapshot category '${category}'`,
        );
      }
      if (fallbackRow.created_at !== createdAt.toISOString()) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed created_at '${fallbackRow.created_at}' does not match snapshot createdAt '${createdAt.toISOString()}'`,
        );
      }
      if (fallbackRow.updated_at !== updatedAt.toISOString()) {
        throw new StorageCorruptionError(
          `Corrupted persisted SavedSearch in '${entityContext}': indexed updated_at '${fallbackRow.updated_at}' does not match snapshot updatedAt '${updatedAt.toISOString()}'`,
        );
      }
    }

    if (
      !data.sourceConfigs ||
      !data.query ||
      !data.evaluation ||
      !data.ai ||
      !data.retention ||
      !name
    ) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch in '${entityContext}': missing required domain fields`,
      );
    }

    const params: CreateSavedSearchParams = {
      id,
      schemaVersion,
      name,
      enabled,
      category,
      sourceConfigs: data.sourceConfigs as SavedSearch['sourceConfigs'],
      query: data.query as SavedSearch['query'],
      price: (data.price as SavedSearch['price']) ?? null,
      location: (data.location as SavedSearch['location']) ?? null,
      condition: (data.condition as SavedSearch['condition']) ?? null,
      rules: (data.rules as SavedSearch['rules']) ?? [],
      evaluation: data.evaluation as SavedSearch['evaluation'],
      ai: data.ai as SavedSearch['ai'],
      retention: data.retention as SavedSearch['retention'],
      createdAt,
      updatedAt,
    };

    return createSavedSearch(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${entityContext}': domain invariant violation: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteSavedSearchRepository implements SavedSearchRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<SavedSearch | null> {
    try {
      const stmt = this.db.prepare<SavedSearchRow, [string]>(
        `SELECT id, schema_version, name, category, enabled, created_at, updated_at, payload
         FROM saved_searches
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateSavedSearchFromSnapshot(row.payload, row.id, row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listEnabled(): Promise<readonly SavedSearch[]> {
    try {
      const stmt = this.db.prepare<SavedSearchRow, []>(
        `SELECT id, schema_version, name, category, enabled, created_at, updated_at, payload
         FROM saved_searches
         WHERE enabled = 1
         ORDER BY created_at ASC, id ASC`,
      );
      const rows = stmt.all();
      return Promise.resolve(
        rows.map((row) => rehydrateSavedSearchFromSnapshot(row.payload, row.id, row)),
      );
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(savedSearch: SavedSearch): Promise<void> {
    try {
      // 1. Defensively inspect options and sessionRef before opening the transaction or writing rows.
      // If any sensitive secret data is present, throw SensitiveDataDetectedError (fail-closed, 0 mutations).
      for (const cfg of savedSearch.sourceConfigs) {
        if (cfg.options !== undefined) {
          validateNoSensitiveData(cfg.options, `sourceConfigs.${cfg.id}.options`);
        }
        if (cfg.sessionRef !== undefined) {
          validateSessionRef(cfg.sessionRef, `sourceConfigs.${cfg.id}.sessionRef`);
        }
      }

      // 2. Validate immutable createdAt identity if record already exists (Finding C3)
      const existing = this.db
        .prepare<{ id: string; created_at: string }, [string]>(
          `SELECT id, created_at FROM saved_searches WHERE id = ?`,
        )
        .get(savedSearch.id);

      if (existing) {
        if (existing.created_at !== savedSearch.createdAt.toISOString()) {
          throw new SavedSearchIdentityCollisionError({
            savedSearchId: savedSearch.id,
            existingCreatedAt: new Date(existing.created_at),
            attemptingCreatedAt: savedSearch.createdAt,
          });
        }
      }

      // 3. Canonical serialization of the complete SavedSearch (exact semantic round-trip).
      const payloadJson = serializeSavedSearch(savedSearch);
      const createdAtIso = savedSearch.createdAt.toISOString();
      const updatedAtIso = savedSearch.updatedAt.toISOString();
      const enabledInt = savedSearch.enabled ? 1 : 0;

      this.db.transaction((tx) => {
        // 4. Upsert into saved_searches
        const upsertStmt = tx.prepare(
          `INSERT INTO saved_searches (
            id, schema_version, name, category, enabled, created_at, updated_at, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            schema_version = excluded.schema_version,
            name = excluded.name,
            category = excluded.category,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            payload = excluded.payload`,
        );
        upsertStmt.run(
          savedSearch.id,
          savedSearch.schemaVersion,
          savedSearch.name,
          savedSearch.category,
          enabledInt,
          createdAtIso,
          updatedAtIso,
          payloadJson,
        );

        // 5. Query next revision number
        const maxRevStmt = tx.prepare<{ max_rev: number }, [string]>(
          `SELECT COALESCE(MAX(revision_number), 0) AS max_rev
           FROM saved_search_revisions
           WHERE saved_search_id = ?`,
        );
        const maxRevRow = maxRevStmt.get(savedSearch.id);
        const nextRevNumber = (maxRevRow ? Number(maxRevRow.max_rev) : 0) + 1;
        const revisionId = `${savedSearch.id}_rev_${nextRevNumber}`;

        // 6. Insert complete append-only revision record
        const revisionInsertStmt = tx.prepare(
          `INSERT INTO saved_search_revisions (
            id, saved_search_id, revision_number, schema_version, snapshot, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        revisionInsertStmt.run(
          revisionId,
          savedSearch.id,
          nextRevNumber,
          savedSearch.schemaVersion,
          payloadJson,
          updatedAtIso,
        );
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listRevisions(savedSearchId: string): Promise<readonly SavedSearchRevisionRecord[]> {
    try {
      const stmt = this.db.prepare<SavedSearchRevisionRow, [string]>(
        `SELECT id, saved_search_id, revision_number, schema_version, snapshot, recorded_at
         FROM saved_search_revisions
         WHERE saved_search_id = ?
         ORDER BY revision_number ASC`,
      );
      const rows = stmt.all(savedSearchId);

      const mapped: SavedSearchRevisionRecord[] = rows.map((row) => {
        const recordedAt = parseIsoDate(row.recorded_at, 'recorded_at', row.id);
        const snapshot = rehydrateSavedSearchFromSnapshot(row.snapshot, `revision:${row.id}`);

        // Validate revision consistency with row columns (Finding C3)
        if (row.saved_search_id !== snapshot.id) {
          throw new StorageCorruptionError(
            `Corrupted persisted SavedSearch revision in '${row.id}': saved_search_id '${row.saved_search_id}' does not match snapshot id '${snapshot.id}'`,
          );
        }
        if (Number(row.schema_version) !== snapshot.schemaVersion) {
          throw new StorageCorruptionError(
            `Corrupted persisted SavedSearch revision in '${row.id}': schema_version '${row.schema_version}' does not match snapshot schemaVersion '${snapshot.schemaVersion}'`,
          );
        }

        return {
          id: row.id,
          savedSearchId: row.saved_search_id,
          revisionNumber: Number(row.revision_number),
          schemaVersion: Number(row.schema_version),
          recordedAt,
          snapshot,
        };
      });

      return Promise.resolve(mapped);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
