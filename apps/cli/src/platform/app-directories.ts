import * as fs from 'node:fs';
import { type AppPaths, type ResolveXdgAppPathsOptions, resolveXdgAppPaths } from './xdg-paths.js';
import { CliError } from '../runtime/errors.js';
import { EXIT_CODES } from '../runtime/exit-codes.js';

export const PRIVATE_DIRECTORY_MODE = 0o700;

function isAppPaths(value: unknown): value is AppPaths {
  return (
    typeof value === 'object' &&
    value !== null &&
    'configRoot' in value &&
    'searchesDir' in value &&
    'dataRoot' in value &&
    'reportsDir' in value &&
    'artifactsDir' in value &&
    'stateRoot' in value &&
    'sessionsDir' in value &&
    'logsDir' in value &&
    'cacheRoot' in value
  );
}

/**
 * Ensures all application-owned XDG directories exist with restrictive private permissions (0700).
 *
 * Enforces:
 * - Creation of configRoot, searchesDir, dataRoot, reportsDir, stateRoot, sessionsDir, logsDir, cacheRoot.
 * - Explicit chmod 0700 on each application-owned directory to harden pre-existing directories.
 * - Never modifies permissions of parent directories (/home/marcos, ~/.config, ~/.local, ~/.cache).
 */
export async function ensureAppDirectories(
  optionsOrPaths?: AppPaths | ResolveXdgAppPathsOptions,
): Promise<AppPaths> {
  const paths = isAppPaths(optionsOrPaths) ? optionsOrPaths : resolveXdgAppPaths(optionsOrPaths);

  const targetDirs = [
    paths.configRoot,
    paths.searchesDir,
    paths.dataRoot,
    paths.reportsDir,
    paths.artifactsDir,
    paths.stateRoot,
    paths.sessionsDir,
    paths.logsDir,
    paths.cacheRoot,
  ];

  for (const dir of targetDirs) {
    try {
      await fs.promises.mkdir(dir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      try {
        await fs.promises.chmod(dir, PRIVATE_DIRECTORY_MODE);
      } catch (chmodErr) {
        // Suppress non-fatal chmod errors on non-POSIX filesystems if dir was created
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
        code: 'DIRECTORY_CREATION_FAILED',
        userMessage: `No se pudo crear o asegurar el directorio privado de la aplicación: ${dir}`,
        suggestedAction:
          'Verificá que tu usuario tenga permisos de lectura y escritura en el directorio de usuario.',
        exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        cause: err,
      });
    }
  }

  return paths;
}
