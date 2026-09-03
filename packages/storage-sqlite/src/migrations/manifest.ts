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
        adapter_version TEXT NOT NULL CHECK(length(trim(adapter_version)) > 0),
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
        CONSTRAINT chk_source_runs_metrics CHECK (
          (pages_requested IS NULL OR (pages_requested >= 0 AND pages_requested = round(pages_requested))) AND
          (pages_completed IS NULL OR (pages_completed >= 0 AND pages_completed = round(pages_completed))) AND
          (raw_items_count IS NULL OR (raw_items_count >= 0 AND raw_items_count = round(raw_items_count))) AND
          (parsed_items_count IS NULL OR (parsed_items_count >= 0 AND parsed_items_count = round(parsed_items_count))) AND
          (rejected_items_count IS NULL OR (rejected_items_count >= 0 AND rejected_items_count = round(rejected_items_count))) AND
          (stop_reason IS NULL OR stop_reason IN (
            'ALL_PAGES_FETCHED',
            'MAX_PAGES_REACHED',
            'MAX_ITEMS_REACHED',
            'NO_MORE_RESULTS',
            'RATE_LIMIT_STOP',
            'USER_ABORTED',
            'DEADLINE_EXCEEDED'
          )) AND
          (
            status NOT IN ('SUCCESS', 'ZERO_RESULTS_CONFIRMED') OR
            (
              pages_requested IS NOT NULL AND
              pages_completed IS NOT NULL AND
              raw_items_count IS NOT NULL AND
              parsed_items_count IS NOT NULL AND
              rejected_items_count IS NOT NULL AND
              stop_reason IS NOT NULL
            )
          )
        ),
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
        lock_token TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        metadata TEXT,
        CONSTRAINT chk_execution_lock_singleton CHECK (lock_key = 'EXECUTION_LOCK')
      );
    `);
  },
});

const prodMigration003: Migration = Object.freeze({
  version: 3,
  name: '003_create_observation_history',
  up(context: MigrationContext): void {
    context.exec(`
      -- observations: Immutable historical observation records
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        source_run_id TEXT NOT NULL REFERENCES source_runs(id) ON DELETE RESTRICT,
        observed_at TEXT NOT NULL,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        description TEXT,
        price TEXT,
        location TEXT,
        condition TEXT CHECK(condition IS NULL OR condition IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'FOR_PARTS', 'UNKNOWN')),
        availability TEXT NOT NULL CHECK(availability IN ('AVAILABLE', 'PENDING', 'SOLD', 'REMOVED', 'UNKNOWN')),
        image_urls TEXT NOT NULL CHECK(json_valid(image_urls)),
        published_at TEXT,
        raw_fingerprint TEXT NOT NULL CHECK(length(trim(raw_fingerprint)) > 0),
        CONSTRAINT uq_observations_listing_run_fingerprint UNIQUE(listing_id, source_run_id, raw_fingerprint)
      );

      CREATE INDEX IF NOT EXISTS idx_observations_listing_observed_at ON observations(listing_id, observed_at);
      CREATE INDEX IF NOT EXISTS idx_observations_source_run_id ON observations(source_run_id);
    `);
  },
});

const prodMigration004: Migration = Object.freeze({
  version: 4,
  name: '004_create_review_feedback_persistence',
  up(context: MigrationContext): void {
    context.exec(`
      -- evaluations: Historical evaluation records
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        decision TEXT NOT NULL CHECK(decision IN ('MATCH', 'REVIEW', 'REJECT')),
        score REAL NOT NULL CHECK(score >= 0.0 AND score <= 100.0),
        reasons TEXT NOT NULL CHECK(json_valid(reasons)),
        evaluated_by TEXT NOT NULL CHECK(json_valid(evaluated_by)),
        policy_version TEXT NOT NULL CHECK(length(trim(policy_version)) > 0),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_evaluations_decision ON evaluations(decision);

      -- opportunities: Business opportunities linking search, observation and evaluation
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE RESTRICT,
        observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE RESTRICT,
        evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE RESTRICT,
        novelty TEXT NOT NULL CHECK(novelty IN ('NEW', 'UNCHANGED', 'PRICE_CHANGED', 'REAPPEARED')),
        created_at TEXT NOT NULL,
        CONSTRAINT uq_opportunities_id_evaluation UNIQUE(id, evaluation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_opportunities_saved_search_id ON opportunities(saved_search_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_observation_id ON opportunities(observation_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_evaluation_id ON opportunities(evaluation_id);

      -- feedback: Append-only user review feedback
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        previous_evaluation_id TEXT NOT NULL,
        actor TEXT NOT NULL CHECK(actor = 'LOCAL_USER'),
        decision TEXT NOT NULL CHECK(decision IN ('CONFIRMED_MATCH', 'FALSE_POSITIVE', 'PRICE_INCORRECT', 'NOT_INTERESTED', 'OTHER')),
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 2000),
        created_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id, previous_evaluation_id) REFERENCES opportunities(id, evaluation_id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_opportunity_created ON feedback(opportunity_id, created_at ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_feedback_decision ON feedback(decision);

      -- Triggers enforcing append-only immutability even against direct SQL
      CREATE TRIGGER IF NOT EXISTS trg_feedback_no_update
      BEFORE UPDATE ON feedback
      BEGIN
        SELECT RAISE(ABORT, 'Feedback records are append-only and cannot be updated');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_feedback_no_delete
      BEFORE DELETE ON feedback
      BEGIN
        SELECT RAISE(ABORT, 'Feedback records are append-only and cannot be deleted');
      END;
    `);
  },
});

export const PRODUCTION_MIGRATIONS: readonly Migration[] = Object.freeze([
  prodMigration001,
  prodMigration002,
  prodMigration003,
  prodMigration004,
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
