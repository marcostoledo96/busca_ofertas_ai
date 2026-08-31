import * as fs from 'node:fs';
import * as path from 'node:path';
import { CliError } from '../runtime/errors.js';
import { EXIT_CODES } from '../runtime/exit-codes.js';

export interface ReadTextFileOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface WriteTextFileOptions {
  readonly overwrite?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * TextFilePort represents the abstract seam for reading and writing external files
 * specified by the user (such as importing or exporting search configurations).
 * Decouples presentation/submenu logic from direct filesystem calls.
 */
export interface TextFilePort {
  readTextFile(filePath: string, options?: ReadTextFileOptions): Promise<string>;
  writeTextFile(filePath: string, content: string, options?: WriteTextFileOptions): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  resolvePath(filePath: string): string;
}

/**
 * Node.js filesystem implementation of TextFilePort.
 */
export class NodeTextFileAdapter implements TextFilePort {
  public resolvePath(filePath: string): string {
    return path.resolve(filePath);
  }

  public async exists(filePath: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);
    try {
      const stats = await fs.promises.stat(resolved);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  public async readTextFile(filePath: string, options?: ReadTextFileOptions): Promise<string> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const resolved = this.resolvePath(filePath);
    try {
      return await fs.promises.readFile(resolved, {
        encoding: 'utf-8',
        signal: options?.signal,
      });
    } catch (err) {
      if (options?.signal?.aborted) {
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        throw new CliError({
          code: 'FILE_NOT_FOUND',
          userMessage: `El archivo "${filePath}" no existe o no se puede leer.`,
          suggestedAction: 'Verificá que la ruta al archivo sea correcta y accesible.',
          exitCode: EXIT_CODES.INVALID_CONFIGURATION,
          cause: err,
        });
      }
      throw err;
    }
  }

  public async writeTextFile(
    filePath: string,
    content: string,
    options?: WriteTextFileOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const resolved = this.resolvePath(filePath);
    const overwrite = options?.overwrite ?? false;
    const parentDir = path.dirname(resolved);

    await fs.promises.mkdir(parentDir, { recursive: true });

    if (!overwrite) {
      // Use 'wx' flag for exclusive creation
      try {
        await fs.promises.writeFile(resolved, content, {
          encoding: 'utf-8',
          flag: 'wx',
          mode: 0o644,
          signal: options?.signal,
        });
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'EEXIST') {
          throw new CliError({
            code: 'FILE_ALREADY_EXISTS',
            userMessage: `El archivo de destino "${filePath}" ya existe.`,
            suggestedAction: 'Especificá otra ruta o confirmá la sobrescritura explícitamente.',
            exitCode: EXIT_CODES.INVALID_CONFIGURATION,
            cause: err,
          });
        }
        throw err;
      }
    } else {
      // Overwrite: write to temp file in same directory then rename
      const randSuffix = Math.random().toString(36).slice(2, 10);
      const tempPath = `${resolved}.tmp.${Date.now()}.${randSuffix}`;

      try {
        await fs.promises.writeFile(tempPath, content, {
          encoding: 'utf-8',
          mode: 0o644,
          signal: options?.signal,
        });

        if (options?.signal?.aborted) {
          const abortError = new Error('This operation was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        await fs.promises.rename(tempPath, resolved);
      } catch (err) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // Suppress temp unlink error
        }
        throw err;
      }
    }
  }
}

/**
 * In-memory implementation of TextFilePort for tests.
 */
export class InMemoryTextFileAdapter implements TextFilePort {
  private readonly files = new Map<string, string>();

  public resolvePath(filePath: string): string {
    return path.normalize(filePath);
  }

  public exists(filePath: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);
    return Promise.resolve(this.files.has(resolved));
  }

  public readTextFile(filePath: string, options?: ReadTextFileOptions): Promise<string> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    const resolved = this.resolvePath(filePath);
    const content = this.files.get(resolved);
    if (content === undefined) {
      return Promise.reject(
        new CliError({
          code: 'FILE_NOT_FOUND',
          userMessage: `El archivo "${filePath}" no existe o no se puede leer.`,
          suggestedAction: 'Verificá que la ruta al archivo sea correcta y accesible.',
          exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        }),
      );
    }

    return Promise.resolve(content);
  }

  public writeTextFile(
    filePath: string,
    content: string,
    options?: WriteTextFileOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    const resolved = this.resolvePath(filePath);
    const overwrite = options?.overwrite ?? false;

    if (!overwrite && this.files.has(resolved)) {
      return Promise.reject(
        new CliError({
          code: 'FILE_ALREADY_EXISTS',
          userMessage: `El archivo de destino "${filePath}" ya existe.`,
          suggestedAction: 'Especificá otra ruta o confirmá la sobrescritura explícitamente.',
          exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        }),
      );
    }

    this.files.set(resolved, content);
    return Promise.resolve();
  }
}
