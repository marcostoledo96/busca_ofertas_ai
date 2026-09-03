import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  persistRunExports,
  resolveRunOutputDirectory,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_REPORT_FILE_MODE,
} from '@busca-ofertas-ai/cli';

function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-test-run-export-writer-'));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup error
      }
    },
  };
}

describe('CLI Run Export Writer & Pair Consistency (BOAI-014)', () => {
  it('persists results.json and results.csv in the deterministic run directory with 0700 / 0600 permissions', async () => {
    const { dir, cleanup } = createTempDir();
    try {
      const loc = await persistRunExports({
        reportsDir: dir,
        searchName: 'Nintendo Switch Lite',
        runId: 'run-writer-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"schemaVersion":1}\n',
        csvContent: 'schema_version\r\n1\r\n',
      });

      expect(fs.existsSync(loc.jsonPath)).toBe(true);
      expect(fs.existsSync(loc.csvPath)).toBe(true);
      expect(fs.readFileSync(loc.jsonPath, 'utf-8')).toBe('{"schemaVersion":1}\n');
      expect(fs.readFileSync(loc.csvPath, 'utf-8')).toBe('schema_version\r\n1\r\n');

      if (process.platform !== 'win32') {
        const dirStat = fs.statSync(loc.exportDirectory);
        expect(dirStat.mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);

        const jsonStat = fs.statSync(loc.jsonPath);
        expect(jsonStat.mode & 0o777).toBe(PRIVATE_REPORT_FILE_MODE);

        const csvStat = fs.statSync(loc.csvPath);
        expect(csvStat.mode & 0o777).toBe(PRIVATE_REPORT_FILE_MODE);
      }
    } finally {
      cleanup();
    }
  });

  it('fresh generation failure: if commit fails mid-way, neither results.json nor results.csv remains', async () => {
    const { dir, cleanup } = createTempDir();
    try {
      const promise = persistRunExports({
        reportsDir: dir,
        searchName: 'Search Fail Test',
        runId: 'run-fail-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"version":"new"}\n',
        csvContent: 'new,csv\r\n',
        _testCommitHook: (stage) => {
          if (stage === 'before_csv_commit') {
            throw new Error('Simulated crash right after JSON commit before CSV commit');
          }
        },
      });

      await expect(promise).rejects.toThrow('Simulated crash right after JSON commit');

      const resolvedDir = resolveRunOutputDirectory({
        reportsDir: dir,
        searchName: 'Search Fail Test',
        runId: 'run-fail-1',
        startedAt: '2026-08-30T10:00:00.000Z',
      });

      const jsonFile = path.join(resolvedDir, 'results.json');
      const csvFile = path.join(resolvedDir, 'results.csv');

      // Neither file should exist!
      expect(fs.existsSync(jsonFile)).toBe(false);
      expect(fs.existsSync(csvFile)).toBe(false);

      // No leftover .tmp or .bak files
      const remainingFiles = fs.readdirSync(resolvedDir);
      expect(remainingFiles).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('regeneration failure: if V1 exists and V2 fails during second commit, V1 remains intact for both JSON and CSV', async () => {
    const { dir, cleanup } = createTempDir();
    try {
      // 1. Initial success (V1)
      const loc1 = await persistRunExports({
        reportsDir: dir,
        searchName: 'Search Regen Test',
        runId: 'run-regen-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"version":"V1"}\n',
        csvContent: 'V1,csv\r\n',
      });

      expect(fs.readFileSync(loc1.jsonPath, 'utf-8')).toBe('{"version":"V1"}\n');
      expect(fs.readFileSync(loc1.csvPath, 'utf-8')).toBe('V1,csv\r\n');

      // 2. V2 generation fails after JSON commit but before CSV commit
      const promiseV2 = persistRunExports({
        reportsDir: dir,
        searchName: 'Search Regen Test',
        runId: 'run-regen-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"version":"V2"}\n',
        csvContent: 'V2,csv\r\n',
        _testCommitHook: (stage) => {
          if (stage === 'before_csv_commit') {
            throw new Error('Simulated failure before CSV commit in V2');
          }
        },
      });

      await expect(promiseV2).rejects.toThrow('Simulated failure before CSV commit in V2');

      // Controlled-failure recovery: V1 MUST BE INTACT FOR BOTH!
      expect(fs.readFileSync(loc1.jsonPath, 'utf-8')).toBe('{"version":"V1"}\n');
      expect(fs.readFileSync(loc1.csvPath, 'utf-8')).toBe('V1,csv\r\n');

      // No leftover .tmp or .bak files
      const remaining = fs.readdirSync(loc1.exportDirectory);
      expect(remaining.sort()).toEqual(['results.csv', 'results.json']);
    } finally {
      cleanup();
    }
  });

  it('preserves report.html untouched during export persistence and idempotent re-runs', async () => {
    const { dir, cleanup } = createTempDir();
    try {
      const resolvedDir = resolveRunOutputDirectory({
        reportsDir: dir,
        searchName: 'Untouched Report Test',
        runId: 'run-untouched-1',
        startedAt: '2026-08-30T10:00:00.000Z',
      });

      fs.mkdirSync(resolvedDir, { recursive: true });
      const htmlPath = path.join(resolvedDir, 'report.html');
      fs.writeFileSync(htmlPath, '<html><body>Existing Report</body></html>', 'utf-8');

      // Write exports
      await persistRunExports({
        reportsDir: dir,
        searchName: 'Untouched Report Test',
        runId: 'run-untouched-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"ok":true}\n',
        csvContent: 'ok\r\n',
      });

      // HTML must be 100% identical and untouched
      expect(fs.readFileSync(htmlPath, 'utf-8')).toBe('<html><body>Existing Report</body></html>');

      // Idempotent re-run
      await persistRunExports({
        reportsDir: dir,
        searchName: 'Untouched Report Test',
        runId: 'run-untouched-1',
        startedAt: '2026-08-30T10:00:00.000Z',
        jsonContent: '{"ok":true}\n',
        csvContent: 'ok\r\n',
      });

      expect(fs.readFileSync(htmlPath, 'utf-8')).toBe('<html><body>Existing Report</body></html>');
    } finally {
      cleanup();
    }
  });
});
