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

const prodMigration002: Migration = Object.freeze({
  version: 2,
  name: '002_create_operational_persistence',
  up(context: MigrationContext): void {
    context.exec(`
      -- saved_searches: Current configuration state
      CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('PRODUCT', 'REAL_ESTATE', 'VEHICLE')),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_searches_enabled ON saved_searches(enabled);

      -- saved_search_revisions: Append-only configuration revisions history
      CREATE TABLE IF NOT EXISTS saved_search_revisions (
        id TEXT PRIMARY KEY,
        saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE RESTRICT,
        revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
        schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
        snapshot TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        CONSTRAINT uq_saved_search_revisions UNIQUE(saved_search_id, revision_number)
      );

      CREATE INDEX IF NOT EXISTS idx_saved_search_revisions_search_id ON saved_search_revisions(saved_search_id);

      -- runs: Business execution attempts
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK(status IN ('CREATED', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        CONSTRAINT chk_runs_status_consistency CHECK (
          (status IN ('CREATED', 'RUNNING') AND finished_at IS NULL AND error IS NULL) OR
          (status IN ('SUCCESS', 'PARTIAL_SUCCESS') AND finished_at IS NOT NULL AND error IS NULL) OR
          (status = 'FAILED' AND finished_at IS NOT NULL AND error IS NOT NULL) OR
          (status = 'CANCELLED' AND finished_at IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_runs_saved_search_id ON runs(saved_search_id);
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

      -- source_runs: Per-source execution outcome within a run
      CREATE TABLE IF NOT EXISTS source_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
        source_id TEXT NOT NULL,
        collector_id TEXT,
        adapter_version TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'PENDING',
          'RUNNING',
          'SUCCESS',
          'ZERO_RESULTS_CONFIRMED',
          'AUTHENTICATION_REQUIRED',
          'MANUAL_INTERVENTION_REQUIRED',
          'RATE_LIMITED',
          'NETWORK_ERROR',
          'SOURCE_UNAVAILABLE',
          'CONTRACT_CHANGED',
          'PARSER_FAILED',
          'TIMEOUT',
          'CONFIGURATION_UNSUPPORTED',
          'CANCELLED'
        )),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        items_count INTEGER,
        error TEXT,
        pages_requested INTEGER,
        pages_completed INTEGER,
        raw_items_count INTEGER,
        parsed_items_count INTEGER,
        rejected_items_count INTEGER,
        stop_reason TEXT,
        CONSTRAINT chk_source_runs_status_consistency CHECK (
          (status IN ('PENDING', 'RUNNING') AND finished_at IS NULL AND items_count IS NULL AND error IS NULL) OR
          (status = 'SUCCESS' AND finished_at IS NOT NULL AND items_count IS NOT NULL AND items_count >= 0 AND error IS NULL) OR
          (status = 'ZERO_RESULTS_CONFIRMED' AND finished_at IS NOT NULL AND items_count = 0 AND error IS NULL) OR
          (status IN (
            'AUTHENTICATION_REQUIRED',
            'MANUAL_INTERVENTION_REQUIRED',
            'RATE_LIMITED',
            'NETWORK_ERROR',
            'SOURCE_UNAVAILABLE',
            'CONTRACT_CHANGED',
            'PARSER_FAILED',
            'TIMEOUT',
            'CONFIGURATION_UNSUPPORTED'
          ) AND finished_at IS NOT NULL AND items_count IS NULL AND error IS NOT NULL) OR
          (status = 'CANCELLED' AND finished_at IS NOT NULL AND items_count IS NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_source_runs_run_id ON source_runs(run_id);
      CREATE INDEX IF NOT EXISTS idx_source_runs_source_id ON source_runs(source_id);

      -- listings: Canonical listing identity
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        CONSTRAINT uq_listings_source_external UNIQUE(source_id, external_id),
        CONSTRAINT chk_listings_dates CHECK (last_seen_at >= first_seen_at)
      );

      CREATE INDEX IF NOT EXISTS idx_listings_source_external ON listings(source_id, external_id);

      -- execution_lock: Mutex preventing concurrent runs on the same database
      CREATE TABLE IF NOT EXISTS execution_lock (
        lock_key TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        metadata TEXT
      );
    `);
  },
});

export const PRODUCTION_MIGRATIONS: readonly Migration[] = Object.freeze([
  prodMigration001,
  prodMigration002,
]);

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
