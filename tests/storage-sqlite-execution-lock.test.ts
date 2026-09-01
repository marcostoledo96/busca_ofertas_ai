import { describe, it, expect } from 'vitest';
import {
  openSqliteDatabase,
  SqliteExecutionLock,
  ExecutionLockHeldError,
  ExecutionLockReleaseError,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteExecutionLock (BOAI-011)', () => {
  it('prevents concurrent execution across two separate DB connection handles to the same file', async () => {
    const ctx = createTempDatabaseContext();
    try {
      // 1. Initialize DB and migrate
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const lock1 = new SqliteExecutionLock(db1);

      // 2. Open second distinct DB handle to same SQLite file
      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const lock2 = new SqliteExecutionLock(db2);

      // Handle 1 acquires lock
      const handle1 = await lock1.acquire('runner-process-1', { pid: 1001 });
      expect(handle1.holderId).toBe('runner-process-1');
      expect(await lock1.isHeld()).toBe(true);
      expect(await lock2.isHeld()).toBe(true);

      // Handle 2 attempts to acquire lock and must be rejected with typed error
      await expect(lock2.acquire('runner-process-2', { pid: 1002 })).rejects.toThrow(
        ExecutionLockHeldError,
      );

      try {
        await lock2.acquire('runner-process-2');
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

  it('allows idempotent re-acquisition by the same holder', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      const handleA = await lock.acquire('holder-alpha');
      expect(handleA.holderId).toBe('holder-alpha');

      // Second acquisition by same holder returns handle without error
      const handleB = await lock.acquire('holder-alpha');
      expect(handleB.holderId).toBe('holder-alpha');

      await handleB.release();
      expect(await lock.isHeld()).toBe(false);
    });
  });

  it('allows safe idempotent release when lock is not held', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      // Release when no lock is held should not throw
      await expect(lock.release('any-holder')).resolves.toBeUndefined();

      const handle = await lock.acquire('holder-1');
      await handle.release();
      // Second release call is a safe no-op
      await expect(handle.release()).resolves.toBeUndefined();
    });
  });

  it('prevents a holder from releasing a lock held by a different holder', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const lock = new SqliteExecutionLock(db);

      await lock.acquire('holder-legitimate');

      // Imposter tries to release lock
      await expect(lock.release('holder-imposter')).rejects.toThrow(ExecutionLockReleaseError);

      try {
        await lock.release('holder-imposter');
      } catch (err) {
        expect(err).toBeInstanceOf(ExecutionLockReleaseError);
        if (err instanceof ExecutionLockReleaseError) {
          expect(err.code).toBe('EXECUTION_LOCK_RELEASE_FAILED');
          expect(err.message).toContain('holder-legitimate');
          expect(err.message).toContain('holder-imposter');
        }
      }

      // Lock is still held by original holder
      expect(await lock.isHeld()).toBe(true);
      const currentHolder = await lock.getHolder();
      expect(currentHolder?.holderId).toBe('holder-legitimate');

      await lock.release('holder-legitimate');
      expect(await lock.isHeld()).toBe(false);
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
          throw new Error('Async simulation failure');
        }),
      ).rejects.toThrow('Async simulation failure');
      expect(await lock.isHeld()).toBe(false);
    });
  });
});
