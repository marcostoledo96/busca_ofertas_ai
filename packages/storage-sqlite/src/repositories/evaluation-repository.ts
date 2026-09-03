import {
  type Evaluation,
  type EvaluationRepository,
  type EvaluationReason,
  type EvaluatorType,
  createEvaluation,
  createEvaluationReason,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  EvaluationIdentityCollisionError,
  StorageCorruptionError,
} from '../errors/storage-errors.js';

interface EvaluationRow {
  readonly id: string;
  readonly decision: string;
  readonly score: number;
  readonly reasons: string;
  readonly evaluated_by: string;
  readonly policy_version: string;
  readonly created_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const EXACT_CANONICAL_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string' || !EXACT_CANONICAL_UTC_REGEX.test(isoString)) {
    throw new StorageCorruptionError(
      `Corrupted persisted Evaluation '${entityId}': '${fieldName}' must be a canonical ISO UTC date string in 'YYYY-MM-DDTHH:mm:ss.sssZ' format, got '${String(isoString)}'`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== isoString) {
    throw new StorageCorruptionError(
      `Corrupted persisted Evaluation '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateEvaluation(row: EvaluationRow): Evaluation {
  try {
    const createdAt = parseIsoDate(row.created_at, 'created_at', row.id);

    let rawReasons: unknown;
    try {
      rawReasons = JSON.parse(row.reasons);
    } catch (e) {
      throw new StorageCorruptionError(
        `Corrupted persisted Evaluation '${row.id}': reasons JSON is invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!Array.isArray(rawReasons) || rawReasons.length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted Evaluation '${row.id}': reasons must be a non-empty array, got ${JSON.stringify(rawReasons)}`,
      );
    }

    const reasons: EvaluationReason[] = rawReasons.map((r, idx) => {
      if (typeof r !== 'object' || r === null) {
        throw new StorageCorruptionError(
          `Corrupted persisted Evaluation '${row.id}': reason at index ${idx} is not an object`,
        );
      }
      const rawObj = r as {
        readonly code?: unknown;
        readonly message?: unknown;
        readonly impact?: unknown;
        readonly severity?: unknown;
        readonly evidence?: unknown;
      };
      return createEvaluationReason({
        code: typeof rawObj.code === 'string' ? rawObj.code : '',
        message: typeof rawObj.message === 'string' ? rawObj.message : '',
        impact: typeof rawObj.impact === 'number' ? rawObj.impact : 0,
        severity: rawObj.severity as 'INFO' | 'SOFT' | 'HARD',
        ...(typeof rawObj.evidence === 'string' ? { evidence: rawObj.evidence } : {}),
      });
    });

    let rawEvaluatedBy: unknown;
    try {
      rawEvaluatedBy = JSON.parse(row.evaluated_by);
    } catch (e) {
      throw new StorageCorruptionError(
        `Corrupted persisted Evaluation '${row.id}': evaluated_by JSON is invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!Array.isArray(rawEvaluatedBy) || rawEvaluatedBy.length === 0) {
      throw new StorageCorruptionError(
        `Corrupted persisted Evaluation '${row.id}': evaluated_by must be a non-empty array, got ${JSON.stringify(rawEvaluatedBy)}`,
      );
    }

    for (const ev of rawEvaluatedBy as unknown[]) {
      if (typeof ev !== 'string' || (ev !== 'RULES' && ev !== 'AI' && ev !== 'USER')) {
        throw new StorageCorruptionError(
          `Corrupted persisted Evaluation '${row.id}': invalid evaluator '${String(ev)}'`,
        );
      }
    }

    const evaluatedBy = rawEvaluatedBy as readonly EvaluatorType[];

    return createEvaluation({
      id: row.id,
      decision: row.decision as 'MATCH' | 'REVIEW' | 'REJECT',
      score: row.score,
      reasons,
      evaluatedBy,
      policyVersion: row.policy_version,
      createdAt,
    });
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Evaluation '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Evaluation | null> {
    try {
      const stmt = this.db.prepare<EvaluationRow, [string]>(
        `SELECT id, decision, score, reasons, evaluated_by, policy_version, created_at
         FROM evaluations
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateEvaluation(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(evaluation: Evaluation): Promise<void> {
    try {
      const existing = this.db
        .prepare<EvaluationRow, [string]>(
          `SELECT id, decision, score, reasons, evaluated_by, policy_version, created_at
         FROM evaluations
         WHERE id = ?`,
        )
        .get(evaluation.id);

      if (existing) {
        const existingRehydrated = rehydrateEvaluation(existing);
        const isIdentical =
          existingRehydrated.id === evaluation.id &&
          existingRehydrated.decision === evaluation.decision &&
          Math.abs(existingRehydrated.score - evaluation.score) < 0.0001 &&
          existingRehydrated.policyVersion === evaluation.policyVersion &&
          existingRehydrated.createdAt.getTime() === evaluation.createdAt.getTime() &&
          JSON.stringify(existingRehydrated.evaluatedBy) ===
            JSON.stringify(evaluation.evaluatedBy) &&
          JSON.stringify(existingRehydrated.reasons) === JSON.stringify(evaluation.reasons);

        if (isIdentical) {
          return Promise.resolve();
        }

        throw new EvaluationIdentityCollisionError({ evaluationId: evaluation.id });
      }

      const stmt = this.db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      stmt.run(
        evaluation.id,
        evaluation.decision,
        evaluation.score,
        JSON.stringify(evaluation.reasons),
        JSON.stringify(evaluation.evaluatedBy),
        evaluation.policyVersion,
        evaluation.createdAt.toISOString(),
      );

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
