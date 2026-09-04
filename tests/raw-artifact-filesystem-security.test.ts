import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ArtifactIdentityCollisionError,
  ArtifactPathTraversalError,
  ArtifactStorageError,
  ArtifactSymlinkEscapeError,
  DiskFullError,
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

    it('fails closed with ArtifactIdentityCollisionError if destination appears concurrently right before link (MEDIUM-03)', async () => {
      const relPath = '2026-09/art_race_collision.txt';
      const destinationPath = path.join(tempDir, relPath);
      const initialBytes = new TextEncoder().encode('initial-winner');
      const lateBytes = new TextEncoder().encode('late-loser');

      const originalLink = fs.promises.link;
      const linkSpy = vi.spyOn(fs.promises, 'link').mockImplementation(async (src, dest) => {
        // Simulate race condition: another process creates destination right before link
        await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(destinationPath, initialBytes);
        return originalLink(src, dest); // Will fail with EEXIST
      });

      try {
        await expect(adapter.writeSanitizedFile(relPath, lateBytes)).rejects.toThrow(
          ArtifactIdentityCollisionError,
        );

        // Verify initial winner content was preserved untouched
        const currentBytes = await adapter.readSanitizedFile(relPath);
        expect(currentBytes).toEqual(initialBytes);

        // Verify no orphan temp files remain in .tmp
        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir);
        expect(tmpEntries).toEqual([]);
      } finally {
        linkSpy.mockRestore();
      }
    });

    describe('Post-Publication Staging Cleanup & Recovery (MEDIUM-A)', () => {
      it('retries unlink when first attempt fails with EPERM and converges to single destination', async () => {
        const relPath = '2026-09/art_retry_unlink.txt';
        const bytes = new TextEncoder().encode('retry unlink content');

        const originalUnlink = fs.promises.unlink;
        let attempts = 0;
        const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async (filePath) => {
          if (String(filePath).includes('.tmp') && String(filePath).endsWith('.tmp')) {
            attempts++;
            if (attempts === 1) {
              const err = Object.assign(new Error('EPERM: operation not permitted'), {
                code: 'EPERM',
              });
              throw err;
            }
          }
          return originalUnlink(filePath);
        });

        try {
          const res = await adapter.writeSanitizedFile(relPath, bytes);
          expect(res.sizeBytes).toBe(bytes.length);
          expect(attempts).toBe(2); // First failed, second succeeded

          // Verify destination exists with exact bytes
          const readBack = await adapter.readSanitizedFile(relPath);
          expect(readBack).toEqual(bytes);

          // Verify staging has 0 temp files
          const tmpDir = path.join(tempDir, '.tmp');
          const tmpEntries = await fs.promises.readdir(tmpDir);
          expect(tmpEntries).toEqual([]);
        } finally {
          unlinkSpy.mockRestore();
        }
      });

      it('rolls back destination and throws ARTIFACT_STAGING_CLEANUP_FAILED if temp cannot be unlinked', async () => {
        const relPath = '2026-09/art_permanent_unlink_fail.txt';
        const destinationPath = path.join(tempDir, relPath);
        const bytes = new TextEncoder().encode('unremovable temp content');

        const originalUnlink = fs.promises.unlink;
        const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async (filePath) => {
          if (String(filePath).includes('.tmp') && String(filePath).endsWith('.tmp')) {
            const err = Object.assign(new Error('EIO: input/output error'), { code: 'EIO' });
            throw err;
          }
          return originalUnlink(filePath);
        });

        try {
          let thrown: unknown;
          try {
            await adapter.writeSanitizedFile(relPath, bytes);
          } catch (err: unknown) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ArtifactStorageError);
          expect((thrown as ArtifactStorageError).code).toBe('ARTIFACT_STAGING_CLEANUP_FAILED');

          // Destination must be rolled back: 0 published destination files
          expect(fs.existsSync(destinationPath)).toBe(false);
          const readBack = await adapter.readSanitizedFile(relPath);
          expect(readBack).toBeNull();
        } finally {
          unlinkSpy.mockRestore();
        }
      });

      it('throws ARTIFACT_COMPENSATION_FAILED if unlinking temp fails and destination rollback also fails', async () => {
        const relPath = '2026-09/art_comp_fail.txt';
        const bytes = new TextEncoder().encode('double failure content');

        const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(() => {
          return Promise.reject(
            Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
          );
        });

        try {
          let thrown: unknown;
          try {
            await adapter.writeSanitizedFile(relPath, bytes);
          } catch (err: unknown) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ArtifactStorageError);
          expect((thrown as ArtifactStorageError).code).toBe('ARTIFACT_COMPENSATION_FAILED');
        } finally {
          unlinkSpy.mockRestore();
        }
      });

      it('scavenges application temporary files safely while preserving foreign canaries and symlinks', async () => {
        const tmpDir = path.join(tempDir, '.tmp');
        await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });

        // 1. Seed legitimate application temporary files
        const appTemp1 = path.join(tmpDir, 'tmp_11111111-2222-3333-4444-555555555555.tmp');
        const appTemp2 = path.join(tmpDir, 'tmp_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.tmp');
        await fs.promises.writeFile(appTemp1, 'stale app temp 1', { mode: 0o600 });
        await fs.promises.writeFile(appTemp2, 'stale app temp 2', { mode: 0o600 });

        // 2. Seed foreign canary file that MUST NOT be touched
        const foreignCanary = path.join(tmpDir, 'canary_foreign.txt');
        await fs.promises.writeFile(foreignCanary, 'CANARY_MUST_SURVIVE', { mode: 0o600 });

        // 3. Seed external target directory and symlink inside .tmp that MUST NOT be deleted or followed
        const externalCanaryDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'boai-scavenge-canary-'),
        );
        const externalCanaryFile = path.join(externalCanaryDir, 'external_canary.txt');
        await fs.promises.writeFile(externalCanaryFile, 'EXTERNAL_CANARY_CONTENT');
        const symlinkInTmp = path.join(tmpDir, 'tmp_symlink_folder');
        await fs.promises.symlink(externalCanaryDir, symlinkInTmp);

        try {
          const result = await adapter.cleanStagingDirectory();
          expect(result.scanned).toBe(2);
          expect(result.deleted).toBe(2);

          // Verify application temp files were deleted
          expect(fs.existsSync(appTemp1)).toBe(false);
          expect(fs.existsSync(appTemp2)).toBe(false);

          // Verify foreign canary file survived untouched
          expect(fs.existsSync(foreignCanary)).toBe(true);
          const canaryText = await fs.promises.readFile(foreignCanary, 'utf-8');
          expect(canaryText).toBe('CANARY_MUST_SURVIVE');

          // Verify external canary and symlink survived untouched
          expect(fs.existsSync(symlinkInTmp)).toBe(true);
          expect(fs.existsSync(externalCanaryFile)).toBe(true);
          const extCanaryText = await fs.promises.readFile(externalCanaryFile, 'utf-8');
          expect(extCanaryText).toBe('EXTERNAL_CANARY_CONTENT');

          // Idempotent: second run does nothing
          const secondResult = await adapter.cleanStagingDirectory();
          expect(secondResult.scanned).toBe(0);
          expect(secondResult.deleted).toBe(0);
        } finally {
          await fs.promises.rm(symlinkInTmp).catch(() => {});
          await fs.promises.rm(externalCanaryDir, { recursive: true, force: true }).catch(() => {});
        }
      });
    });

    describe('Full Write Loop and Short Writes Protection (MEDIUM-B)', () => {
      it('recovers from partial write in loop to persist full payload with matching readback and size (Case A)', async () => {
        const relPath = '2026-09/art_short_write_success.txt';
        const originalPayload = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_LONG_PAYLOAD_TEST';
        const bytes = new TextEncoder().encode(originalPayload);

        const originalOpen = fs.promises.open;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
          const handle = await originalOpen(...args);
          const originalWrite = handle.write.bind(handle);
          let callCount = 0;
          handle.write = vi.fn(
            (
              buffer: NodeJS.ArrayBufferView,
              offset?: number | null,
              length?: number | null,
              position?: number | null,
            ) => {
              callCount++;
              if (callCount === 1) {
                // Write only first 10 bytes
                const partialLen = Math.min(10, Number(length));
                return originalWrite(buffer, offset, partialLen, position);
              }
              // Subsequent calls write normally
              return originalWrite(buffer, offset, length, position);
            },
          ) as unknown as typeof handle.write;
          return handle;
        });

        try {
          const result = await adapter.writeSanitizedFile(relPath, bytes);
          expect(result.sizeBytes).toBe(bytes.length);

          const readBack = await adapter.readSanitizedFile(relPath);
          expect(readBack).toBeDefined();
          expect(readBack).toEqual(bytes);
          if (!readBack) {
            throw new Error('Expected readBack to be defined');
          }
          expect(new TextDecoder().decode(readBack)).toBe(originalPayload);
        } finally {
          openSpy.mockRestore();
        }
      });

      it('fails closed when partial write is followed by write error, leaving no destination and clean temp (Case B)', async () => {
        const relPath = '2026-09/art_short_write_fail.txt';
        const destinationPath = path.join(tempDir, relPath);
        const bytes = new TextEncoder().encode('Test payload for partial write failure');

        const originalOpen = fs.promises.open;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
          const handle = await originalOpen(...args);
          const originalWrite = handle.write.bind(handle);
          let callCount = 0;
          handle.write = vi.fn(
            (
              buffer: NodeJS.ArrayBufferView,
              offset?: number | null,
              length?: number | null,
              position?: number | null,
            ) => {
              callCount++;
              if (callCount === 1) {
                // Partial write of 5 bytes
                return originalWrite(buffer, offset, 5, position);
              }
              // Second write throws I/O error
              return Promise.reject(
                Object.assign(new Error('EIO: write failure'), { code: 'EIO' }),
              );
            },
          ) as unknown as typeof handle.write;
          return handle;
        });

        try {
          await expect(adapter.writeSanitizedFile(relPath, bytes)).rejects.toThrow(/EIO/);

          // Verify destination was NOT published
          expect(fs.existsSync(destinationPath)).toBe(false);

          // Verify staging has 0 leftover files
          const tmpDir = path.join(tempDir, '.tmp');
          const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
          expect(tmpEntries).toEqual([]);
        } finally {
          openSpy.mockRestore();
        }
      });

      it('converts short write caused by ENOSPC into DiskFullError (Case C)', async () => {
        const relPath = '2026-09/art_short_write_enospc.txt';
        const bytes = new TextEncoder().encode(
          'Payload encountering out of space during short write',
        );

        const originalOpen = fs.promises.open;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
          const handle = await originalOpen(...args);
          const originalWrite = handle.write.bind(handle);
          let callCount = 0;
          handle.write = vi.fn(
            (
              buffer: NodeJS.ArrayBufferView,
              offset?: number | null,
              length?: number | null,
              position?: number | null,
            ) => {
              callCount++;
              if (callCount === 1) {
                // Partial write of 8 bytes
                return originalWrite(buffer, offset, 8, position);
              }
              // Second write hits ENOSPC
              return Promise.reject(
                Object.assign(new Error('ENOSPC: no space left on device'), {
                  code: 'ENOSPC',
                }),
              );
            },
          ) as unknown as typeof handle.write;
          return handle;
        });

        try {
          await expect(adapter.writeSanitizedFile(relPath, bytes)).rejects.toThrow(DiskFullError);

          // Verify staging has 0 leftover files
          const tmpDir = path.join(tempDir, '.tmp');
          const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
          expect(tmpEntries).toEqual([]);
        } finally {
          openSpy.mockRestore();
        }
      });
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

    it('rejects write, read, delete, and exists when artifactsRoot itself is a symlink (HIGH-04)', async () => {
      const externalTargetDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'boai-ext-target-'),
      );
      const canaryFile = path.join(externalTargetDir, 'canary.txt');
      await fs.promises.writeFile(canaryFile, 'CANARY_ROOT_TARGET', 'utf-8');

      const symlinkRootDir = path.join(tempDir, 'symlink_root');
      await fs.promises.symlink(externalTargetDir, symlinkRootDir);

      const symlinkAdapter = new NodeArtifactFileSystemAdapter(symlinkRootDir);
      const testBytes = new TextEncoder().encode('should_never_be_written');

      try {
        await expect(symlinkAdapter.writeSanitizedFile('new_art.txt', testBytes)).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        await expect(symlinkAdapter.readSanitizedFile('canary.txt')).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        await expect(symlinkAdapter.deleteFile('canary.txt')).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        await expect(symlinkAdapter.exists('canary.txt')).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        // Verify canary file remains untouched
        const canaryContent = await fs.promises.readFile(canaryFile, 'utf-8');
        expect(canaryContent).toBe('CANARY_ROOT_TARGET');

        // Verify no new file was created in target dir
        expect(fs.existsSync(path.join(externalTargetDir, 'new_art.txt'))).toBe(false);
      } finally {
        await fs.promises.rm(externalTargetDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('rejects writing when artifactsRoot/.tmp is a symlink (HIGH-04)', async () => {
      const externalTmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-ext-tmp-'));
      const symlinkTmpPath = path.join(tempDir, '.tmp');
      await fs.promises.symlink(externalTmpDir, symlinkTmpPath);

      const testBytes = new TextEncoder().encode('temp_leak_payload');

      try {
        await expect(adapter.writeSanitizedFile('art.txt', testBytes)).rejects.toThrow(
          ArtifactSymlinkEscapeError,
        );

        // Verify external tmp directory remains completely empty
        const extEntries = await fs.promises.readdir(externalTmpDir);
        expect(extEntries).toEqual([]);
      } finally {
        await fs.promises.rm(symlinkTmpPath).catch(() => {});
        await fs.promises.rm(externalTmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe('ENOSPC Fault Injection Across Stages (MEDIUM-04)', () => {
    const makeEnospc = () =>
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });

    it('fails closed with DiskFullError when mkdir root encounters ENOSPC', async () => {
      const mkdirSpy = vi
        .spyOn(fs.promises, 'mkdir')
        .mockImplementationOnce(() => Promise.reject(makeEnospc()));

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );
      } finally {
        mkdirSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError when mkdir .tmp encounters ENOSPC', async () => {
      const originalMkdir = fs.promises.mkdir;
      const mkdirSpy = vi
        .spyOn(fs.promises, 'mkdir')
        .mockImplementation(async (targetPath, opts) => {
          if (String(targetPath).endsWith('.tmp')) {
            throw makeEnospc();
          }
          return originalMkdir(targetPath, opts);
        });

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );
      } finally {
        mkdirSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError and unlinks tmp when open encounters ENOSPC', async () => {
      const openSpy = vi
        .spyOn(fs.promises, 'open')
        .mockImplementationOnce(() => Promise.reject(makeEnospc()));

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );

        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
        expect(tmpEntries).toEqual([]);
      } finally {
        openSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError and unlinks tmp when file write encounters ENOSPC', async () => {
      const originalOpen = fs.promises.open;
      const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
        const handle = await originalOpen(...args);
        vi.spyOn(handle, 'write').mockImplementationOnce(() => Promise.reject(makeEnospc()));
        return handle;
      });

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );

        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
        expect(tmpEntries).toEqual([]);
      } finally {
        openSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError and unlinks tmp when file sync encounters ENOSPC', async () => {
      const originalOpen = fs.promises.open;
      const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
        const handle = await originalOpen(...args);
        vi.spyOn(handle, 'sync').mockImplementationOnce(() => Promise.reject(makeEnospc()));
        return handle;
      });

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );

        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
        expect(tmpEntries).toEqual([]);
      } finally {
        openSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError and unlinks tmp when mkdir targetDir encounters ENOSPC', async () => {
      const originalMkdir = fs.promises.mkdir;
      const mkdirSpy = vi
        .spyOn(fs.promises, 'mkdir')
        .mockImplementation(async (targetPath, opts) => {
          if (String(targetPath).includes('2026-09')) {
            throw makeEnospc();
          }
          return originalMkdir(targetPath, opts);
        });

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );

        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
        expect(tmpEntries).toEqual([]);
      } finally {
        mkdirSpy.mockRestore();
      }
    });

    it('fails closed with DiskFullError and unlinks tmp when link encounters ENOSPC', async () => {
      const linkSpy = vi
        .spyOn(fs.promises, 'link')
        .mockImplementationOnce(() => Promise.reject(makeEnospc()));

      try {
        const bytes = new TextEncoder().encode('data');
        await expect(adapter.writeSanitizedFile('2026-09/art.txt', bytes)).rejects.toThrow(
          DiskFullError,
        );

        const tmpDir = path.join(tempDir, '.tmp');
        const tmpEntries = await fs.promises.readdir(tmpDir).catch(() => []);
        expect(tmpEntries).toEqual([]);
      } finally {
        linkSpy.mockRestore();
      }
    });
  });
});
