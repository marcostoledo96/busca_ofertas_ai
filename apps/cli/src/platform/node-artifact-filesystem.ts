import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  type ArtifactFileSystemPort,
  ArtifactIdentityCollisionError,
  ArtifactPathTraversalError,
  ArtifactStorageError,
  ArtifactSymlinkEscapeError,
  DiskFullError,
  validateRelativeArtifactPath,
} from '@busca-ofertas-ai/core';

function isEnospc(err: unknown): boolean {
  return (
    err instanceof DiskFullError ||
    (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOSPC')
  );
}

export class NodeArtifactFileSystemAdapter implements ArtifactFileSystemPort {
  private readonly artifactsRoot: string;

  constructor(artifactsRoot: string) {
    this.artifactsRoot = path.resolve(artifactsRoot);
  }

  private async verifyRoot(checkExists = false): Promise<void> {
    try {
      const stat = await fs.promises.lstat(this.artifactsRoot);
      if (stat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifacts root directory '${this.artifactsRoot}' is a symbolic link`,
        );
      }
      if (!stat.isDirectory()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifacts root '${this.artifactsRoot}' is not a directory`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        if (checkExists) {
          throw err;
        }
        return;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  private async verifyTmpDir(tmpDir: string, checkExists = false): Promise<void> {
    try {
      const stat = await fs.promises.lstat(tmpDir);
      if (stat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifacts temporary directory '${tmpDir}' is a symbolic link`,
        );
      }
      if (!stat.isDirectory()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifacts temporary path '${tmpDir}' is not a directory`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        if (checkExists) {
          throw err;
        }
        return;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  /**
   * Resolves and verifies that relativePath is strictly within artifactsRoot and free of traversal or symlinks.
   */
  private async resolveAndVerifyPath(
    relativePath: string,
    checkComponentsExist = false,
  ): Promise<string> {
    try {
      validateRelativeArtifactPath(relativePath);
    } catch (err) {
      throw new ArtifactPathTraversalError(err instanceof Error ? err.message : String(err));
    }

    const resolved = path.resolve(this.artifactsRoot, relativePath);
    const prefix = this.artifactsRoot.endsWith(path.sep)
      ? this.artifactsRoot
      : this.artifactsRoot + path.sep;

    if (!resolved.startsWith(prefix)) {
      throw new ArtifactPathTraversalError(
        `Artifact path '${relativePath}' escapes root directory '${this.artifactsRoot}'`,
      );
    }

    // Verify no symlink traversal in path components
    const relativeParts = path.relative(this.artifactsRoot, resolved).split(path.sep);
    let currentPath = this.artifactsRoot;

    for (const part of relativeParts) {
      currentPath = path.join(currentPath, part);
      try {
        const stat = await fs.promises.lstat(currentPath);
        if (stat.isSymbolicLink()) {
          throw new ArtifactSymlinkEscapeError(
            `Symbolic link detected in artifact path component '${currentPath}'`,
          );
        }
      } catch (err: unknown) {
        if (err instanceof ArtifactSymlinkEscapeError) {
          throw err;
        }
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
          if (checkComponentsExist) {
            return resolved;
          }
          // Component doesn't exist yet, which is normal for writes
          break;
        }
        if (isEnospc(err)) {
          throw new DiskFullError();
        }
        throw err;
      }
    }

    return resolved;
  }

  public async writeSanitizedFile(
    relativePath: string,
    bytes: Uint8Array,
  ): Promise<{ sizeBytes: number }> {
    await this.verifyRoot(false);
    const destinationPath = await this.resolveAndVerifyPath(relativePath, false);

    // 1. Ensure root exists with mode 0700
    try {
      await fs.promises.mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }

    await this.verifyRoot(true);

    // 2. Check if destination already exists (fail closed: zero overwrite)
    try {
      const destStat = await fs.promises.lstat(destinationPath);
      if (destStat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(`Destination '${destinationPath}' is a symbolic link`);
      }
      throw new ArtifactIdentityCollisionError(`Artifact file already exists at '${relativePath}'`);
    } catch (err: unknown) {
      if (
        err instanceof ArtifactIdentityCollisionError ||
        err instanceof ArtifactSymlinkEscapeError
      ) {
        throw err;
      }
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        if (isEnospc(err)) {
          throw new DiskFullError();
        }
        throw err;
      }
    }

    // 3. Stage write in .tmp directory
    const tmpDir = path.join(this.artifactsRoot, '.tmp');
    await this.verifyTmpDir(tmpDir, false);

    try {
      await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }

    await this.verifyTmpDir(tmpDir, true);

    const tmpFileName = `tmp_${crypto.randomUUID()}.tmp`;
    const tmpFilePath = path.join(tmpDir, tmpFileName);

    let handle: fs.promises.FileHandle | null = null;
    try {
      // Create exclusive file with 0600 permissions
      try {
        handle = await fs.promises.open(tmpFilePath, 'wx', 0o600);
      } catch (openErr: unknown) {
        if (isEnospc(openErr)) {
          throw new DiskFullError();
        }
        throw openErr;
      }

      try {
        // Full write loop (MEDIUM-B): persists all bytes and detects short writes deterministically
        let offset = 0;
        while (offset < bytes.length) {
          const remaining = bytes.length - offset;
          const slice = bytes.subarray(offset);
          let writeResult: { bytesWritten: number; buffer: Uint8Array };
          try {
            writeResult = await handle.write(slice, 0, remaining);
          } catch (writeErr: unknown) {
            if (isEnospc(writeErr)) {
              throw new DiskFullError();
            }
            throw writeErr;
          }

          if (writeResult.bytesWritten <= 0) {
            throw new ArtifactStorageError(
              `Short write encountered without progress: wrote ${offset} of ${bytes.length} bytes`,
              'SHORT_WRITE_FAILED',
            );
          }

          offset += writeResult.bytesWritten;
        }

        if (offset !== bytes.length) {
          throw new ArtifactStorageError(
            `Incomplete write: expected ${bytes.length} bytes, wrote ${offset} bytes`,
            'SHORT_WRITE_FAILED',
          );
        }

        try {
          await handle.sync();
        } catch (syncErr: unknown) {
          if (isEnospc(syncErr)) {
            throw new DiskFullError();
          }
          throw syncErr;
        }
      } finally {
        await handle.close();
        handle = null;
      }

      // Ensure destination directory exists
      const targetDir = path.dirname(destinationPath);
      try {
        await fs.promises.mkdir(targetDir, { recursive: true, mode: 0o700 });
      } catch (mkdirErr: unknown) {
        if (isEnospc(mkdirErr)) {
          throw new DiskFullError();
        }
        throw mkdirErr;
      }

      // Verify target directory has no symlinks
      const targetStat = await fs.promises.lstat(targetDir);
      if (targetStat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(`Target directory '${targetDir}' is a symbolic link`);
      }

      // Atomic commit: hard-link temp to destination (atomically fails with EEXIST if destination exists)
      try {
        await fs.promises.link(tmpFilePath, destinationPath);
      } catch (linkErr: unknown) {
        if (
          linkErr instanceof Error &&
          'code' in linkErr &&
          (linkErr as { code: string }).code === 'EEXIST'
        ) {
          throw new ArtifactIdentityCollisionError(
            `Artifact file already exists at '${relativePath}'`,
          );
        }
        if (isEnospc(linkErr)) {
          throw new DiskFullError();
        }
        throw linkErr;
      }

      // Mandatory post-publication protocol (MEDIUM-A):
      // Staging temporary must be unlinked; failure must be observable and rolled back.
      let unlinked = false;
      let lastUnlinkError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.promises.unlink(tmpFilePath);
          unlinked = true;
          break;
        } catch (unlinkErr: unknown) {
          lastUnlinkError = unlinkErr;
          if (
            unlinkErr instanceof Error &&
            'code' in unlinkErr &&
            (unlinkErr as { code: string }).code === 'ENOENT'
          ) {
            unlinked = true;
            break;
          }
        }
      }

      if (!unlinked) {
        // Rollback published destination link to prevent unmanaged duplicate hardlinks
        let rollbackError: unknown = null;
        try {
          await fs.promises.unlink(destinationPath);
        } catch (destErr: unknown) {
          rollbackError = destErr;
        }

        if (rollbackError) {
          throw new ArtifactStorageError(
            `Failed to unlink staging file '${tmpFilePath}' AND failed to rollback destination file '${destinationPath}'`,
            'ARTIFACT_COMPENSATION_FAILED',
            { cause: new AggregateError([lastUnlinkError, rollbackError]) },
          );
        }

        throw new ArtifactStorageError(
          `Failed to unlink staging temporary file '${tmpFilePath}' after link; rolled back destination file '${destinationPath}'`,
          'ARTIFACT_STAGING_CLEANUP_FAILED',
          { cause: lastUnlinkError },
        );
      }

      return { sizeBytes: bytes.length };
    } catch (err: unknown) {
      // Pre-commit cleanup of staging temporary file
      try {
        await fs.promises.unlink(tmpFilePath);
      } catch (cleanErr: unknown) {
        if (!(
          cleanErr instanceof Error &&
          'code' in cleanErr &&
          (cleanErr as { code: string }).code === 'ENOENT'
        )) {
          if (err instanceof Error && !('stagingCleanupError' in err)) {
            Object.assign(err, { stagingCleanupError: cleanErr });
          }
        }
      }

      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  public async readSanitizedFile(relativePath: string): Promise<Uint8Array | null> {
    try {
      await this.verifyRoot(true);
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return null;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }

    const filePath = await this.resolveAndVerifyPath(relativePath, true);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifact path '${relativePath}' resolves to a symbolic link`,
        );
      }
      const buffer = await fs.promises.readFile(filePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return null;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  public async deleteFile(relativePath: string): Promise<boolean> {
    try {
      await this.verifyRoot(true);
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return false;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }

    const filePath = await this.resolveAndVerifyPath(relativePath, true);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifact path '${relativePath}' resolves to a symbolic link`,
        );
      }
      await fs.promises.unlink(filePath);
      return true;
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return false;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  public async exists(relativePath: string): Promise<boolean> {
    try {
      await this.verifyRoot(true);
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return false;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }

    const filePath = await this.resolveAndVerifyPath(relativePath, true);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isSymbolicLink()) {
        throw new ArtifactSymlinkEscapeError(
          `Artifact path '${relativePath}' resolves to a symbolic link`,
        );
      }
      return true;
    } catch (err: unknown) {
      if (err instanceof ArtifactSymlinkEscapeError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return false;
      }
      if (isEnospc(err)) {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  /**
   * Scavenges abandoned application-generated temporary files from .tmp/.
   * Operates strictly within the verified root directory, rejects symlinks,
   * matches only app temporary patterns (tmp_<uuid>.tmp), and ignores foreign files.
   */
  public async cleanStagingDirectory(): Promise<{ scanned: number; deleted: number }> {
    await this.verifyRoot(true);
    const tmpDir = path.join(this.artifactsRoot, '.tmp');
    try {
      await this.verifyTmpDir(tmpDir, true);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return { scanned: 0, deleted: 0 };
      }
      throw err;
    }

    const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
    let scanned = 0;
    let deleted = 0;

    const appTempPattern =
      /^tmp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!appTempPattern.test(entry.name)) {
        continue;
      }

      scanned++;
      const fullPath = path.join(tmpDir, entry.name);
      try {
        const stat = await fs.promises.lstat(fullPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          continue;
        }
        await fs.promises.unlink(fullPath);
        deleted++;
      } catch {
        // Non-fatal per-file error, leave for subsequent pass
      }
    }

    return { scanned, deleted };
  }
}
