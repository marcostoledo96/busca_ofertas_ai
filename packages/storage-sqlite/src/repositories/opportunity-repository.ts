import {
  type Opportunity,
  type OpportunityRepository,
  type OpportunityNovelty,
  createOpportunity,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  OpportunityIdentityCollisionError,
  StorageCorruptionError,
} from '../errors/storage-errors.js';

interface OpportunityRow {
  readonly id: string;
  readonly saved_search_id: string;
  readonly observation_id: string;
  readonly evaluation_id: string;
  readonly novelty: string;
  readonly created_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const EXACT_CANONICAL_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string' || !EXACT_CANONICAL_UTC_REGEX.test(isoString)) {
    throw new StorageCorruptionError(
      `Corrupted persisted Opportunity '${entityId}': '${fieldName}' must be a canonical ISO UTC date string in 'YYYY-MM-DDTHH:mm:ss.sssZ' format, got '${String(isoString)}'`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== isoString) {
    throw new StorageCorruptionError(
      `Corrupted persisted Opportunity '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateOpportunity(row: OpportunityRow): Opportunity {
  try {
    const createdAt = parseIsoDate(row.created_at, 'created_at', row.id);

    return createOpportunity({
      id: row.id,
      savedSearchId: row.saved_search_id,
      observationId: row.observation_id,
      evaluationId: row.evaluation_id,
      novelty: row.novelty as OpportunityNovelty,
      createdAt,
    });
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Opportunity '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteOpportunityRepository implements OpportunityRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Opportunity | null> {
    try {
      const stmt = this.db.prepare<OpportunityRow, [string]>(
        `SELECT id, saved_search_id, observation_id, evaluation_id, novelty, created_at
         FROM opportunities
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateOpportunity(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listBySavedSearchId(savedSearchId: string): Promise<readonly Opportunity[]> {
    try {
      const stmt = this.db.prepare<OpportunityRow, [string]>(
        `SELECT id, saved_search_id, observation_id, evaluation_id, novelty, created_at
         FROM opportunities
         WHERE saved_search_id = ?
         ORDER BY created_at ASC, id ASC`,
      );
      const rows = stmt.all(savedSearchId);
      return Promise.resolve(rows.map(rehydrateOpportunity));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listByRunId(runId: string): Promise<readonly Opportunity[]> {
    try {
      const stmt = this.db.prepare<OpportunityRow, [string]>(
        `SELECT o.id, o.saved_search_id, o.observation_id, o.evaluation_id, o.novelty, o.created_at
         FROM opportunities o
         JOIN observations obs ON o.observation_id = obs.id
         JOIN source_runs sr ON obs.source_run_id = sr.id
         WHERE sr.run_id = ?
         ORDER BY o.created_at ASC, o.id ASC`,
      );
      const rows = stmt.all(runId);
      return Promise.resolve(rows.map(rehydrateOpportunity));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(opportunity: Opportunity): Promise<void> {
    try {
      const existing = this.db
        .prepare<OpportunityRow, [string]>(
          `SELECT id, saved_search_id, observation_id, evaluation_id, novelty, created_at
         FROM opportunities
         WHERE id = ?`,
        )
        .get(opportunity.id);

      if (existing) {
        const existingRehydrated = rehydrateOpportunity(existing);
        const isIdentical =
          existingRehydrated.id === opportunity.id &&
          existingRehydrated.savedSearchId === opportunity.savedSearchId &&
          existingRehydrated.observationId === opportunity.observationId &&
          existingRehydrated.evaluationId === opportunity.evaluationId &&
          existingRehydrated.novelty === opportunity.novelty &&
          existingRehydrated.createdAt.getTime() === opportunity.createdAt.getTime();

        if (isIdentical) {
          return Promise.resolve();
        }

        throw new OpportunityIdentityCollisionError({ opportunityId: opportunity.id });
      }

      const stmt = this.db.prepare(
        `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );

      stmt.run(
        opportunity.id,
        opportunity.savedSearchId,
        opportunity.observationId,
        opportunity.evaluationId,
        opportunity.novelty,
        opportunity.createdAt.toISOString(),
      );

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
