import {
  type SavedSearch,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
  type CreateSavedSearchParams,
  createSavedSearch,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import { StorageCorruptionError } from '../errors/storage-errors.js';
import { validateNoSensitiveData } from '../sanitization/secret-detector.js';

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

interface CanonicalSavedSearchSnapshot {
  readonly id?: string;
  readonly schemaVersion?: number;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly category?: SavedSearch['category'];
  readonly sourceConfigs?: SavedSearch['sourceConfigs'];
  readonly query?: SavedSearch['query'];
  readonly price?: SavedSearch['price'] | null;
  readonly location?: SavedSearch['location'] | null;
  readonly condition?: SavedSearch['condition'] | null;
  readonly rules?: SavedSearch['rules'];
  readonly evaluation?: SavedSearch['evaluation'];
  readonly ai?: SavedSearch['ai'];
  readonly retention?: SavedSearch['retention'];
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(isoString: unknown, fieldName: string, id: string): Date {
  if (typeof isoString !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${id}': '${fieldName}' must be a string, got ${typeof isoString}`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch in '${id}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function serializeSavedSearch(savedSearch: SavedSearch): string {
  const snapshot: CanonicalSavedSearchSnapshot = {
    id: savedSearch.id,
    schemaVersion: savedSearch.schemaVersion,
    name: savedSearch.name,
    enabled: savedSearch.enabled,
    category: savedSearch.category,
    sourceConfigs: savedSearch.sourceConfigs,
    query: savedSearch.query,
    price: savedSearch.price ?? null,
    location: savedSearch.location ?? null,
    condition: savedSearch.condition ?? null,
    rules: savedSearch.rules ?? [],
    evaluation: savedSearch.evaluation,
    ai: savedSearch.ai,
    retention: savedSearch.retention,
    createdAt: savedSearch.createdAt.toISOString(),
    updatedAt: savedSearch.updatedAt.toISOString(),
  };
  return JSON.stringify(snapshot);
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
      sourceConfigs: data.sourceConfigs,
      query: data.query,
      price: data.price ?? null,
      location: data.location ?? null,
      condition: data.condition ?? null,
      rules: data.rules ?? [],
      evaluation: data.evaluation,
      ai: data.ai,
      retention: data.retention,
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
      // 1. Defensively inspect options before opening the transaction or writing rows.
      // If any sensitive secret data is present, throw SensitiveDataDetectedError (fail-closed, 0 mutations).
      for (const cfg of savedSearch.sourceConfigs) {
        if (cfg.options !== undefined) {
          validateNoSensitiveData(cfg.options, `sourceConfigs.${cfg.id}.options`);
        }
      }

      // 2. Canonical serialization of the complete SavedSearch (exact semantic round-trip).
      const payloadJson = serializeSavedSearch(savedSearch);
      const createdAtIso = savedSearch.createdAt.toISOString();
      const updatedAtIso = savedSearch.updatedAt.toISOString();
      const enabledInt = savedSearch.enabled ? 1 : 0;

      this.db.transaction((tx) => {
        // 3. Upsert into saved_searches
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

        // 4. Query next revision number
        const maxRevStmt = tx.prepare<{ max_rev: number }, [string]>(
          `SELECT COALESCE(MAX(revision_number), 0) AS max_rev
           FROM saved_search_revisions
           WHERE saved_search_id = ?`,
        );
        const maxRevRow = maxRevStmt.get(savedSearch.id);
        const nextRevNumber = (maxRevRow ? Number(maxRevRow.max_rev) : 0) + 1;
        const revisionId = `${savedSearch.id}_rev_${nextRevNumber}`;

        // 5. Insert complete append-only revision record
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
