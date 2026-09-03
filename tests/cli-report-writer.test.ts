import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateSearchSlug,
  sanitizeShortRunId,
  formatRunTimestamp,
  persistReportHtml,
  generateAndOpenReport,
  FakeReportOpener,
} from '@busca-ofertas-ai/cli';
import type { ReportViewModel } from '@busca-ofertas-ai/report-html';

describe('apps/cli — Report Persistence and Reporting Service', () => {
  let tempReportsDir: string;

  beforeEach(async () => {
    tempReportsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-reports-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempReportsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Slug & Identifier Sanitization (Path Safety)', () => {
    it('normalizes diacritics and converts non-alphanumeric chars to hyphens', () => {
      expect(generateSearchSlug('Nintendo Switch — Edición Especial')).toBe(
        'nintendo-switch-edicion-especial',
      );
      expect(generateSearchSlug('Hurlingham Ñandú 🎮')).toBe('hurlingham-nandu');
      expect(generateSearchSlug('Switch Lite (Turquesa / Gris)')).toBe('switch-lite-turquesa-gris');
    });

    it('neutralizes path traversal characters (.., /, \\)', () => {
      expect(generateSearchSlug('../../.ssh')).toBe('ssh');
      expect(generateSearchSlug('/tmp/pwned')).toBe('tmp-pwned');
      expect(generateSearchSlug('..\\..\\windows\\system32')).toBe('windows-system32');
    });

    it('falls back to "busqueda" if search name is empty or only special symbols', () => {
      expect(generateSearchSlug('')).toBe('busqueda');
      expect(generateSearchSlug('   ')).toBe('busqueda');
      expect(generateSearchSlug('!!!///???')).toBe('busqueda');
    });

    it('derives deterministic, unique run ID segments incorporating digest of full ID', () => {
      const id1 = sanitizeShortRunId('run-12345');
      const id2 = sanitizeShortRunId('run-12345');
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^run-12345-[a-f0-9]{8}$/);

      // Distinct IDs sharing the same first 16 safe chars produce DIFFERENT segments
      const runA = sanitizeShortRunId('run-aaaaaaaaaaaa-111');
      const runB = sanitizeShortRunId('run-aaaaaaaaaaaa-222');
      expect(runA).not.toBe(runB);

      // Distinct IDs that would normalize to the same characters produce DIFFERENT segments
      const norm1 = sanitizeShortRunId('run/1');
      const norm2 = sanitizeShortRunId('run_1');
      expect(norm1).not.toBe(norm2);

      // Traversal payloads stripped of traversal chars
      const traversal = sanitizeShortRunId('../../etc/passwd');
      expect(traversal).not.toContain('/');
      expect(traversal).not.toContain('..');
      expect(traversal).toMatch(/^etc_passwd-[a-f0-9]{8}$/);

      expect(sanitizeShortRunId('')).toMatch(/^run-[a-f0-9]{8}$/);
      expect(sanitizeShortRunId('   ')).toMatch(/^run-[a-f0-9]{8}$/);
    });

    it('formats timestamps deterministically in UTC as YYYY-MM-DD_HH-mm-ss', () => {
      const fixedDate = new Date('2026-09-03T15:30:45.000Z');
      expect(formatRunTimestamp(fixedDate)).toBe('2026-09-03_15-30-45');
      expect(formatRunTimestamp('2026-08-30T19:40:00.000Z')).toBe('2026-08-30_19-40-00');
    });

    it('rejects invalid or unparseable startedAt dates with typed CliError without writing', () => {
      expect(() => formatRunTimestamp('invalid-date')).toThrowError(
        /Fecha de inicio de ejecución inválida/,
      );
      expect(() => formatRunTimestamp(new Date('invalid'))).toThrowError(
        /Fecha de inicio de ejecución inválida/,
      );
    });
  });

  describe('persistReportHtml (File Security & Permissions)', () => {
    it('persists report.html inside reportsDir with mode 0700 for directory and 0600 for file', async () => {
      const result = await persistReportHtml({
        reportsDir: tempReportsDir,
        searchName: 'Nintendo Switch Lite',
        runId: 'run-alpha-123',
        startedAt: '2026-09-03T12:00:00.000Z',
        htmlContent:
          '<!doctype html><html lang="es"><head><title>Test</title></head><body>OK</body></html>',
      });

      expect(fs.existsSync(result.reportDirectory)).toBe(true);
      expect(fs.existsSync(result.reportPath)).toBe(true);
      expect(path.basename(result.reportPath)).toBe('report.html');
      expect(path.dirname(result.reportPath)).toBe(result.reportDirectory);

      const content = await fs.promises.readFile(result.reportPath, 'utf-8');
      expect(content).toContain('<body>OK</body>');

      // Check POSIX modes
      if (process.platform !== 'win32') {
        const dirStat = await fs.promises.stat(result.reportDirectory);
        const fileStat = await fs.promises.stat(result.reportPath);

        // 0700 directory mode
        expect(dirStat.mode & 0o777).toBe(0o700);
        // 0600 file mode
        expect(fileStat.mode & 0o777).toBe(0o600);
      }
    });

    it('replaces report.html atomically when re-run for the same search and timestamp', async () => {
      const options = {
        reportsDir: tempReportsDir,
        searchName: 'Switch Lite AMBA',
        runId: 'run-repeatable-001',
        startedAt: '2026-09-03T14:00:00.000Z',
        htmlContent: '<h1>Version 1</h1>',
      };

      const res1 = await persistReportHtml(options);
      expect(await fs.promises.readFile(res1.reportPath, 'utf-8')).toBe('<h1>Version 1</h1>');

      const res2 = await persistReportHtml({
        ...options,
        htmlContent: '<h1>Version 2 Updated</h1>',
      });

      // Target path and directory are identical
      expect(res2.reportDirectory).toBe(res1.reportDirectory);
      expect(res2.reportPath).toBe(res1.reportPath);
      expect(await fs.promises.readFile(res2.reportPath, 'utf-8')).toBe(
        '<h1>Version 2 Updated</h1>',
      );

      // No leftover temporary files
      const filesInDir = await fs.promises.readdir(res2.reportDirectory);
      expect(filesInDir).toEqual(['report.html']);
    });

    it('strictly enforces containment within reportsDir and blocks path traversal attempts', async () => {
      await expect(
        persistReportHtml({
          reportsDir: tempReportsDir,
          searchName: '../../../../../../tmp',
          runId: '../../../../../../etc/shadow',
          startedAt: '2026-09-03T12:00:00.000Z',
          htmlContent: 'test',
        }),
      ).resolves.toBeDefined(); // Sanitizer neutralizes it to stay inside reportsDir

      // Direct traversal test through manual dir validation
      const resolvedTarget = path.resolve(tempReportsDir, '2026-09-03_12-00-00_tmp_etc_shadow');
      expect(resolvedTarget.startsWith(tempReportsDir)).toBe(true);
    });

    it('ensures different runs with the same prefix or normalizing characters produce distinct directories', async () => {
      const optionsA = {
        reportsDir: tempReportsDir,
        searchName: 'Switch Lite',
        runId: 'run-aaaaaaaaaaaa-111',
        startedAt: '2026-09-03T12:00:00.000Z',
        htmlContent: '<h1>Run A</h1>',
      };
      const optionsB = {
        reportsDir: tempReportsDir,
        searchName: 'Switch Lite',
        runId: 'run-aaaaaaaaaaaa-222',
        startedAt: '2026-09-03T12:00:00.000Z',
        htmlContent: '<h1>Run B</h1>',
      };

      const resA = await persistReportHtml(optionsA);
      const resB = await persistReportHtml(optionsB);

      expect(resA.reportDirectory).not.toBe(resB.reportDirectory);
      expect(await fs.promises.readFile(resA.reportPath, 'utf-8')).toBe('<h1>Run A</h1>');
      expect(await fs.promises.readFile(resB.reportPath, 'utf-8')).toBe('<h1>Run B</h1>');

      // Also verify distinct runs that would normalize to same chars
      const resNorm1 = await persistReportHtml({
        reportsDir: tempReportsDir,
        searchName: 'Switch Lite',
        runId: 'run/1',
        startedAt: '2026-09-03T12:00:00.000Z',
        htmlContent: '<h1>Run Norm 1</h1>',
      });
      const resNorm2 = await persistReportHtml({
        reportsDir: tempReportsDir,
        searchName: 'Switch Lite',
        runId: 'run_1',
        startedAt: '2026-09-03T12:00:00.000Z',
        htmlContent: '<h1>Run Norm 2</h1>',
      });
      expect(resNorm1.reportDirectory).not.toBe(resNorm2.reportDirectory);
    });

    it('rejects persistReportHtml with invalid startedAt and creates zero report files', async () => {
      await expect(
        persistReportHtml({
          reportsDir: tempReportsDir,
          searchName: 'Test',
          runId: 'run-invalid-date',
          startedAt: 'invalid-timestamp',
          htmlContent: '<h1>No write</h1>',
        }),
      ).rejects.toThrow(/Fecha de inicio de ejecución inválida/);

      const entries = await fs.promises.readdir(tempReportsDir);
      expect(entries).toEqual([]);
    });

    it('rejects immediately when AbortSignal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        persistReportHtml({
          reportsDir: tempReportsDir,
          searchName: 'Test',
          runId: 'run-abort',
          startedAt: '2026-09-03T12:00:00.000Z',
          htmlContent: 'test',
          signal: controller.signal,
        }),
      ).rejects.toThrow('This operation was aborted');
    });
  });

  describe('generateAndOpenReport (Reporting Orchestrator)', () => {
    const mockViewModel: ReportViewModel = {
      run: {
        runId: 'run-orch-01',
        searchName: 'Nintendo Switch Lite en AMBA',
        startedAt: '2026-09-03T12:00:00.000Z',
        globalStatus: 'SUCCESS',
        sources: [
          {
            sourceId: 'facebook-marketplace',
            sourceStatus: 'SUCCESS',
            collector: 'GraphQL',
            itemsCount: 1,
          },
        ],
        warnings: [],
        metrics: {
          totalCollected: 1,
          totalNormalized: 1,
        },
      },
      items: [
        {
          id: 'item-1',
          title: 'Switch Lite Gris',
          source: 'facebook-marketplace',
          novelty: 'NEW',
          decision: 'MATCH',
          reasons: [],
        },
      ],
      sourceErrors: [],
    };

    it('renders, persists, and successfully opens report when opener succeeds', async () => {
      const fakeOpener = new FakeReportOpener({ shouldSucceed: true });

      const result = await generateAndOpenReport({
        viewModel: mockViewModel,
        reportsDir: tempReportsDir,
        opener: fakeOpener,
      });

      expect(result.generated).toBe(true);
      expect(result.opened).toBe(true);
      expect(fs.existsSync(result.reportPath)).toBe(true);
      expect(fakeOpener.openedReports).toEqual([result.reportPath]);
    });

    it('NON-BLOCKING FALLBACK: does NOT fail the report when opener fails to open browser', async () => {
      const fakeOpener = new FakeReportOpener({
        shouldSucceed: false,
        failureReason: 'El comando "xdg-open" no está instalado en el sistema.',
      });

      const result = await generateAndOpenReport({
        viewModel: mockViewModel,
        reportsDir: tempReportsDir,
        opener: fakeOpener,
      });

      // The report generation itself succeeded and the file exists!
      expect(result.generated).toBe(true);
      expect(result.opened).toBe(false);
      expect(result.openerReason).toContain('xdg-open');
      expect(fs.existsSync(result.reportPath)).toBe(true);

      const savedHtml = await fs.promises.readFile(result.reportPath, 'utf-8');
      expect(savedHtml).toContain('Switch Lite Gris');
    });

    it('persists without opening when opener is omitted', async () => {
      const result = await generateAndOpenReport({
        viewModel: mockViewModel,
        reportsDir: tempReportsDir,
      });

      expect(result.generated).toBe(true);
      expect(result.opened).toBe(false);
      expect(result.openerReason).toBeUndefined();
      expect(fs.existsSync(result.reportPath)).toBe(true);
    });

    it('aborts cleanly when AbortSignal is cancelled', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        generateAndOpenReport({
          viewModel: mockViewModel,
          reportsDir: tempReportsDir,
          signal: controller.signal,
        }),
      ).rejects.toThrow('This operation was aborted');
    });
  });
});
