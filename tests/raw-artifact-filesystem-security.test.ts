import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ArtifactIdentityCollisionError,
  ArtifactPathTraversalError,
  ArtifactSymlinkEscapeError,
} from '@busca-ofertas-ai/core';
import { NodeArtifactFileSystemAdapter } from '../apps/cli/src/platform/node-artifact-filesystem.js';

describe('Raw Artifact Filesystem Security & Atomic Operations (BOAI-016)', () => {
  let tempDir: string;
  let adapter: NodeArtifactFileSystemAdapter;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-artifact-fs-test-'));
    adapter = new NodeArtifactFileSystemAdapter(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Restrictive Permissions (0700 dirs, 0600 files)', () => {
    it('creates root, subdirectories with 0700 and files with 0600 permissions on POSIX', async () => {
      const relPath = '2026-09/art_test_1.json';
      const content = new TextEncoder().encode('{"safe":"data"}');

      await adapter.writeSanitizedFile(relPath, content);

      const filePath = path.join(tempDir, relPath);
      const subDir = path.dirname(filePath);

      const fileStat = await fs.promises.stat(filePath);
      const subDirStat = await fs.promises.stat(subDir);
      const rootStat = await fs.promises.stat(tempDir);

      if (process.platform !== 'win32') {
        // 0o600: user rw only (octal 0600)
        expect(fileStat.mode & 0o777).toBe(0o600);
        // 0o700: user rwx only (octal 0700)
        expect(subDirStat.mode & 0o777).toBe(0o700);
        expect(rootStat.mode & 0o777).toBe(0o700);
      }
    });
  });

  describe('Atomic Staging and Identity Collision Protection', () => {
    it('writes content atomically and leaves no orphaned temp files in .tmp', async () => {
      const relPath = '2026-09/art_atomic.txt';
      const bytes = new TextEncoder().encode('atomic content payload');

      const result = await adapter.writeSanitizedFile(relPath, bytes);
      expect(result.sizeBytes).toBe(bytes.length);

      const readBack = await adapter.readSanitizedFile(relPath);
      expect(readBack).toEqual(bytes);

      const tmpDir = path.join(tempDir, '.tmp');
      const tmpEntries = await fs.promises.readdir(tmpDir);
      expect(tmpEntries).toEqual([]); // No leftover temporary files
    });

    it('fails closed with ArtifactIdentityCollisionError on existing destination without overwrite', async () => {
      const relPath = '2026-09/art_collision.txt';
      const initialBytes = new TextEncoder().encode('initial immutable bytes');
      const secondBytes = new TextEncoder().encode('attacker overwrite attempt');

      await adapter.writeSanitizedFile(relPath, initialBytes);

      await expect(adapter.writeSanitizedFile(relPath, secondBytes)).rejects.toThrow(
        ArtifactIdentityCollisionError,
      );

      // Verify original file content was preserved untouched
      const currentBytes = await adapter.readSanitizedFile(relPath);
      expect(currentBytes).toEqual(initialBytes);
    });
  });

  describe('Path Traversal Defense', () => {
    it('rejects absolute paths starting with /', async () => {
      const bytes = new TextEncoder().encode('traversal');
      await expect(adapter.writeSanitizedFile('/etc/passwd', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );
    });

    it('rejects relative paths with .. parent traversal sequences', async () => {
      const bytes = new TextEncoder().encode('traversal');
      await expect(adapter.writeSanitizedFile('../outside.txt', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );

      await expect(adapter.writeSanitizedFile('2026-09/../../outside.txt', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );
    });

    it('rejects backslashes in relative path', async () => {
      const bytes = new TextEncoder().encode('backslash');
      await expect(adapter.writeSanitizedFile('2026-09\\art_sub.txt', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );
    });

    it('rejects control characters and NUL bytes in relative path', async () => {
      const bytes = new TextEncoder().encode('nul');
      await expect(adapter.writeSanitizedFile('2026-09/art\x00_test.txt', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );

      await expect(adapter.writeSanitizedFile('2026-09/art\n_test.txt', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );
    });

    it('rejects empty or whitespace relative path', async () => {
      const bytes = new TextEncoder().encode('empty');
      await expect(adapter.writeSanitizedFile('   ', bytes)).rejects.toThrow(
        ArtifactPathTraversalError,
      );
    });
  });

  describe('Symlink Escape Defense and Canary Preservation', () => {
    it('rejects writing when destination is a symlink and preserves target canary file', async () => {
      const canaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-canary-'));
      const canaryFile = path.join(canaryDir, 'canary.txt');
      await fs.promises.writeFile(canaryFile, 'CANARY_ORIGINAL_CONTENT', 'utf-8');

      try {
        const symlinkDest = path.join(tempDir, 'art_symlink_target.txt');
        await fs.promises.symlink(canaryFile, symlinkDest);

        const bytes = new TextEncoder().encode('MALICIOUS_OVERWRITE');

        await expect(adapter.writeSanitizedFile('art_symlink_target.txt', bytes)).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        // Verify canary was not overwritten
        const canaryContent = await fs.promises.readFile(canaryFile, 'utf-8');
        expect(canaryContent).toBe('CANARY_ORIGINAL_CONTENT');
      } finally {
        await fs.promises.rm(canaryDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('rejects reading or deleting through a symlink in directory component', async () => {
      const canaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-canary-dir-'));
      const canaryFile = path.join(canaryDir, 'sensitive.txt');
      await fs.promises.writeFile(canaryFile, 'SENSITIVE_DATA', 'utf-8');

      try {
        const symlinkDir = path.join(tempDir, 'symlinked_folder');
        await fs.promises.symlink(canaryDir, symlinkDir);

        await expect(adapter.readSanitizedFile('symlinked_folder/sensitive.txt')).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        await expect(adapter.deleteFile('symlinked_folder/sensitive.txt')).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        // Verify canary file was not deleted
        expect(fs.existsSync(canaryFile)).toBe(true);
      } finally {
        await fs.promises.rm(canaryDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
