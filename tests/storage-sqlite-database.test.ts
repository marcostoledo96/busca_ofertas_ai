import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  openSqliteDatabase,
  DatabaseClosedError,
  InvalidDatabasePathError,
  type SqliteDatabase,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SQLite Database Lifecycle & Configuration (BOAI-010)', () => {
  it('opens a temporary database file and reports open state', () => {
    withTempDatabase((db, ctx) => {
      expect(db.isOpen).toBe(true);
      expect(db.databasePath).toBe(ctx.databasePath);
      expect(fs.existsSync(ctx.databasePath)).toBe(true);
    });
  });

  it('rejects invalid or directory paths', () => {
    // Empty path
    expect(() => openSqliteDatabase({ databasePath: '' })).toThrow(InvalidDatabasePathError);
    expect(() => openSqliteDatabase({ databasePath: '   ' })).toThrow(InvalidDatabasePathError);

    // Existing directory as database path
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-test-dir-'));
    try {
      expect(() => openSqliteDatabase({ databasePath: tempDir })).toThrow(InvalidDatabasePathError);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates parent directory with restrictive POSIX permissions if missing', () => {
    const parentDir = path.join(
      os.tmpdir(),
      `boai-nested-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'nested-storage',
    );
    const dbPath = path.join(parentDir, 'sub-db.sqlite');

    expect(fs.existsSync(parentDir)).toBe(false);

    const db = openSqliteDatabase({ databasePath: dbPath, createParentDirectory: true });
    try {
      expect(fs.existsSync(parentDir)).toBe(true);
      expect(fs.existsSync(dbPath)).toBe(true);

      // Verify POSIX mode on Unix platforms
      if (process.platform !== 'win32') {
        const stat = fs.statSync(parentDir);
        // 0o700 in octal is 448 in decimal (rwx------)
        expect(stat.mode & 0o777).toBe(0o700);
      }
    } finally {
      db.close();
      fs.rmSync(path.dirname(parentDir), { recursive: true, force: true });
    }
  });

  it('enforces PRAGMA foreign_keys = ON on connection', () => {
    withTempDatabase((db) => {
      const row = db.prepare<Record<string, unknown>>('PRAGMA foreign_keys;').get();
      expect(row).toBeDefined();
      expect(row!['foreign_keys']).toBe(1);
    });
  });

  it('enforces real foreign key constraints against violation', () => {
    withTempDatabase((db) => {
      db.exec(`
        CREATE TABLE test_parent (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        CREATE TABLE test_child (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER NOT NULL REFERENCES test_parent(id)
        );
      `);

      // Valid insert
      db.prepare('INSERT INTO test_parent (id, name) VALUES (?, ?)').run(1, 'Parent 1');
      expect(() => {
        db.prepare('INSERT INTO test_child (id, parent_id) VALUES (?, ?)').run(10, 1);
      }).not.toThrow();

      // Invalid insert referencing non-existent parent_id 999
      expect(() => {
        db.prepare('INSERT INTO test_child (id, parent_id) VALUES (?, ?)').run(20, 999);
      }).toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  it('handles close idempotently and throws DatabaseClosedError on post-close operations', () => {
    const ctx = createTempDatabaseContext();
    let db: SqliteDatabase | null = null;
    try {
      db = openSqliteDatabase({ databasePath: ctx.databasePath });
      const closedDb = db;
      expect(closedDb.isOpen).toBe(true);

      const stmt = closedDb.prepare('SELECT 1 as num;');
      expect(stmt.get()).toEqual({ num: 1 });

      // First close
      closedDb.close();
      expect(closedDb.isOpen).toBe(false);

      // Second close is a safe no-op
      expect(() => closedDb.close()).not.toThrow();
      expect(closedDb.isOpen).toBe(false);

      // Post-close operations must throw DatabaseClosedError
      expect(() => closedDb.exec('SELECT 1;')).toThrow(DatabaseClosedError);
      expect(() => closedDb.prepare('SELECT 1;')).toThrow(DatabaseClosedError);
      expect(() => stmt.get()).toThrow(DatabaseClosedError);
      expect(() => stmt.all()).toThrow(DatabaseClosedError);
      expect(() => stmt.run()).toThrow(DatabaseClosedError);
      expect(() => closedDb.transaction(() => 1)).toThrow(DatabaseClosedError);
      expect(() => closedDb.migrate()).toThrow(DatabaseClosedError);
      expect(() => closedDb.getCurrentSchemaVersion()).toThrow(DatabaseClosedError);
      expect(() => closedDb.getAppliedMigrations()).toThrow(DatabaseClosedError);
    } finally {
      if (db?.isOpen) {
        db.close();
      }
      ctx.cleanup();
    }
  });

  it('supports path containing spaces and unicode characters safely', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai test path with spaces and ñú-'));
    const dbPath = path.join(tempDir, 'busca ofertas espécificas.sqlite');

    try {
      const db = openSqliteDatabase({ databasePath: dbPath });
      expect(db.isOpen).toBe(true);
      db.exec('CREATE TABLE test_unicode (id INT PRIMARY KEY, val TEXT);');
      db.prepare('INSERT INTO test_unicode VALUES (?, ?)').run(1, 'prueba de caracteres');
      const row = db
        .prepare<Record<string, unknown>, [number]>('SELECT * FROM test_unicode WHERE id = ?')
        .get(1);
      expect(row!['val']).toBe('prueba de caracteres');
      db.close();
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
