import { type ExecutionLockHandle, type ExecutionLockPort } from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import { ExecutionLockHeldError, ExecutionLockReleaseError } from '../errors/storage-errors.js';
import { sanitizeObject } from '../sanitization/sanitizer.js';

interface ExecutionLockRow {
  readonly lock_key: string;
  readonly holder_id: string;
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

      const handle = this.db.transaction((tx) => {
        const selectStmt = tx.prepare<ExecutionLockRow, [string]>(
          `SELECT lock_key, holder_id, acquired_at, metadata
           FROM execution_lock
           WHERE lock_key = ?`,
        );
        const existing = selectStmt.get(DEFAULT_LOCK_KEY);

        if (existing) {
          if (existing.holder_id === cleanHolderId) {
            const acquiredAt = new Date(existing.acquired_at);
            return {
              holderId: cleanHolderId,
              acquiredAt,
              release: () => this.release(cleanHolderId),
            };
          }

          const acquiredAt = new Date(existing.acquired_at);
          throw new ExecutionLockHeldError({
            holderId: existing.holder_id,
            acquiredAt,
          });
        }

        const acquiredAt = new Date();
        const acquiredAtIso = acquiredAt.toISOString();
        const metadataJson = metadata ? JSON.stringify(sanitizeObject(metadata)) : null;

        const insertStmt = tx.prepare(
          `INSERT INTO execution_lock (lock_key, holder_id, acquired_at, metadata)
           VALUES (?, ?, ?, ?)`,
        );
        insertStmt.run(DEFAULT_LOCK_KEY, cleanHolderId, acquiredAtIso, metadataJson);

        return {
          holderId: cleanHolderId,
          acquiredAt,
          release: () => this.release(cleanHolderId),
        };
      });

      return Promise.resolve(handle);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  release(holderId: string): Promise<void> {
    try {
      if (typeof holderId !== 'string' || holderId.trim().length === 0) {
        throw new Error('holderId must be a non-empty string');
      }
      const cleanHolderId = holderId.trim();

      this.db.transaction((tx) => {
        const selectStmt = tx.prepare<ExecutionLockRow, [string]>(
          `SELECT lock_key, holder_id, acquired_at, metadata
           FROM execution_lock
           WHERE lock_key = ?`,
        );
        const existing = selectStmt.get(DEFAULT_LOCK_KEY);

        if (!existing) {
          // Idempotent: lock is already released
          return;
        }

        if (existing.holder_id !== cleanHolderId) {
          throw new ExecutionLockReleaseError(
            `Cannot release execution lock held by '${existing.holder_id}' from holder '${cleanHolderId}'`,
          );
        }

        const deleteStmt = tx.prepare(
          `DELETE FROM execution_lock
           WHERE lock_key = ? AND holder_id = ?`,
        );
        deleteStmt.run(DEFAULT_LOCK_KEY, cleanHolderId);
      });

      return Promise.resolve();
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

  getHolder(): Promise<ExecutionLockHandle | null> {
    try {
      const stmt = this.db.prepare<ExecutionLockRow, [string]>(
        `SELECT lock_key, holder_id, acquired_at, metadata
         FROM execution_lock
         WHERE lock_key = ?`,
      );
      const row = stmt.get(DEFAULT_LOCK_KEY);
      if (!row) {
        return Promise.resolve(null);
      }

      const acquiredAt = new Date(row.acquired_at);
      const holderId = row.holder_id;

      return Promise.resolve({
        holderId,
        acquiredAt,
        release: () => this.release(holderId),
      });
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
