import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  NodeFileSystemSavedSearchConfigStore,
  NodeTextFileAdapter,
  isCliError,
} from '@busca-ofertas-ai/cli';

describe('CLI Storage and Transfer Seams (BOAI-007)', () => {
  let tempDir: string;
  let store: NodeFileSystemSavedSearchConfigStore;
  let textPort: NodeTextFileAdapter;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-storage-test-'));
    store = new NodeFileSystemSavedSearchConfigStore(tempDir);
    textPort = new NodeTextFileAdapter();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('NodeFileSystemSavedSearchConfigStore', () => {
    it('uses XDG searchesDir by default when constructed without explicit directory', () => {
      const defaultStore = new NodeFileSystemSavedSearchConfigStore();
      expect(defaultStore.storageRoot.endsWith(path.join('busca-ofertas-ai', 'searches'))).toBe(
        true,
      );
    });

    it('FINDING 1: throws DIRECTORY_PERMISSION_FAILED on POSIX chmod failure and does not continue silently', async () => {
      const chmodSpy = vi
        .spyOn(fs.promises, 'chmod')
        .mockRejectedValueOnce(new Error('EACCES: permission denied'));

      try {
        await expect(store.write('permission-fail', 'test')).rejects.toThrow();

        try {
          await store.write('permission-fail', 'test');
        } catch (err) {
          expect(isCliError(err)).toBe(true);
          if (isCliError(err)) {
            expect(err.code).toBe('DIRECTORY_PERMISSION_FAILED');
            expect(err.userMessage).toContain(
              'No se pudieron asegurar los permisos privados (0700)',
            );
          }
        }
      } finally {
        chmodSpy.mockRestore();
      }
    });

    it('writes and reads a saved search YAML file atomically with 0600 file and 0700 dir permissions', async () => {
      const sampleYaml = 'schemaVersion: 1\nid: test-search\nname: Test\n';
      await store.write('test-search', sampleYaml);

      expect(await store.exists('test-search')).toBe(true);
      const readContent = await store.read('test-search');
      expect(readContent).toBe(sampleYaml);

      if (process.platform !== 'win32') {
        const fileStat = await fs.promises.stat(store.resolvePath('test-search'));
        expect(fileStat.mode & 0o777).toBe(0o600);

        const dirStat = await fs.promises.stat(store.storageRoot);
        expect(dirStat.mode & 0o777).toBe(0o700);
      }

      const list = await store.list();
      expect(list).toEqual(['test-search']);
    });

    it('enforces exclusive write: throws SEARCH_ALREADY_EXISTS when overwrite is false and file exists', async () => {
      const sampleYaml = 'schemaVersion: 1\nid: test-exclusive\n';
      await store.write('test-exclusive', sampleYaml);

      await expect(
        store.write('test-exclusive', 'schemaVersion: 1\nid: new-content\n', { overwrite: false }),
      ).rejects.toThrow();

      try {
        await store.write('test-exclusive', 'schemaVersion: 1\nid: new-content\n', {
          overwrite: false,
        });
      } catch (err) {
        expect(isCliError(err)).toBe(true);
        if (isCliError(err)) {
          expect(err.code).toBe('SEARCH_ALREADY_EXISTS');
        }
      }

      // Original content must remain intact
      expect(await store.read('test-exclusive')).toBe(sampleYaml);
    });

    it('overwrites atomically when overwrite is true', async () => {
      await store.write('test-overwrite', 'original content');
      await store.write('test-overwrite', 'new updated content', { overwrite: true });

      expect(await store.read('test-overwrite')).toBe('new updated content');
    });

    it('removes file safely and idempotently', async () => {
      await store.write('test-delete', 'content');
      expect(await store.exists('test-delete')).toBe(true);

      await store.remove('test-delete');
      expect(await store.exists('test-delete')).toBe(false);

      // Idempotent: removing non-existent file does not throw
      await expect(store.remove('test-delete')).resolves.toBeUndefined();
    });

    it('cleans up temporary files if write is aborted before completion', async () => {
      const abortCtrl = new AbortController();
      abortCtrl.abort('Aborted before write');

      await expect(
        store.write('test-abort', 'content', { signal: abortCtrl.signal }),
      ).rejects.toThrow();

      const files = await fs.promises.readdir(tempDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles).toHaveLength(0);
      expect(await store.exists('test-abort')).toBe(false);
    });
  });

  describe('NodeTextFileAdapter', () => {
    it('reads and writes arbitrary text files with atomic overwrite guarantees', async () => {
      const externalPath = path.join(tempDir, 'external', 'config.yml');
      const content = 'external yaml content';

      await textPort.writeTextFile(externalPath, content);
      expect(await textPort.exists(externalPath)).toBe(true);

      const readBack = await textPort.readTextFile(externalPath);
      expect(readBack).toBe(content);

      // Overwrite check
      await expect(
        textPort.writeTextFile(externalPath, 'new content', { overwrite: false }),
      ).rejects.toThrow();

      await textPort.writeTextFile(externalPath, 'new content', { overwrite: true });
      expect(await textPort.readTextFile(externalPath)).toBe('new content');
    });

    it('throws FILE_NOT_FOUND when reading non-existent file', async () => {
      const missingPath = path.join(tempDir, 'non-existent.yml');
      await expect(textPort.readTextFile(missingPath)).rejects.toThrow();

      try {
        await textPort.readTextFile(missingPath);
      } catch (err) {
        expect(isCliError(err)).toBe(true);
        if (isCliError(err)) {
          expect(err.code).toBe('FILE_NOT_FOUND');
        }
      }
    });
  });
});
