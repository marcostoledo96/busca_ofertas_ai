import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  openSqliteDatabase,
  SqliteExecutionLock,
  ExecutionLockHeldError,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteExecutionLock (BOAI-011 / Finding 1)', () => {
  it('prevents concurrent execution across two separate DB connection handles to the same file', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const lock1 = new SqliteExecutionLock(db1);

      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const lock2 = new SqliteExecutionLock(db2);

      // Handle 1 acquires lock
      const handle1 = await lock1.acquire('runner-process-1', { pid: 1001 });
      expect(handle1.holderId).toBe('runner-process-1');
      expect(await lock1.isHeld()).toBe(true);
      expect(await lock2.isHeld()).toBe(true);

      // Handle 2 attempts to acquire lock and must produce ExecutionLockHeldError (no generic UNIQUE/SQLITE_BUSY leak)
      await expect(lock2.acquire('runner-process-2', { pid: 1002 })).rejects.toThrow(
        ExecutionLockHeldError,
      );

      try {
        await lock2.acquire('runner-process-2');
        expect.unreachable('Should have thrown ExecutionLockHeldError');
      } catch (err) {
        expect(err).toBeInstanceOf(ExecutionLockHeldError);
        if (err instanceof ExecutionLockHeldError) {
          expect(err.code).toBe('EXECUTION_LOCK_HELD');
          expect(err.holderId).toBe('runner-process-1');
          expect(err.acquiredAt).toBeInstanceOf(Date);
        }
      }

      // Handle 1 releases lock
      await handle1.release();
      expect(await lock1.isHeld()).toBe(false);
      expect(await lock2.isHeld()).toBe(false);

      // Handle 2 can now acquire lock successfully
      const handle2 = await lock2.acquire('runner-process-2');
      expect(handle2.holderId).toBe('runner-process-2');
      expect(await lock2.isHeld()).toBe(true);

      await handle2.release();
      expect(await lock2.isHeld()).toBe(false);

      db1.close();
      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('getHolder returns read-only info and does not expose release capability or token', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      const handle = await lock.acquire('legitimate-owner');
      const info = await lock.getHolder();

      expect(info).not.toBeNull();
      expect(info?.holderId).toBe('legitimate-owner');
      expect(info?.acquiredAt).toBeInstanceOf(Date);

      // Verify that info does NOT have a release method (read-only)
      expect('release' in (info ?? {})).toBe(false);
      expect('lock_token' in (info ?? {})).toBe(false);

      await handle.release();
    });
  });

  it('knowledge of holderId alone cannot reacquire release authority while held', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      const handle = await lock.acquire('holder-alpha');
      expect(handle.holderId).toBe('holder-alpha');

      // Second acquisition attempt even by the same holderId MUST fail with ExecutionLockHeldError
      await expect(lock.acquire('holder-alpha')).rejects.toThrow(ExecutionLockHeldError);

      try {
        await lock.acquire('holder-alpha');
      } catch (err) {
        expect(err).toBeInstanceOf(ExecutionLockHeldError);
        if (err instanceof ExecutionLockHeldError) {
          expect(err.holderId).toBe('holder-alpha');
        }
      }

      await handle.release();
      expect(await lock.isHeld()).toBe(false);
    });
  });

  it('release remains idempotent for the real owner handle', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      const handle = await lock.acquire('holder-1');
      await handle.release();
      expect(await lock.isHeld()).toBe(false);

      // Calling release a second or third time is an idempotent safe no-op
      await expect(handle.release()).resolves.toBeUndefined();
      await expect(handle.release()).resolves.toBeUndefined();
    });
  });

  it('stale owner handle cannot release a newer acquisition by another holder', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      // 1. Process 1 acquires lock
      const handle1 = await lock.acquire('process-1');
      await handle1.release();
      expect(await lock.isHeld()).toBe(false);

      // 2. Process 2 acquires lock with a fresh token
      const handle2 = await lock.acquire('process-2');
      expect(await lock.isHeld()).toBe(true);

      // 3. Stale handle from Process 1 attempts to release
      await handle1.release();

      // 4. Lock MUST STILL BE HELD by Process 2!
      expect(await lock.isHeld()).toBe(true);
      const currentHolder = await lock.getHolder();
      expect(currentHolder?.holderId).toBe('process-2');

      // 5. Only handle2 can release the newer acquisition
      await handle2.release();
      expect(await lock.isHeld()).toBe(false);
    });
  });

  it('enforces singleton lock_key = "EXECUTION_LOCK" constraint in SQLite schema', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Attempt direct SQL insertion with an arbitrary lock_key should fail CHECK constraint
      expect(() => {
        db.prepare(
          `INSERT INTO execution_lock (lock_key, holder_id, lock_token, acquired_at)
           VALUES (?, ?, ?, ?)`,
        ).run('ARBITRARY_LOCK_KEY', 'h1', 'token-1', new Date().toISOString());
      }).toThrow(/CHECK constraint failed/);

      // Insertion with 'EXECUTION_LOCK' succeeds
      expect(() => {
        db.prepare(
          `INSERT INTO execution_lock (lock_key, holder_id, lock_token, acquired_at)
           VALUES (?, ?, ?, ?)`,
        ).run('EXECUTION_LOCK', 'h1', 'token-1', new Date().toISOString());
      }).not.toThrow();
    });
  });

  it('withExecutionLock guarantees release on success, synchronous throw, and rejected promise', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      // 1. Success case
      const result = await lock.withExecutionLock('holder-success', async () => {
        expect(await lock.isHeld()).toBe(true);
        return 42;
      });
      expect(result).toBe(42);
      expect(await lock.isHeld()).toBe(false);

      // 2. Synchronous throw inside callback
      await expect(
        lock.withExecutionLock('holder-throw', async () => {
          expect(await lock.isHeld()).toBe(true);
          throw new Error('Simulation crash');
        }),
      ).rejects.toThrow('Simulation crash');
      expect(await lock.isHeld()).toBe(false);

      // 3. Rejected promise inside callback
      await expect(
        lock.withExecutionLock('holder-rejection', async () => {
          expect(await lock.isHeld()).toBe(true);
          return Promise.reject(new Error('Async simulation failure'));
        }),
      ).rejects.toThrow('Async simulation failure');
      expect(await lock.isHeld()).toBe(false);
    });
  });

  it('handles multi-process contention safely on the same SQLite database file', async () => {
    const ctx = createTempDatabaseContext();
    try {
      const db = openSqliteDatabase({ databasePath: ctx.databasePath });
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      // Acquire lock in parent process
      const handle = await lock.acquire('parent-process');
      expect(await lock.isHeld()).toBe(true);

      // Spawn child process attempting to acquire the lock on the same database file
      const script = `
        import { openSqliteDatabase, SqliteExecutionLock, ExecutionLockHeldError } from './packages/storage-sqlite/dist/index.js';
        const db = openSqliteDatabase({ databasePath: ${JSON.stringify(ctx.databasePath)} });
        const childLock = new SqliteExecutionLock(db);
        try {
          await childLock.acquire('child-process');
          process.exit(0);
        } catch (err) {
          if (err instanceof ExecutionLockHeldError && err.holderId === 'parent-process') {
            process.exit(42); // expected code: ExecutionLockHeldError with parent holder
          }
          console.error(err);
          process.exit(1);
        }
      `;

      const result = spawnSync('node', ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });

      expect(result.status).toBe(42);

      // Release in parent
      await handle.release();
      expect(await lock.isHeld()).toBe(false);

      db.close();
    } finally {
      ctx.cleanup();
    }
  });
});
