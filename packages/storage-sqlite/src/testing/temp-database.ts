import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openSqliteDatabase } from '../database/sqlite-database.js';
import type { OpenSqliteDatabaseOptions, SqliteDatabase } from '../database/types.js';

export interface TempDatabaseContext {
  readonly dirPath: string;
  readonly databasePath: string;
  readonly cleanup: () => void;
}

export function createTempDatabaseContext(prefix = 'boai-storage-test-'): TempDatabaseContext {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(tempDir, 'test-busca-ofertas.sqlite');

  const cleanup = (): void => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error in test tear-down
    }
  };

  return {
    dirPath: tempDir,
    databasePath,
    cleanup,
  };
}

export function withTempDatabase<T>(
  fn: (db: SqliteDatabase, context: TempDatabaseContext) => T,
  options?: Omit<OpenSqliteDatabaseOptions, 'databasePath'>,
): T {
  const context = createTempDatabaseContext();
  let db: SqliteDatabase | null = null;
  let isAsync = false;

  try {
    db = openSqliteDatabase({
      databasePath: context.databasePath,
      ...options,
    });
    const result = fn(db, context);

    if (
      typeof result === 'object' &&
      result !== null &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      isAsync = true;
      const activeDb = db;
      return (result as unknown as Promise<unknown>).finally(() => {
        if (activeDb && activeDb.isOpen) {
          try {
            activeDb.close();
          } catch {
            // ignore close error
          }
        }
        context.cleanup();
      }) as T;
    }

    return result;
  } finally {
    if (!isAsync) {
      if (db && db.isOpen) {
        try {
          db.close();
        } catch {
          // ignore close error
        }
      }
      context.cleanup();
    }
  }
}
