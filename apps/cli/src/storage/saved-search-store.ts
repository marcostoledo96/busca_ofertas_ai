import * as fs from 'node:fs';
import * as path from 'node:path';
import { CliError } from '../runtime/errors.js';
import { EXIT_CODES } from '../runtime/exit-codes.js';
import { resolveXdgAppPaths } from '../platform/xdg-paths.js';

export const KEBAB_CASE_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WriteSearchOptions {
  readonly overwrite?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface RemoveSearchOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * SavedSearchConfigStore represents the persistence seam for saved search configurations.
 * Manages storage of YAML configurations by ID within an isolated, validated storage root.
 */
export interface SavedSearchConfigStore {
  list(): Promise<readonly string[]>;
  read(id: string): Promise<string | null>;
  write(id: string, yamlContent: string, options?: WriteSearchOptions): Promise<void>;
  remove(id: string, options?: RemoveSearchOptions): Promise<void>;
  exists(id: string): Promise<boolean>;
  resolvePath(id: string): string;
}

/**
 * Validates search ID for kebab-case format and path-traversal safety.
 */
export function validateSearchId(id: string): void {
  if (!id || typeof id !== 'string' || !KEBAB_CASE_ID_REGEX.test(id)) {
    throw new CliError({
      code: 'INVALID_SEARCH_ID',
      userMessage: `El ID de búsqueda "${id}" no es válido. Debe ser kebab-case en minúsculas (ej: mi-busqueda-1).`,
      suggestedAction: 'Usá letras minúsculas, números y guiones medios (sin espacios ni barras).',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    throw new CliError({
      code: 'PATH_TRAVERSAL_DETECTED',
      userMessage: `El ID de búsqueda "${id}" contiene caracteres prohibidos o intentos de path traversal.`,
      suggestedAction: 'Especificá un identificador simple sin rutas ni separadores de directorio.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }
}

/**
 * Node.js filesystem implementation of SavedSearchConfigStore.
 * Ensures atomic writes, directory isolation, and race-free exclusive writes.
 */
export class NodeFileSystemSavedSearchConfigStore implements SavedSearchConfigStore {
  public readonly storageRoot: string;

  constructor(storageRoot?: string) {
    this.storageRoot = path.resolve(storageRoot ?? resolveXdgAppPaths().searchesDir);
  }

  public resolvePath(id: string): string {
    validateSearchId(id);
    const targetFile = `${id}.yml`;
    const resolved = path.resolve(this.storageRoot, targetFile);

    // Defense-in-depth: Ensure resolved path strictly stays inside storageRoot
    const relative = path.relative(this.storageRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative !== targetFile) {
      throw new CliError({
        code: 'PATH_TRAVERSAL_DETECTED',
        userMessage: `El ID "${id}" intenta resolver fuera del directorio seguro de almacenamiento.`,
        suggestedAction: 'Utilizá un ID válido en kebab-case sin separadores de ruta.',
        exitCode: EXIT_CODES.INVALID_CONFIGURATION,
      });
    }

    return resolved;
  }

  private async ensureStorageRoot(): Promise<void> {
    try {
      await fs.promises.mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
      try {
        await fs.promises.chmod(this.storageRoot, 0o700);
      } catch (chmodErr) {
        if (
          chmodErr instanceof Error &&
          'code' in chmodErr &&
          (chmodErr as { code: string }).code === 'EPERM' &&
          process.platform === 'win32'
        ) {
          // Ignore Windows permission limitation
        } else {
          throw chmodErr;
        }
      }
    } catch (err) {
      if (err instanceof CliError) {
        throw err;
      }
      throw new CliError({
        code: 'DIRECTORY_PERMISSION_FAILED',
        userMessage: `No se pudieron asegurar los permisos privados (0700) del directorio de almacenamiento: ${this.storageRoot}`,
        suggestedAction:
          'Verificá que tu usuario sea propietario del directorio y tenga permisos suficientes de lectura y escritura.',
        exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        cause: err,
      });
    }
  }

  public async list(): Promise<readonly string[]> {
    await this.ensureStorageRoot();
    try {
      const entries = await fs.promises.readdir(this.storageRoot, { withFileTypes: true });
      const ids: string[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.yml') && !entry.name.includes('.tmp.')) {
          const id = entry.name.slice(0, -4);
          if (KEBAB_CASE_ID_REGEX.test(id)) {
            ids.push(id);
          }
        }
      }

      ids.sort();
      return ids;
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  public async exists(id: string): Promise<boolean> {
    const targetPath = this.resolvePath(id);
    try {
      const stats = await fs.promises.stat(targetPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  public async read(id: string): Promise<string | null> {
    const targetPath = this.resolvePath(id);
    try {
      return await fs.promises.readFile(targetPath, 'utf-8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  public async write(id: string, yamlContent: string, options?: WriteSearchOptions): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    await this.ensureStorageRoot();
    const targetPath = this.resolvePath(id);
    const overwrite = options?.overwrite ?? false;

    // Temporary file placed in the exact same directory for atomic filesystem operations
    const randSuffix = Math.random().toString(36).slice(2, 10);
    const tempPath = `${targetPath}.tmp.${Date.now()}.${randSuffix}`;

    try {
      // 1. Write content to temp file with restrictive permissions (0o600)
      await fs.promises.writeFile(tempPath, yamlContent, {
        encoding: 'utf-8',
        mode: 0o600,
        signal: options?.signal,
      });

      // 2. Check signal immediately before mutating the permanent target
      if (options?.signal?.aborted) {
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      if (!overwrite) {
        // Enforce hardened POSIX-exclusive creation: link fails atomically if targetPath exists
        try {
          await fs.promises.link(tempPath, targetPath);
        } catch (linkErr) {
          if (
            linkErr instanceof Error &&
            'code' in linkErr &&
            (linkErr as { code: string }).code === 'EEXIST'
          ) {
            throw new CliError({
              code: 'SEARCH_ALREADY_EXISTS',
              userMessage: `Ya existe una búsqueda guardada con ID "${id}".`,
              suggestedAction: 'Elegí otro ID o confirmá la sobrescritura explícitamente.',
              exitCode: EXIT_CODES.INVALID_CONFIGURATION,
            });
          }
          throw linkErr;
        } finally {
          // Clean up the temporary link origin
          try {
            await fs.promises.unlink(tempPath);
          } catch {
            // Ignore temp unlink error if link succeeded
          }
        }
      } else {
        // Overwrite mode: atomic rename replacing target
        await fs.promises.rename(tempPath, targetPath);
      }
    } catch (err) {
      // Best-effort cleanup of temporary file
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Suppress cleanup error
      }
      throw err;
    }
  }

  public async remove(id: string, options?: RemoveSearchOptions): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const targetPath = this.resolvePath(id);
    try {
      await fs.promises.unlink(targetPath);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return; // Idempotent remove if file does not exist
      }
      throw err;
    }
  }
}

/**
 * In-memory implementation of SavedSearchConfigStore for unit and integration testing.
 */
export class InMemorySavedSearchConfigStore implements SavedSearchConfigStore {
  private readonly storage = new Map<string, string>();
  private readonly storageRoot: string;

  constructor(storageRoot = '/in-memory/config/searches') {
    this.storageRoot = storageRoot;
  }

  public resolvePath(id: string): string {
    validateSearchId(id);
    return path.join(this.storageRoot, `${id}.yml`);
  }

  public list(): Promise<readonly string[]> {
    const ids = Array.from(this.storage.keys()).sort();
    return Promise.resolve(ids);
  }

  public exists(id: string): Promise<boolean> {
    validateSearchId(id);
    return Promise.resolve(this.storage.has(id));
  }

  public read(id: string): Promise<string | null> {
    validateSearchId(id);
    const content = this.storage.get(id);
    return Promise.resolve(content ?? null);
  }

  public write(id: string, yamlContent: string, options?: WriteSearchOptions): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    validateSearchId(id);
    const overwrite = options?.overwrite ?? false;

    if (!overwrite && this.storage.has(id)) {
      return Promise.reject(
        new CliError({
          code: 'SEARCH_ALREADY_EXISTS',
          userMessage: `Ya existe una búsqueda guardada con ID "${id}".`,
          suggestedAction: 'Elegí otro ID o confirmá la sobrescritura explícitamente.',
          exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        }),
      );
    }

    this.storage.set(id, yamlContent);
    return Promise.resolve();
  }

  public remove(id: string, options?: RemoveSearchOptions): Promise<void> {
    if (options?.signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    }

    validateSearchId(id);
    this.storage.delete(id);
    return Promise.resolve();
  }
}
