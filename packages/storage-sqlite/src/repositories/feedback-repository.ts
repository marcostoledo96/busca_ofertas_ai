import {
  type Feedback,
  type FeedbackRepository,
  type FeedbackDecision,
  type FeedbackActor,
  createFeedback,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  FeedbackIdentityCollisionError,
  StorageCorruptionError,
} from '../errors/storage-errors.js';

interface FeedbackRow {
  readonly id: string;
  readonly opportunity_id: string;
  readonly previous_evaluation_id: string;
  readonly actor: string;
  readonly decision: string;
  readonly notes: string | null;
  readonly created_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const EXACT_CANONICAL_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string' || !EXACT_CANONICAL_UTC_REGEX.test(isoString)) {
    throw new StorageCorruptionError(
      `Corrupted persisted Feedback '${entityId}': '${fieldName}' must be a canonical ISO UTC date string in 'YYYY-MM-DDTHH:mm:ss.sssZ' format, got '${String(isoString)}'`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== isoString) {
    throw new StorageCorruptionError(
      `Corrupted persisted Feedback '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateFeedback(row: FeedbackRow): Feedback {
  try {
    const createdAt = parseIsoDate(row.created_at, 'created_at', row.id);

    return createFeedback({
      id: row.id,
      opportunityId: row.opportunity_id,
      previousEvaluationId: row.previous_evaluation_id,
      actor: row.actor as FeedbackActor,
      decision: row.decision as FeedbackDecision,
      ...(row.notes !== null ? { notes: row.notes } : {}),
      createdAt,
    });
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Feedback '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Feedback | null> {
    try {
      const stmt = this.db.prepare<FeedbackRow, [string]>(
        `SELECT id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at
         FROM feedback
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateFeedback(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listByOpportunityId(opportunityId: string): Promise<readonly Feedback[]> {
    try {
      const stmt = this.db.prepare<FeedbackRow, [string]>(
        `SELECT id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at
         FROM feedback
         WHERE opportunity_id = ?
         ORDER BY created_at ASC, id ASC`,
      );
      const rows = stmt.all(opportunityId);
      return Promise.resolve(rows.map(rehydrateFeedback));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(feedback: Feedback): Promise<void> {
    try {
      const existing = this.db
        .prepare<FeedbackRow, [string]>(
          `SELECT id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at
         FROM feedback
         WHERE id = ?`,
        )
        .get(feedback.id);

      if (existing) {
        const existingRehydrated = rehydrateFeedback(existing);
        const isIdentical =
          existingRehydrated.id === feedback.id &&
          existingRehydrated.opportunityId === feedback.opportunityId &&
          existingRehydrated.previousEvaluationId === feedback.previousEvaluationId &&
          existingRehydrated.actor === feedback.actor &&
          existingRehydrated.decision === feedback.decision &&
          (existingRehydrated.notes ?? null) === (feedback.notes ?? null) &&
          existingRehydrated.createdAt.getTime() === feedback.createdAt.getTime();

        if (isIdentical) {
          return Promise.resolve();
        }

        throw new FeedbackIdentityCollisionError({ feedbackId: feedback.id });
      }

      const stmt = this.db.prepare(
        `INSERT INTO feedback (id, opportunity_id, previous_evaluation_id, actor, decision, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      stmt.run(
        feedback.id,
        feedback.opportunityId,
        feedback.previousEvaluationId,
        feedback.actor,
        feedback.decision,
        feedback.notes ?? null,
        feedback.createdAt.toISOString(),
      );

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
