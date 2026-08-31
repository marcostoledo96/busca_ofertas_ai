import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { NodeXdgReportOpener, FakeReportOpener, type SpawnFunction } from '@busca-ofertas-ai/cli';

class MockChildProcess extends EventEmitter {
  public killed = false;
  public stderr = new EventEmitter();

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.emit('close', null, signal ?? 'SIGTERM');
    return true;
  }
}

describe('Report Opener Port & XDG Adapter (BOAI-008)', () => {
  describe('NodeXdgReportOpener', () => {
    it('returns opened: true when xdg-open process exits with code 0', async () => {
      const mockChild = new MockChildProcess();
      const mockSpawn = vi.fn().mockImplementation(() => {
        setTimeout(() => mockChild.emit('close', 0, null), 5);
        return mockChild;
      }) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({
        openerCommand: 'xdg-open',
        spawnFn: mockSpawn,
      });

      const result = await opener.openLocalReport('/home/user/data/reports/report.html');
      expect(result).toEqual({
        opened: true,
        reportPath: '/home/user/data/reports/report.html',
      });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith('xdg-open', ['/home/user/data/reports/report.html'], {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    });

    it('returns opened: false with descriptive reason when xdg-open is not found (ENOENT)', async () => {
      const mockChild = new MockChildProcess();
      const mockSpawn = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          const err = new Error('spawn xdg-open ENOENT') as Error & { code?: string };
          err.code = 'ENOENT';
          mockChild.emit('error', err);
        }, 5);
        return mockChild;
      }) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({
        openerCommand: 'xdg-open',
        spawnFn: mockSpawn,
      });

      const result = await opener.openLocalReport('/path/to/report.html');
      expect(result.opened).toBe(false);
      expect(result.reportPath).toBe('/path/to/report.html');
      expect(result.reason).toContain('xdg-open');
      expect(result.reason).toContain('no está instalado');
    });

    it('returns opened: false when xdg-open exits with non-zero code and captures stderr', async () => {
      const mockChild = new MockChildProcess();
      const mockSpawn = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          mockChild.stderr.emit('data', Buffer.from('no method available for opening file\n'));
          mockChild.emit('close', 2, null);
        }, 5);
        return mockChild;
      }) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({
        openerCommand: 'xdg-open',
        spawnFn: mockSpawn,
      });

      const result = await opener.openLocalReport('/path/to/report.html');
      expect(result.opened).toBe(false);
      expect(result.reportPath).toBe('/path/to/report.html');
      expect(result.reason).toContain('código de error 2');
      expect(result.reason).toContain('no method available for opening file');
    });

    it('SECURITY: strictly prevents shell injection by passing raw paths with metacharacters directly without shell', async () => {
      const dangerousPath = '/path/with spaces/and; rm -rf /; $(evil)/report & test.html';
      const mockChild = new MockChildProcess();
      const mockSpawn = vi.fn().mockImplementation(() => {
        setTimeout(() => mockChild.emit('close', 0, null), 5);
        return mockChild;
      }) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({ spawnFn: mockSpawn });
      await opener.openLocalReport(dangerousPath);

      expect(mockSpawn).toHaveBeenCalledWith('xdg-open', [dangerousPath], {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    });

    it('immediately rejects with AbortError when options.signal is already aborted', async () => {
      const mockSpawn = vi.fn() as unknown as SpawnFunction;
      const opener = new NodeXdgReportOpener({ spawnFn: mockSpawn });

      const controller = new AbortController();
      controller.abort('Cancelled');

      await expect(
        opener.openLocalReport('/path/to/report.html', { signal: controller.signal }),
      ).rejects.toThrow('This operation was aborted');

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('kills spawned child process and rejects when signal aborts during execution', async () => {
      const mockChild = new MockChildProcess();
      const mockSpawn = vi.fn().mockReturnValue(mockChild) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({ spawnFn: mockSpawn });
      const controller = new AbortController();

      const openPromise = opener.openLocalReport('/path/to/report.html', {
        signal: controller.signal,
      });

      // Abort in flight
      controller.abort('Abort in flight');

      await expect(openPromise).rejects.toThrow('This operation was aborted');
      expect(mockChild.killed).toBe(true);
    });

    it('handles synchronous spawn errors without crashing', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        throw new Error('Immediate spawn failure');
      }) as unknown as SpawnFunction;

      const opener = new NodeXdgReportOpener({ spawnFn: mockSpawn });
      const result = await opener.openLocalReport('/path/to/report.html');

      expect(result.opened).toBe(false);
      expect(result.reason).toContain('Immediate spawn failure');
    });
  });

  describe('FakeReportOpener', () => {
    it('records opened reports and returns simulated success by default', async () => {
      const fake = new FakeReportOpener();
      const res = await fake.openLocalReport('/mock/report.html');

      expect(res).toEqual({
        opened: true,
        reportPath: '/mock/report.html',
      });
      expect(fake.openedReports).toEqual(['/mock/report.html']);
    });

    it('returns simulated failure when configured', async () => {
      const fake = new FakeReportOpener({
        shouldSucceed: false,
        failureReason: 'Browser disabled in test environment',
      });

      const res = await fake.openLocalReport('/mock/report.html');
      expect(res).toEqual({
        opened: false,
        reportPath: '/mock/report.html',
        reason: 'Browser disabled in test environment',
      });
    });

    it('respects AbortSignal', async () => {
      const fake = new FakeReportOpener();
      const controller = new AbortController();
      controller.abort();

      await expect(
        fake.openLocalReport('/mock/report.html', { signal: controller.signal }),
      ).rejects.toThrow('This operation was aborted');
    });
  });
});
