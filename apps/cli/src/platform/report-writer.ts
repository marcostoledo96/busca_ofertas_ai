import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CliError } from '../runtime/errors.js';
import { EXIT_CODES } from '../runtime/exit-codes.js';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_REPORT_FILE_MODE = 0o600;

export interface ResolveRunOutputDirectoryOptions {
  readonly reportsDir: string;
  readonly searchName: string;
  readonly runId: string;
  readonly startedAt: string | Date;
}

export interface PersistReportHtmlOptions {
  readonly reportsDir: string;
  readonly searchName: string;
  readonly runId: string;
  readonly startedAt: string | Date;
  readonly htmlContent: string;
  readonly signal?: AbortSignal | undefined;
}

export interface PersistedReportLocation {
  readonly reportDirectory: string;
  readonly reportPath: string;
}

export interface PersistRunExportsOptions {
  readonly reportsDir: string;
  readonly searchName: string;
  readonly runId: string;
  readonly startedAt: string | Date;
  readonly jsonContent: string;
  readonly csvContent: string;
  readonly signal?: AbortSignal | undefined;
  readonly _testCommitHook?:
    ((stage: 'before_csv_commit' | 'after_json_commit') => void | Promise<void>) | undefined;
}

export interface PersistedRunExportsLocation {
  readonly exportDirectory: string;
  readonly jsonPath: string;
  readonly csvPath: string;
}

/**
 * Generates a sanitized, URL/filesystem-safe slug from a search name.
 * Disallows path traversal, control characters, slashes, and diacritics.
 */
export function generateSearchSlug(searchName: string): string {
  if (!searchName || typeof searchName !== 'string') {
    return 'busqueda';
  }

  const normalized = searchName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) {
    return 'busqueda';
  }

  return normalized.slice(0, 40);
}

/**
 * Derives a deterministic, filesystem-safe run ID segment from the complete original runId.
 * Incorporates a human-readable safe prefix and the complete 64-hex SHA-256 digest of the entire ID,
 * providing deterministic cryptographic collision resistance while preserving a readable safe prefix.
 */
export function sanitizeShortRunId(runId: string): string {
  if (!runId || typeof runId !== 'string') {
    return 'run-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }

  const safePrefix = runId
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 12);

  const prefix = safePrefix.length > 0 ? safePrefix : 'run';
  const digest = crypto.createHash('sha256').update(runId, 'utf8').digest('hex');
  return `${prefix}-${digest}`;
}

/**
 * Formats a Date or ISO timestamp string deterministically as YYYY-MM-DD_HH-mm-ss in UTC.
 * Throws CliError if startedAt is missing, unparseable or represents an invalid Date.
 */
export function formatRunTimestamp(startedAt: string | Date): string {
  const date = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new CliError({
      code: 'INVALID_STARTED_AT',
      userMessage: `Fecha de inicio de ejecución inválida para generar reporte: '${String(startedAt)}'`,
      suggestedAction:
        'Verificá que el timestamp de inicio de la ejecución sea una fecha ISO válida.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

async function safeChmod(targetPath: string, mode: number): Promise<void> {
  try {
    await fs.promises.chmod(targetPath, mode);
  } catch (err) {
    // Gracefully handle Windows filesystem limitations where chmod is unsupported
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'EPERM' &&
      process.platform === 'win32'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Resolves the deterministic run output directory under reportsDir.
 *
 * Preserves the exact BOAI-013 directory naming and containment contract:
 * <timestamp>_<search-slug>_<safe-prefix-sha256>
 */
export function resolveRunOutputDirectory(options: ResolveRunOutputDirectoryOptions): string {
  const { reportsDir, searchName, runId, startedAt } = options;

  const timestampPart = formatRunTimestamp(startedAt);
  const slugPart = generateSearchSlug(searchName);
  const shortIdPart = sanitizeShortRunId(runId);

  const dirName = `${timestampPart}_${slugPart}_${shortIdPart}`;

  const normalizedReportsDir = path.resolve(reportsDir);
  const resolvedDir = path.resolve(normalizedReportsDir, dirName);

  // Path containment check: ensure resolvedDir is strictly inside normalizedReportsDir
  if (
    resolvedDir === normalizedReportsDir ||
    !resolvedDir.startsWith(normalizedReportsDir + path.sep)
  ) {
    throw new CliError({
      code: 'PATH_TRAVERSAL_DETECTED',
      userMessage: 'La ruta de destino del reporte escapa del directorio seguro de reportes.',
      suggestedAction: 'Verificá los parámetros de búsqueda e identificador de ejecución.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  return resolvedDir;
}

/**
 * Persists report.html inside a run-specific private directory under reportsDir.
 *
 * Guarantees:
 * - Deterministic directory name: <timestamp>_<search-slug>_<short-run-id>
 * - Strict containment within reportsDir (defends against path traversal attacks).
 * - Run directory created with mode 0700.
 * - report.html created with mode 0600.
 * - Atomic write via temporary file and rename; temporary files cleaned up on failure.
 */
export async function persistReportHtml(
  options: PersistReportHtmlOptions,
): Promise<PersistedReportLocation> {
  const { reportsDir, searchName, runId, startedAt, htmlContent, signal } = options;

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const resolvedDir = resolveRunOutputDirectory({
    reportsDir,
    searchName,
    runId,
    startedAt,
  });

  const resolvedFile = path.resolve(resolvedDir, 'report.html');
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
    throw new CliError({
      code: 'PATH_TRAVERSAL_DETECTED',
      userMessage: 'La ruta de destino del archivo HTML escapa del directorio seguro de ejecución.',
      suggestedAction: 'Verificá los parámetros de búsqueda e identificador de ejecución.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  // Ensure target directory with 0700
  await fs.promises.mkdir(resolvedDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await safeChmod(resolvedDir, PRIVATE_DIRECTORY_MODE);

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  // Atomic write via temp file in the same directory
  const randSuffix = Math.random().toString(36).slice(2, 10);
  const tempPath = path.join(resolvedDir, `report.html.tmp.${Date.now()}.${randSuffix}`);

  try {
    await fs.promises.writeFile(tempPath, htmlContent, {
      encoding: 'utf-8',
      mode: PRIVATE_REPORT_FILE_MODE,
      signal,
    });

    await safeChmod(tempPath, PRIVATE_REPORT_FILE_MODE);

    if (signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    await fs.promises.rename(tempPath, resolvedFile);
    await safeChmod(resolvedFile, PRIVATE_REPORT_FILE_MODE);

    return {
      reportDirectory: resolvedDir,
      reportPath: resolvedFile,
    };
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch {
      // Suppress temp unlink error
    }
    throw err;
  }
}

/**
 * Persists results.json and results.csv as an atomic pair with controlled-failure pair consistency.
 *
 * Guarantees:
 * - Shares the exact same directory as report.html.
 * - Enforces mode 0700 on directory and mode 0600 on both export files.
 * - Both temp files are completely written before commit begins.
 * - Controlled-failure recovery: if commit fails mid-way, previous export pair is restored
 *   or partial fresh files are removed. No intermediate broken state (JSON V2 + CSV V1).
 * - Does not modify or overwrite report.html.
 */
export async function persistRunExports(
  options: PersistRunExportsOptions,
): Promise<PersistedRunExportsLocation> {
  const {
    reportsDir,
    searchName,
    runId,
    startedAt,
    jsonContent,
    csvContent,
    signal,
    _testCommitHook,
  } = options;

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const exportDirectory = resolveRunOutputDirectory({
    reportsDir,
    searchName,
    runId,
    startedAt,
  });

  const jsonPath = path.resolve(exportDirectory, 'results.json');
  if (!jsonPath.startsWith(exportDirectory + path.sep)) {
    throw new CliError({
      code: 'PATH_TRAVERSAL_DETECTED',
      userMessage: 'La ruta de destino del archivo JSON escapa del directorio seguro de ejecución.',
      suggestedAction: 'Verificá los parámetros de búsqueda e identificador de ejecución.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  const csvPath = path.resolve(exportDirectory, 'results.csv');
  if (!csvPath.startsWith(exportDirectory + path.sep)) {
    throw new CliError({
      code: 'PATH_TRAVERSAL_DETECTED',
      userMessage: 'La ruta de destino del archivo CSV escapa del directorio seguro de ejecución.',
      suggestedAction: 'Verificá los parámetros de búsqueda e identificador de ejecución.',
      exitCode: EXIT_CODES.INVALID_CONFIGURATION,
    });
  }

  // Ensure target directory with 0700
  await fs.promises.mkdir(exportDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await safeChmod(exportDirectory, PRIVATE_DIRECTORY_MODE);

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const randSuffix = Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  const jsonTempPath = path.join(exportDirectory, `results.json.tmp.${now}.${randSuffix}`);
  const csvTempPath = path.join(exportDirectory, `results.csv.tmp.${now}.${randSuffix}`);

  const jsonBackupPath = path.join(exportDirectory, `results.json.bak.${now}.${randSuffix}`);
  const csvBackupPath = path.join(exportDirectory, `results.csv.bak.${now}.${randSuffix}`);

  let jsonBackedUp = false;
  let csvBackedUp = false;
  let jsonCommitted = false;
  let csvCommitted = false;

  try {
    // 1. Write JSON temp with 0600
    await fs.promises.writeFile(jsonTempPath, jsonContent, {
      encoding: 'utf-8',
      mode: PRIVATE_REPORT_FILE_MODE,
      signal,
    });
    await safeChmod(jsonTempPath, PRIVATE_REPORT_FILE_MODE);

    if (signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    // 2. Write CSV temp with 0600
    await fs.promises.writeFile(csvTempPath, csvContent, {
      encoding: 'utf-8',
      mode: PRIVATE_REPORT_FILE_MODE,
      signal,
    });
    await safeChmod(csvTempPath, PRIVATE_REPORT_FILE_MODE);

    if (signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    // 3. Backup existing files if present
    if (fs.existsSync(jsonPath)) {
      await fs.promises.rename(jsonPath, jsonBackupPath);
      jsonBackedUp = true;
    }
    if (fs.existsSync(csvPath)) {
      await fs.promises.rename(csvPath, csvBackupPath);
      csvBackedUp = true;
    }

    // 4. Commit JSON
    await fs.promises.rename(jsonTempPath, jsonPath);
    await safeChmod(jsonPath, PRIVATE_REPORT_FILE_MODE);
    jsonCommitted = true;

    if (_testCommitHook) {
      await _testCommitHook('after_json_commit');
    }

    if (signal?.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (_testCommitHook) {
      await _testCommitHook('before_csv_commit');
    }

    // 5. Commit CSV
    await fs.promises.rename(csvTempPath, csvPath);
    await safeChmod(csvPath, PRIVATE_REPORT_FILE_MODE);
    csvCommitted = true;

    // 6. Cleanup backups on success
    if (jsonBackedUp && fs.existsSync(jsonBackupPath)) {
      await fs.promises.unlink(jsonBackupPath);
    }
    if (csvBackedUp && fs.existsSync(csvBackupPath)) {
      await fs.promises.unlink(csvBackupPath);
    }

    return {
      exportDirectory,
      jsonPath,
      csvPath,
    };
  } catch (err) {
    // Controlled failure recovery
    try {
      // Remove newly committed partial JSON if CSV commit failed
      if (jsonCommitted && !csvCommitted) {
        if (fs.existsSync(jsonPath)) {
          await fs.promises.unlink(jsonPath);
        }
      }

      // Restore old backups if they existed
      if (jsonBackedUp && fs.existsSync(jsonBackupPath)) {
        await fs.promises.rename(jsonBackupPath, jsonPath);
        await safeChmod(jsonPath, PRIVATE_REPORT_FILE_MODE);
      }
      if (csvBackedUp && fs.existsSync(csvBackupPath)) {
        await fs.promises.rename(csvBackupPath, csvPath);
        await safeChmod(csvPath, PRIVATE_REPORT_FILE_MODE);
      }

      // Cleanup remaining temp files
      if (fs.existsSync(jsonTempPath)) {
        await fs.promises.unlink(jsonTempPath);
      }
      if (fs.existsSync(csvTempPath)) {
        await fs.promises.unlink(csvTempPath);
      }
    } catch {
      // Best-effort cleanup
    }

    throw err;
  }
}
