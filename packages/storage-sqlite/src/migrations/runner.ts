import {
  MigrationFailedError,
  MigrationManifestInvalidError,
  SchemaVersionUnsupportedError,
} from '../errors/storage-errors.js';
import type { SqliteDatabase, ClockLike } from '../database/types.js';
import {
  SCHEMA_MIGRATIONS_TABLE_NAME,
  PRODUCTION_MIGRATIONS,
  validateMigrationManifest,
} from './manifest.js';
import type { AppliedMigration, MigrateOptions, Migration, MigrationRunResult } from './types.js';

interface TableCheckRow {
  readonly name: string;
}

interface MigrationRecordRow {
  readonly version: number;
  readonly name: string;
  readonly applied_at: string;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function inspectSchemaMigrations(db: SqliteDatabase): readonly AppliedMigration[] {
  const tableCheck = db
    .prepare<TableCheckRow, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(SCHEMA_MIGRATIONS_TABLE_NAME);

  if (!tableCheck) {
    return [];
  }

  const rows = db
    .prepare<MigrationRecordRow, []>(
      `SELECT version, name, applied_at FROM ${SCHEMA_MIGRATIONS_TABLE_NAME} ORDER BY version ASC`,
    )
    .all();

  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    appliedAt: String(row.applied_at),
  }));
}

export function runMigrations(
  db: SqliteDatabase,
  options?: MigrateOptions,
  customMigrations?: readonly Migration[],
  clock: ClockLike = { now: () => new Date() },
): MigrationRunResult {
  const rawManifest = customMigrations ?? PRODUCTION_MIGRATIONS;
  const sortedManifest = validateMigrationManifest(rawManifest);
  const maxManifestVersion =
    sortedManifest.length > 0 ? sortedManifest[sortedManifest.length - 1]!.version : 0;

  const appliedSoFar = [...inspectSchemaMigrations(db)];
  const initialVersion =
    appliedSoFar.length > 0 ? appliedSoFar[appliedSoFar.length - 1]!.version : 0;

  // 1. Fail closed on future schema versions
  if (initialVersion > maxManifestVersion) {
    throw new SchemaVersionUnsupportedError({
      foundVersion: initialVersion,
      maxSupportedVersion: maxManifestVersion,
    });
  }

  // 2. Validate historical alignment (append-only contract)
  for (let i = 0; i < appliedSoFar.length; i++) {
    const applied = appliedSoFar[i]!;
    const expected = sortedManifest[i];
    if (!expected || expected.version !== applied.version || expected.name !== applied.name) {
      throw new MigrationManifestInvalidError(
        `Database migration history mismatch at version ${applied.version}. Expected '${expected?.name ?? 'none'}', found '${applied.name}'.`,
      );
    }
  }

  // 3. Determine pending migrations
  const targetVersion = options?.targetVersion ?? maxManifestVersion;
  if (targetVersion < initialVersion) {
    throw new MigrationManifestInvalidError(
      `Cannot migrate backwards: targetVersion ${targetVersion} is less than current version ${initialVersion}.`,
    );
  }
  if (targetVersion > maxManifestVersion) {
    throw new SchemaVersionUnsupportedError({
      foundVersion: targetVersion,
      maxSupportedVersion: maxManifestVersion,
    });
  }

  const pendingMigrations = sortedManifest.filter(
    (m) => m.version > initialVersion && m.version <= targetVersion,
  );

  if (pendingMigrations.length === 0) {
    return {
      previousVersion: initialVersion,
      currentVersion: initialVersion,
      appliedMigrations: Object.freeze(appliedSoFar),
      newlyAppliedCount: 0,
    };
  }

  // 4. Apply each pending migration inside its own transaction
  let newlyApplied = 0;
  for (const migration of pendingMigrations) {
    try {
      db.transaction((tx) => {
        const upResult = migration.up(tx) as unknown;
        if (isThenable(upResult)) {
          const promiseLike = upResult as unknown as {
            catch?: (fn: () => void) => unknown;
          };
          if (typeof promiseLike.catch === 'function') {
            promiseLike.catch(() => {});
          }
          throw new MigrationFailedError(
            {
              version: migration.version,
              migrationName: migration.name,
            },
            `Migration ${migration.version} ('${migration.name}') returned a Promise/thenable. Migrations must be synchronous.`,
          );
        }
        const insertStmt = tx.prepare<Record<string, unknown>, [number, string, string]>(
          `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE_NAME} (version, name, applied_at) VALUES (?, ?, ?)`,
        );
        const appliedAt = clock.now().toISOString();
        insertStmt.run(migration.version, migration.name, appliedAt);
        appliedSoFar.push({
          version: migration.version,
          name: migration.name,
          appliedAt,
        });
      });
      newlyApplied++;
    } catch (error) {
      if (error instanceof MigrationFailedError) {
        throw error;
      }
      throw new MigrationFailedError(
        {
          version: migration.version,
          migrationName: migration.name,
        },
        `Migration ${migration.version} ('${migration.name}') failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const currentVersion =
    appliedSoFar.length > 0 ? appliedSoFar[appliedSoFar.length - 1]!.version : 0;

  return {
    previousVersion: initialVersion,
    currentVersion,
    appliedMigrations: Object.freeze(appliedSoFar),
    newlyAppliedCount: newlyApplied,
  };
}
