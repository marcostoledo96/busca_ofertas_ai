import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  type ArtifactFileSystemPort,
  ArtifactIdentityCollisionError,
  ArtifactPathTraversalError,
  ArtifactSymlinkEscapeError,
  DiskFullError,
  validateRelativeArtifactPath,
} from '@busca-ofertas-ai/core';

export class NodeArtifactFileSystemAdapter implements ArtifactFileSystemPort {
  private readonly artifactsRoot: string;

  constructor(artifactsRoot: string) {
    this.artifactsRoot = path.resolve(artifactsRoot);
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
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
          if (checkComponentsExist) {
            return resolved;
          }
          // Component doesn't exist yet, which is normal for writes
          break;
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
    const destinationPath = await this.resolveAndVerifyPath(relativePath, false);

    // Ensure root exists
    await fs.promises.mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 });

    // Check if destination already exists (fail closed: zero overwrite)
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
      // If error is not ENOENT, rethrow
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        throw err;
      }
    }

    // Stage write in .tmp directory
    const tmpDir = path.join(this.artifactsRoot, '.tmp');
    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });

    const tmpFileName = `tmp_${crypto.randomUUID()}.tmp`;
    const tmpFilePath = path.join(tmpDir, tmpFileName);

    let handle: fs.promises.FileHandle | null = null;
    try {
      // Create exclusive file with 0600 permissions
      handle = await fs.promises.open(tmpFilePath, 'wx', 0o600);
      await handle.write(bytes);
      await handle.sync();
      await handle.close();
      handle = null;

      // Ensure destination directory exists
      const targetDir = path.dirname(destinationPath);
      await fs.promises.mkdir(targetDir, { recursive: true, mode: 0o700 });

      // Final pre-commit collision check
      try {
        await fs.promises.lstat(destinationPath);
        throw new ArtifactIdentityCollisionError(
          `Artifact file already exists at '${relativePath}'`,
        );
      } catch (preCommitErr: unknown) {
        if (preCommitErr instanceof ArtifactIdentityCollisionError) {
          throw preCommitErr;
        }
        if (!(
          preCommitErr instanceof Error &&
          'code' in preCommitErr &&
          (preCommitErr as { code: string }).code === 'ENOENT'
        )) {
          throw preCommitErr;
        }
      }

      // Atomic rename
      await fs.promises.rename(tmpFilePath, destinationPath);
      return { sizeBytes: bytes.length };
    } catch (err: unknown) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
      // Cleanup temp file
      await fs.promises.unlink(tmpFilePath).catch(() => {});

      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOSPC') {
        throw new DiskFullError();
      }
      throw err;
    }
  }

  public async readSanitizedFile(relativePath: string): Promise<Uint8Array | null> {
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
      throw err;
    }
  }

  public async deleteFile(relativePath: string): Promise<boolean> {
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
      throw err;
    }
  }

  public async exists(relativePath: string): Promise<boolean> {
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
      throw err;
    }
  }
}
