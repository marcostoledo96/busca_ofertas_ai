import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCliApplication, FakeTerminal, TestSignalManager } from '@busca-ofertas-ai/cli';
import { openSqliteDatabase, type SqliteDatabase } from '@busca-ofertas-ai/storage-sqlite';

describe('CLI Bootstrap SQLite Integration (BLOCKER-01)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-bootstrap-test-'));
    originalEnv = { ...process.env };
    process.env['XDG_DATA_HOME'] = tempDir;
    process.env['XDG_CONFIG_HOME'] = tempDir;
    dbPath = path.join(tempDir, 'busca-ofertas-ai', 'busca-ofertas.sqlite');
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  function seedDatabase(db: SqliteDatabase) {
    db.migrate();

    db.prepare(
      `INSERT INTO saved_searches (id, schema_version, name, category, enabled, created_at, updated_at, payload)
       VALUES ('search-1', 1, 'Switch', 'PRODUCT', 1, '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z', '{}');`,
    ).run();

    db.prepare(
      `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at)
       VALUES ('run-1', 'search-1', 'SUCCESS', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO source_runs (id, run_id, source_id, adapter_version, status, items_count, pages_requested, pages_completed, raw_items_count, parsed_items_count, rejected_items_count, stop_reason, started_at, finished_at)
       VALUES ('sr-1', 'run-1', 'synth-source', '1.0.0', 'SUCCESS', 1, 1, 1, 1, 1, 0, 'ALL_PAGES_FETCHED', '2026-09-03T12:00:00.000Z', '2026-09-03T12:05:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
       VALUES ('list-1', 'synth-source', 'ext-1', 'https://example.com/1', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO observations (id, listing_id, source_run_id, observed_at, title, availability, image_urls, raw_fingerprint)
       VALUES ('obs-1', 'list-1', 'sr-1', '2026-09-03T12:00:00.000Z', 'Nintendo Switch Lite Turquesa', 'AVAILABLE', '[]', 'fp-1');`,
    ).run();

    db.prepare(
      `INSERT INTO evaluations (id, decision, score, reasons, evaluated_by, policy_version, created_at)
       VALUES ('eval-1', 'REVIEW', 65.0, '[{"code":"PRICE_AMBIGUOUS","message":"Verificar estado","severity":"SOFT","impact":-35}]', '["RULES"]', 'v1', '2026-09-03T12:00:00.000Z');`,
    ).run();

    db.prepare(
      `INSERT INTO opportunities (id, saved_search_id, observation_id, evaluation_id, novelty, created_at)
       VALUES ('opp-1', 'search-1', 'obs-1', 'eval-1', 'NEW', '2026-09-03T12:00:00.000Z');`,
    ).run();
  }

  it('runs production application bootstrap path with real SQLite, reviews pending item, and persists feedback to disk', async () => {
    // 1. Pre-seed the database on disk
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    const preDb = openSqliteDatabase({ databasePath: dbPath, createParentDirectory: true });
    seedDatabase(preDb);
    preDb.close();

    // 2. Launch the application WITHOUT injecting ReviewQueueService or RecordReviewFeedbackUseCase
    const terminal = new FakeTerminal();
    const signalManager = new TestSignalManager();

    // Interaction flow:
    // '5': Menu option 5 (Revisar publicaciones dudosas)
    // '1': Submenu option 1 (Pendientes por ejecución)
    // 'run-1': Enter Run ID
    // '1': Card Action 1 (Marcar relevante: CONFIRMED_MATCH)
    // 'Confirmado en test de bootstrap': Feedback notes
    // '0': Return to main menu
    // '8': Exit application
    terminal.enqueueInput('5', '1', 'run-1', '1', 'Confirmado en test de bootstrap', '0', '8');

    const app = createCliApplication({
      terminal,
      signalManager,
      databasePath: dbPath,
    });

    const exitCode = await app.run();
    expect(exitCode).toBe(0);

    // 3. Re-open the database from disk directly to verify feedback was persisted
    const verifyDb = openSqliteDatabase({ databasePath: dbPath, createParentDirectory: true });
    interface FeedbackRow {
      id: string;
      opportunity_id: string;
      previous_evaluation_id: string;
      actor: string;
      decision: string;
      notes: string | null;
      created_at: string;
    }

    const rows = verifyDb
      .prepare<FeedbackRow, [string]>('SELECT * FROM feedback WHERE opportunity_id = ?;')
      .all('opp-1');

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.opportunity_id).toBe('opp-1');
    expect(row.previous_evaluation_id).toBe('eval-1');
    expect(row.actor).toBe('LOCAL_USER');
    expect(row.decision).toBe('CONFIRMED_MATCH');
    expect(row.notes).toBe('Confirmado en test de bootstrap');

    verifyDb.close();
  });
});
