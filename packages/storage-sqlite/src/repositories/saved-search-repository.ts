import {
  type SavedSearch,
  type SavedSearchRepository,
  type SavedSearchRevisionRecord,
  type CreateSavedSearchParams,
  createSavedSearch,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import { StorageCorruptionError } from '../errors/storage-errors.js';
import { sanitizeObject } from '../sanitization/sanitizer.js';

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

interface SavedSearchPayloadShape {
  readonly sourceConfigs?: SavedSearch['sourceConfigs'];
  readonly query?: SavedSearch['query'];
  readonly price?: SavedSearch['price'];
  readonly location?: SavedSearch['location'];
  readonly condition?: SavedSearch['condition'];
  readonly rules?: SavedSearch['rules'];
  readonly evaluation?: SavedSearch['evaluation'];
  readonly ai?: SavedSearch['ai'];
  readonly retention?: SavedSearch['retention'];
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(isoString: unknown, fieldName: string, id: string): Date {
  if (typeof isoString !== 'string') {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${id}': '${fieldName}' must be a string, got ${typeof isoString}`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${id}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateSavedSearch(row: SavedSearchRow): SavedSearch {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch (err) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${row.id}': invalid JSON payload`,
      { cause: err },
    );
  }

  if (typeof parsedPayload !== 'object' || parsedPayload === null) {
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${row.id}': JSON payload is not an object`,
    );
  }

  const payload = parsedPayload as SavedSearchPayloadShape;

  try {
    const createdAt = parseIsoDate(row.created_at, 'created_at', row.id);
    const updatedAt = parseIsoDate(row.updated_at, 'updated_at', row.id);

    if (
      !payload.sourceConfigs ||
      !payload.query ||
      !payload.evaluation ||
      !payload.ai ||
      !payload.retention
    ) {
      throw new StorageCorruptionError(
        `Corrupted persisted SavedSearch '${row.id}': missing required payload fields`,
      );
    }

    const params: CreateSavedSearchParams = {
      id: row.id,
      schemaVersion: row.schema_version,
      name: row.name,
      enabled: row.enabled === 1,
      category: row.category as SavedSearch['category'],
      sourceConfigs: payload.sourceConfigs,
      query: payload.query,
      price: payload.price ?? null,
      location: payload.location ?? null,
      condition: payload.condition ?? null,
      rules: payload.rules ?? [],
      evaluation: payload.evaluation,
      ai: payload.ai,
      retention: payload.retention,
      createdAt,
      updatedAt,
    };

    return createSavedSearch(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted SavedSearch '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
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
      return Promise.resolve(rehydrateSavedSearch(row));
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
      return Promise.resolve(rows.map((row) => rehydrateSavedSearch(row)));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(savedSearch: SavedSearch): Promise<void> {
    try {
      // Defense-in-depth: sanitize any sensitive option fields before serialization
      const sanitizedSourceConfigs = savedSearch.sourceConfigs.map((cfg) => ({
        id: cfg.id,
        enabled: cfg.enabled,
        queries: [...cfg.queries],
        ...(cfg.options !== undefined ? { options: sanitizeObject(cfg.options) } : {}),
        ...(cfg.sessionRef !== undefined ? { sessionRef: cfg.sessionRef } : {}),
      }));

      const payloadObj = {
        sourceConfigs: sanitizedSourceConfigs,
        query: savedSearch.query,
        price: savedSearch.price,
        location: savedSearch.location,
        condition: savedSearch.condition,
        rules: savedSearch.rules,
        evaluation: savedSearch.evaluation,
        ai: savedSearch.ai,
        retention: savedSearch.retention,
      };

      const payloadJson = JSON.stringify(payloadObj);
      const createdAtIso = savedSearch.createdAt.toISOString();
      const updatedAtIso = savedSearch.updatedAt.toISOString();
      const enabledInt = savedSearch.enabled ? 1 : 0;

      this.db.transaction((tx) => {
        // 1. Upsert into saved_searches
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

        // 2. Query next revision number
        const maxRevStmt = tx.prepare<{ max_rev: number }, [string]>(
          `SELECT COALESCE(MAX(revision_number), 0) AS max_rev
           FROM saved_search_revisions
           WHERE saved_search_id = ?`,
        );
        const maxRevRow = maxRevStmt.get(savedSearch.id);
        const nextRevNumber = (maxRevRow ? Number(maxRevRow.max_rev) : 0) + 1;
        const revisionId = `${savedSearch.id}_rev_${nextRevNumber}`;

        // 3. Insert append-only revision record
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

      const mapped = rows.map((row) => {
        let snapshotParsed: unknown;
        try {
          snapshotParsed = JSON.parse(row.snapshot);
        } catch {
          snapshotParsed = row.snapshot;
        }
        return {
          id: row.id,
          savedSearchId: row.saved_search_id,
          revisionNumber: Number(row.revision_number),
          schemaVersion: Number(row.schema_version),
          recordedAt: new Date(row.recorded_at),
          snapshot: snapshotParsed,
        };
      });

      return Promise.resolve(mapped);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
