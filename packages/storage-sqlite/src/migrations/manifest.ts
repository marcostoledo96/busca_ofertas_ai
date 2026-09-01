import { MigrationManifestInvalidError } from '../errors/storage-errors.js';
import type { Migration, MigrationContext } from './types.js';

export const SCHEMA_MIGRATIONS_TABLE_NAME = 'schema_migrations' as const;

const prodMigration001: Migration = Object.freeze({
  version: 1,
  name: '001_create_schema_migrations',
  up(context: MigrationContext): void {
    context.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  },
});

export const PRODUCTION_MIGRATIONS: readonly Migration[] = Object.freeze([prodMigration001]);

export function validateMigrationManifest(migrations: readonly Migration[]): readonly Migration[] {
  const seenVersions = new Set<number>();
  const seenNames = new Set<string>();

  for (const m of migrations) {
    if (typeof m !== 'object' || m === null) {
      throw new MigrationManifestInvalidError('Migration entry must be a non-null object');
    }
    if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) {
      throw new MigrationManifestInvalidError(
        `Migration version must be a positive integer (>= 1). Got: ${String(m.version)}`,
      );
    }
    if (typeof m.name !== 'string' || m.name.trim().length === 0) {
      throw new MigrationManifestInvalidError(
        `Migration name must be a non-empty string. Got: '${String(m.name)}'`,
      );
    }
    if (typeof m.up !== 'function') {
      throw new MigrationManifestInvalidError(
        `Migration '${m.name}' (v${m.version}) must provide an 'up' function`,
      );
    }
    if (seenVersions.has(m.version)) {
      throw new MigrationManifestInvalidError(
        `Duplicate migration version detected in manifest: version ${m.version}`,
      );
    }
    if (seenNames.has(m.name)) {
      throw new MigrationManifestInvalidError(
        `Duplicate migration name detected in manifest: name '${m.name}'`,
      );
    }
    seenVersions.add(m.version);
    seenNames.add(m.name);
  }

  // Return deterministically sorted by version ascending
  return [...migrations].sort((a, b) => a.version - b.version);
}
