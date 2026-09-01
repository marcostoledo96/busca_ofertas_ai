import { describe, it, expect } from 'vitest';
import {
  openSqliteDatabase,
  MigrationFailedError,
  TransactionAsyncCallbackUnsupportedError,
  TransactionFailedError,
  TransactionScopeClosedError,
  SCHEMA_MIGRATIONS_TABLE_NAME,
  type Migration,
  type SqlitePreparedStatement,
  type SqliteTransaction,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SQLite Transactions & Failure Atomicity (BOAI-010)', () => {
  it('commits changes on successful transaction completion', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_tx (id INT PRIMARY KEY, name TEXT);');

      const result = db.transaction((tx) => {
        const stmt = tx.prepare('INSERT INTO test_tx (id, name) VALUES (?, ?);');
        stmt.run(1, 'Alice');
        stmt.run(2, 'Bob');
        return 'success_payload';
      });

      expect(result).toBe('success_payload');

      const rows = db
        .prepare<{ id: number; name: string }, []>('SELECT * FROM test_tx ORDER BY id ASC;')
        .all();
      expect(rows).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });
  });

  it('rolls back changes when an exception is thrown inside a transaction', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_tx_rollback (id INT PRIMARY KEY, name TEXT);');
      db.prepare('INSERT INTO test_tx_rollback VALUES (?, ?)').run(1, 'Initial');

      expect(() => {
        db.transaction((tx) => {
          tx.prepare('INSERT INTO test_tx_rollback VALUES (?, ?)').run(2, 'Second');
          tx.prepare('INSERT INTO test_tx_rollback VALUES (?, ?)').run(1, 'Duplicate Primary Key'); // Will throw
        });
      }).toThrow(TransactionFailedError);

      const rows = db
        .prepare<{ id: number; name: string }, []>('SELECT * FROM test_tx_rollback;')
        .all();
      expect(rows).toEqual([{ id: 1, name: 'Initial' }]);
    });
  });

  it('rejects async transaction callbacks and rolls back without committing', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_async_tx (id INT PRIMARY KEY, name TEXT);');

      const asyncCallback1: (tx: SqliteTransaction) => string = (tx) => {
        tx.prepare('INSERT INTO test_async_tx VALUES (?, ?)').run(1, 'Premature Async');
        return Promise.resolve('async_result') as unknown as string;
      };

      // Async callback returning a Promise must be rejected synchronously
      expect(() => {
        db.transaction(asyncCallback1);
      }).toThrow(TransactionAsyncCallbackUnsupportedError);

      const asyncCallback2: (tx: SqliteTransaction) => void = (tx) => {
        tx.prepare('INSERT INTO test_async_tx VALUES (?, ?)').run(2, 'Second Async');
        return Promise.resolve() as unknown as void;
      };

      try {
        db.transaction(asyncCallback2);
      } catch (err) {
        expect(err).toBeInstanceOf(TransactionAsyncCallbackUnsupportedError);
        if (err instanceof TransactionAsyncCallbackUnsupportedError) {
          expect(err.code).toBe('TRANSACTION_ASYNC_CALLBACK_UNSUPPORTED');
        }
      }

      // Assert that NO rows were committed
      const rows = db
        .prepare<{ id: number; name: string }, []>('SELECT * FROM test_async_tx;')
        .all();
      expect(rows).toEqual([]);

      // Assert DB remains open and usable
      expect(db.isOpen).toBe(true);
      db.transaction((tx) => {
        tx.prepare('INSERT INTO test_async_tx VALUES (?, ?)').run(10, 'Valid Sync');
      });
      const finalRows = db
        .prepare<{ id: number; name: string }, []>('SELECT * FROM test_async_tx;')
        .all();
      expect(finalRows).toEqual([{ id: 10, name: 'Valid Sync' }]);
    });
  });

  it('invalidates escaped SqliteTransaction handle after commit and rollback', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_escaped_tx (id INT PRIMARY KEY, name TEXT);');

      // 1. Escaped tx after COMMIT
      let escapedTxAfterCommit: SqliteTransaction | null = null;
      db.transaction((tx) => {
        tx.prepare('INSERT INTO test_escaped_tx VALUES (?, ?)').run(1, 'Committed');
        escapedTxAfterCommit = tx;
      });

      expect(escapedTxAfterCommit).not.toBeNull();
      const committedTx = escapedTxAfterCommit!;

      expect(() => committedTx.exec('INSERT INTO test_escaped_tx VALUES (2, "Late");')).toThrow(
        TransactionScopeClosedError,
      );
      expect(() => committedTx.prepare('SELECT 1;')).toThrow(TransactionScopeClosedError);

      // 2. Escaped tx after ROLLBACK
      let escapedTxAfterRollback: SqliteTransaction | null = null;
      try {
        db.transaction((tx) => {
          escapedTxAfterRollback = tx;
          throw new Error('Forced rollback');
        });
      } catch {
        // expected rollback
      }

      expect(escapedTxAfterRollback).not.toBeNull();
      const rolledBackTx = escapedTxAfterRollback!;

      expect(() => rolledBackTx.exec('INSERT INTO test_escaped_tx VALUES (3, "Late 2");')).toThrow(
        TransactionScopeClosedError,
      );
      expect(() => rolledBackTx.prepare('SELECT 1;')).toThrow(TransactionScopeClosedError);
    });
  });

  it('invalidates prepared statements created within transaction scope after transaction ends', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_escaped_stmt (id INT PRIMARY KEY, name TEXT);');

      let escapedStmtAfterCommit: SqlitePreparedStatement | null = null;
      db.transaction((tx) => {
        escapedStmtAfterCommit = tx.prepare('INSERT INTO test_escaped_stmt VALUES (?, ?);');
        escapedStmtAfterCommit.run(1, 'Inside Tx');
      });

      expect(escapedStmtAfterCommit).not.toBeNull();
      const stmtCommit = escapedStmtAfterCommit!;

      // Calling statement after commit must fail with TransactionScopeClosedError
      expect(() => stmtCommit.run(2, 'Outside Tx')).toThrow(TransactionScopeClosedError);
      expect(() => stmtCommit.get(1)).toThrow(TransactionScopeClosedError);
      expect(() => stmtCommit.all()).toThrow(TransactionScopeClosedError);

      let escapedStmtAfterRollback: SqlitePreparedStatement | null = null;
      try {
        db.transaction((tx) => {
          escapedStmtAfterRollback = tx.prepare('INSERT INTO test_escaped_stmt VALUES (?, ?);');
          throw new Error('Forced rollback');
        });
      } catch {
        // expected
      }

      expect(escapedStmtAfterRollback).not.toBeNull();
      const stmtRollback = escapedStmtAfterRollback!;
      expect(() => stmtRollback.run(3, 'Outside Tx 2')).toThrow(TransactionScopeClosedError);
      expect(() => stmtRollback.get(1)).toThrow(TransactionScopeClosedError);
      expect(() => stmtRollback.all()).toThrow(TransactionScopeClosedError);

      // Verify that statements created outside transaction continue working normally
      const dbStmt = db.prepare<{ id: number; name: string }, [number]>(
        'SELECT * FROM test_escaped_stmt WHERE id = ?;',
      );
      const row = dbStmt.get(1);
      expect(row).toEqual({ id: 1, name: 'Inside Tx' });
    });
  });

  it('resets internal wrapper state on BEGIN failure so subsequent transactions work', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_begin_state (id INT PRIMARY KEY);');

      // Start an external transaction via raw SQL so internal BEGIN fails
      db.exec('BEGIN');

      // Attempting db.transaction will fail because SQLite does not allow BEGIN inside active transaction
      expect(() => {
        db.transaction((tx) => {
          tx.exec('INSERT INTO test_begin_state VALUES (1);');
        });
      }).toThrow(TransactionFailedError);

      // Rollback external transaction
      db.exec('ROLLBACK');

      // Now db.transaction should work cleanly without being stuck in inTransaction state
      expect(() => {
        db.transaction((tx) => {
          tx.exec('INSERT INTO test_begin_state VALUES (10);');
        });
      }).not.toThrow();

      const row = db.prepare<{ id: number }, []>('SELECT * FROM test_begin_state;').get();
      expect(row).toEqual({ id: 10 });
    });
  });

  it('rejects nested transactions with TRANSACTION_ALREADY_ACTIVE error', () => {
    withTempDatabase((db) => {
      expect(() => {
        db.transaction(() => {
          db.transaction(() => {
            // Nested transaction
          });
        });
      }).toThrow(TransactionFailedError);

      try {
        db.transaction(() => {
          db.transaction(() => {});
        });
      } catch (err) {
        expect(err).toBeInstanceOf(TransactionFailedError);
        if (err instanceof TransactionFailedError) {
          expect(err.code).toBe('TRANSACTION_ALREADY_ACTIVE');
        }
      }
    });
  });

  it('ensures migration failure atomicity: rolls back DDL and records 0 rows for failed migration', () => {
    const ctx = createTempDatabaseContext();
    try {
      // Manifest where migration 1 is valid schema_migrations, and migration 2 fails halfway
      const faultyMigrations: readonly Migration[] = [
        {
          version: 1,
          name: '001_create_schema_migrations',
          up: (tx) => {
            tx.exec(`
              CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE_NAME} (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
              );
            `);
          },
        },
        {
          version: 2,
          name: '002_faulty_partial_migration',
          up: (tx) => {
            // Valid DDL
            tx.exec('CREATE TABLE partial_table_should_be_rolled_back (id INT PRIMARY KEY);');
            // Invalid SQL to trigger failure
            tx.exec('SYNTAX ERROR INVALID SQL STATEMENT THAT CANNOT EXECUTE');
          },
        },
      ];

      const db = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: faultyMigrations,
      });

      // Migration must throw MigrationFailedError
      expect(() => db.migrate()).toThrow(MigrationFailedError);

      // Verify state after failure:
      // 1. Current schema version is still 1 (v1 succeeded then v2 failed)
      expect(db.getCurrentSchemaVersion()).toBe(1);

      // 2. schema_migrations has ONLY version 1 recorded
      const applied = db.getAppliedMigrations();
      expect(applied.map((a) => a.version)).toEqual([1]);

      // 3. The DDL from migration 2 was rolled back (partial table does not exist)
      const tableCheck = db
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('partial_table_should_be_rolled_back');
      expect(tableCheck).toBeUndefined();

      db.close();

      // Now run with a corrected migration 2
      const fixedMigrations: readonly Migration[] = [
        faultyMigrations[0]!,
        {
          version: 2,
          name: '002_faulty_partial_migration',
          up: (tx) => {
            tx.exec('CREATE TABLE partial_table_should_be_rolled_back (id INT PRIMARY KEY);');
          },
        },
      ];

      const fixedDb = openSqliteDatabase({
        databasePath: ctx.databasePath,
        customMigrations: fixedMigrations,
      });

      const fixedResult = fixedDb.migrate();
      expect(fixedResult.previousVersion).toBe(1);
      expect(fixedResult.currentVersion).toBe(2);
      expect(fixedResult.newlyAppliedCount).toBe(1);
      expect(fixedDb.getCurrentSchemaVersion()).toBe(2);

      const createdTableCheck = fixedDb
        .prepare<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get('partial_table_should_be_rolled_back');
      expect(createdTableCheck).toBeDefined();

      fixedDb.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('keeps database handle usable and closable after a failed transaction', () => {
    withTempDatabase((db) => {
      db.exec('CREATE TABLE test_resilience (id INT PRIMARY KEY);');

      // Failed transaction
      expect(() => {
        db.transaction((tx) => {
          tx.exec('INVALID SQL');
        });
      }).toThrow(TransactionFailedError);

      // Database should still be open and usable
      expect(db.isOpen).toBe(true);
      expect(() => {
        db.exec('INSERT INTO test_resilience VALUES (1);');
      }).not.toThrow();

      const row = db.prepare<{ id: number }, []>('SELECT * FROM test_resilience;').get();
      expect(row).toEqual({ id: 1 });

      // And can close cleanly
      expect(() => db.close()).not.toThrow();
      expect(db.isOpen).toBe(false);
    });
  });
});
