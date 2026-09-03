import { describe, it, expect } from 'vitest';
import { createEvaluation, createEvaluationReason } from '@busca-ofertas-ai/core';
import {
  SqliteEvaluationRepository,
  EvaluationIdentityCollisionError,
  StorageCorruptionError,
} from '@busca-ofertas-ai/storage-sqlite';
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteEvaluationRepository (BOAI-015)', () => {
  it('saves and retrieves an evaluation with complete reasons and evaluators', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteEvaluationRepository(db);

      const eval1 = createEvaluation({
        id: 'eval-1',
        decision: 'REVIEW',
        score: 65,
        reasons: [
          createEvaluationReason({
            code: 'PRICE_AMBIGUOUS',
            message: 'Price is too low compared to market',
            severity: 'SOFT',
            impact: -35,
          }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1.0.0',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(eval1);

      const retrieved = await repo.getById('eval-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('eval-1');
      expect(retrieved?.decision).toBe('REVIEW');
      expect(retrieved?.score).toBe(65);
      expect(retrieved?.reasons.length).toBe(1);
      expect(retrieved?.reasons[0]?.code).toBe('PRICE_AMBIGUOUS');
      expect(retrieved?.evaluatedBy).toEqual(['RULES']);
      expect(retrieved?.policyVersion).toBe('v1.0.0');
      expect(retrieved?.createdAt.toISOString()).toBe('2026-09-03T12:00:00.000Z');
    });
  });

  it('performs idempotent save when identical evaluation is saved again', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteEvaluationRepository(db);

      const eval1 = createEvaluation({
        id: 'eval-1',
        decision: 'MATCH',
        score: 95,
        reasons: [
          createEvaluationReason({
            code: 'TITLE_MATCH',
            message: 'Strong title match',
            severity: 'INFO',
            impact: 0,
          }),
        ],
        evaluatedBy: ['RULES', 'AI'],
        policyVersion: 'v1.0.0',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(eval1);
      await expect(repo.save(eval1)).resolves.toBeUndefined();
    });
  });

  it('throws EvaluationIdentityCollisionError when saving evaluation with same id but different content', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteEvaluationRepository(db);

      const eval1 = createEvaluation({
        id: 'eval-1',
        decision: 'MATCH',
        score: 95,
        reasons: [
          createEvaluationReason({
            code: 'TITLE_MATCH',
            message: 'Match 1',
            severity: 'INFO',
            impact: 0,
          }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1.0.0',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      const evalConflicting = createEvaluation({
        id: 'eval-1',
        decision: 'REJECT',
        score: 10,
        reasons: [
          createEvaluationReason({
            code: 'TITLE_MISMATCH',
            message: 'Mismatch',
            severity: 'HARD',
            impact: -100,
          }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1.0.0',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      });

      await repo.save(eval1);
      await expect(repo.save(evalConflicting)).rejects.toThrow(EvaluationIdentityCollisionError);
    });
  });

  it('throws StorageCorruptionError on non-canonical UTC timestamp during rehydration', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteEvaluationRepository(db);

      // Directly insert row with non-canonical ISO string (missing milliseconds)
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-bad-time', 'MATCH', 90.0, '[{"code":"TITLE_MATCH","message":"m","severity":"INFO","impact":0}]', '["RULES"]', 'v1', '2026-09-03T12:00:00Z');`,
      ).run();

      await expect(repo.getById('eval-bad-time')).rejects.toThrow(StorageCorruptionError);
    });
  });

  it('throws StorageCorruptionError on corrupt JSON or empty reasons/evaluators during rehydration', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteEvaluationRepository(db);

      // Empty reasons array
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-empty-reasons', 'MATCH', 90.0, '[]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();
      await expect(repo.getById('eval-empty-reasons')).rejects.toThrow(StorageCorruptionError);

      // Empty evaluated_by array
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-empty-evaluators', 'MATCH', 90.0, '[{"code":"TITLE_MATCH","message":"m","severity":"INFO","impact":0}]', '[]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();
      await expect(repo.getById('eval-empty-evaluators')).rejects.toThrow(StorageCorruptionError);

      // Unknown evaluator
      db.prepare(
        `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
         VALUES ('eval-unknown-evaluator', 'MATCH', 90.0, '[{"code":"TITLE_MATCH","message":"m","severity":"INFO","impact":0}]', '["UNKNOWN_AGENT"]', 'v1', '2026-09-03T12:00:00.000Z');`,
      ).run();
      await expect(repo.getById('eval-unknown-evaluator')).rejects.toThrow(StorageCorruptionError);
    });
  });
});
