import { randomUUID } from 'node:crypto';
import {
  type ExecutionLockHandle,
  type ExecutionLockInfo,
  type ExecutionLockPort,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import { ExecutionLockHeldError } from '../errors/storage-errors.js';
import { sanitizeObject } from '../sanitization/sanitizer.js';

interface ExecutionLockRow {
  readonly lock_key: string;
  readonly holder_id: string;
  readonly lock_token: string;
  readonly acquired_at: string;
  readonly metadata: string | null;
}

const DEFAULT_LOCK_KEY = 'EXECUTION_LOCK' as const;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export class SqliteExecutionLock implements ExecutionLockPort {
  constructor(private readonly db: SqliteDatabase) {}

  acquire(holderId: string, metadata?: Record<string, unknown>): Promise<ExecutionLockHandle> {
    try {
      if (typeof holderId !== 'string' || holderId.trim().length === 0) {
        throw new Error('holderId must be a non-empty string');
      }
      const cleanHolderId = holderId.trim();
      const token = randomUUID();
      const acquiredAt = new Date();
      const acquiredAtIso = acquiredAt.toISOString();
      const metadataJson = metadata ? JSON.stringify(sanitizeObject(metadata)) : null;

      // Atomic acquisition using SQLite uniqueness authority
      const insertStmt = this.db.prepare(
        `INSERT INTO execution_lock (lock_key, holder_id, lock_token, acquired_at, metadata)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(lock_key) DO NOTHING`,
      );
      const result = insertStmt.run(
        DEFAULT_LOCK_KEY,
        cleanHolderId,
        token,
        acquiredAtIso,
        metadataJson,
      );

      if (result.changes === 0) {
        // Lock is already held: inspect current holder to provide typed error details
        const selectStmt = this.db.prepare<{ holder_id: string; acquired_at: string }, [string]>(
          `SELECT holder_id, acquired_at
           FROM execution_lock
           WHERE lock_key = ?`,
        );
        const current = selectStmt.get(DEFAULT_LOCK_KEY);
        const currentHolderId = current?.holder_id ?? 'unknown';
        const currentAcquiredAt = current ? new Date(current.acquired_at) : new Date();

        throw new ExecutionLockHeldError({
          holderId: currentHolderId,
          acquiredAt: currentAcquiredAt,
        });
      }

      // Lock successfully acquired. The release capability is bound strictly to the private token.
      let isReleased = false;

      const handle: ExecutionLockHandle = {
        holderId: cleanHolderId,
        acquiredAt,
        release: () => {
          if (isReleased) {
            return Promise.resolve();
          }
          try {
            const deleteStmt = this.db.prepare(
              `DELETE FROM execution_lock
               WHERE lock_key = ? AND lock_token = ?`,
            );
            deleteStmt.run(DEFAULT_LOCK_KEY, token);
            isReleased = true;
            return Promise.resolve();
          } catch (err) {
            return Promise.reject(toError(err));
          }
        },
      };

      return Promise.resolve(handle);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  isHeld(): Promise<boolean> {
    try {
      const stmt = this.db.prepare<{ lock_key: string }, [string]>(
        `SELECT lock_key FROM execution_lock WHERE lock_key = ?`,
      );
      const row = stmt.get(DEFAULT_LOCK_KEY);
      return Promise.resolve(Boolean(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  getHolder(): Promise<ExecutionLockInfo | null> {
    try {
      const stmt = this.db.prepare<ExecutionLockRow, [string]>(
        `SELECT lock_key, holder_id, lock_token, acquired_at, metadata
         FROM execution_lock
         WHERE lock_key = ?`,
      );
      const row = stmt.get(DEFAULT_LOCK_KEY);
      if (!row) {
        return Promise.resolve(null);
      }

      const acquiredAt = new Date(row.acquired_at);
      const holderId = row.holder_id;

      // Returns read-only lock info. Does NOT expose lock_token or release capability.
      const info: ExecutionLockInfo = {
        holderId,
        acquiredAt,
      };

      return Promise.resolve(info);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  async withExecutionLock<T>(
    holderId: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const handle = await this.acquire(holderId, metadata);
    try {
      return await fn();
    } finally {
      await handle.release();
    }
  }
}
