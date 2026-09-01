import {
  type Run,
  type RunRepository,
  type RunSummary,
  type SourceRun,
  type SourceRunExecutionMetadata,
  type SourceRunMetrics,
  type SourceRunStopReason,
  type CreateRunParams,
  type CreateSourceRunParams,
  createRun,
  createSourceRun,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  StorageCorruptionError,
  RunIdentityCollisionError,
  SourceRunIdentityCollisionError,
} from '../errors/storage-errors.js';
import { sanitizeErrorMessage } from '../sanitization/sanitizer.js';

interface RunRow {
  readonly id: string;
  readonly saved_search_id: string;
  readonly status: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly error: string | null;
}

interface SourceRunRow {
  readonly id: string;
  readonly run_id: string;
  readonly source_id: string;
  readonly collector_id: string | null;
  readonly adapter_version: string;
  readonly status: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly items_count: number | null;
  readonly error: string | null;
  readonly pages_requested: number | null;
  readonly pages_completed: number | null;
  readonly raw_items_count: number | null;
  readonly parsed_items_count: number | null;
  readonly rejected_items_count: number | null;
  readonly stop_reason: string | null;
}

interface RunSummaryRow {
  readonly total_source_runs: number;
  readonly success_count: number;
  readonly zero_results_count: number;
  readonly failed_count: number;
  readonly cancelled_count: number;
  readonly total_items_count: number;
}

const VALID_STOP_REASONS: ReadonlySet<SourceRunStopReason> = new Set([
  'ALL_PAGES_FETCHED',
  'MAX_PAGES_REACHED',
  'MAX_ITEMS_REACHED',
  'NO_MORE_RESULTS',
  'RATE_LIMIT_STOP',
  'USER_ABORTED',
  'DEADLINE_EXCEEDED',
]);

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(
  isoString: string | null,
  fieldName: string,
  entityId: string,
): Date | undefined {
  if (isoString === null || isoString === undefined) {
    return undefined;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new StorageCorruptionError(
      `Corrupted persisted date in '${fieldName}' for entity '${entityId}': '${isoString}' is not valid ISO date`,
    );
  }
  return date;
}

function rehydrateRun(row: RunRow): Run {
  try {
    const startedAt = parseIsoDate(row.started_at, 'started_at', row.id);
    if (!startedAt) {
      throw new StorageCorruptionError(`Corrupted Run '${row.id}': started_at cannot be empty`);
    }
    const finishedAt = parseIsoDate(row.finished_at, 'finished_at', row.id);

    const params: CreateRunParams = {
      id: row.id,
      savedSearchId: row.saved_search_id,
      status: row.status as Run['status'],
      startedAt,
      ...(finishedAt !== undefined ? { finishedAt } : {}),
      ...(row.error !== null && row.error !== undefined ? { error: row.error } : {}),
    };

    return createRun(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Run '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function rehydrateSourceRun(row: SourceRunRow): SourceRun {
  try {
    const startedAt = parseIsoDate(row.started_at, 'started_at', row.id);
    if (!startedAt) {
      throw new StorageCorruptionError(
        `Corrupted SourceRun '${row.id}': started_at cannot be empty`,
      );
    }
    const finishedAt = parseIsoDate(row.finished_at, 'finished_at', row.id);

    const params: CreateSourceRunParams = {
      id: row.id,
      runId: row.run_id,
      sourceId: row.source_id,
      ...(row.collector_id !== null && row.collector_id !== undefined
        ? { collectorId: row.collector_id }
        : {}),
      status: row.status as SourceRun['status'],
      startedAt,
      ...(finishedAt !== undefined ? { finishedAt } : {}),
      ...(row.items_count !== null && row.items_count !== undefined
        ? { itemsCount: Number(row.items_count) }
        : {}),
      ...(row.error !== null && row.error !== undefined ? { error: row.error } : {}),
    };

    return createSourceRun(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted SourceRun '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function validateMetrics(metrics?: SourceRunMetrics): void {
  if (!metrics) return;

  const countKeys: (keyof SourceRunMetrics)[] = [
    'pagesRequested',
    'pagesCompleted',
    'rawItemsCount',
    'parsedItemsCount',
    'rejectedItemsCount',
  ];

  for (const key of countKeys) {
    const val = metrics[key];
    if (val !== undefined) {
      if (typeof val !== 'number' || !Number.isInteger(val) || !Number.isFinite(val) || val < 0) {
        throw new Error(
          `Metric '${key}' must be a non-negative finite integer, got: ${String(val)}`,
        );
      }
    }
  }

  if (metrics.stopReason !== undefined) {
    if (!VALID_STOP_REASONS.has(metrics.stopReason)) {
      throw new Error(`Invalid stopReason: '${String(metrics.stopReason)}'`);
    }
  }
}

export class SqliteRunRepository implements RunRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Run | null> {
    try {
      const stmt = this.db.prepare<RunRow, [string]>(
        `SELECT id, saved_search_id, status, started_at, finished_at, error
         FROM runs
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateRun(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(run: Run): Promise<void> {
    try {
      const startedAtIso = run.startedAt.toISOString();
      const finishedAtIso =
        'finishedAt' in run && run.finishedAt ? run.finishedAt.toISOString() : null;
      const rawError = 'error' in run ? (run as { error?: string }).error : undefined;
      const cleanError = sanitizeErrorMessage(rawError) ?? null;

      this.db.transaction((tx) => {
        const checkStmt = tx.prepare<RunRow, [string]>(
          `SELECT id, saved_search_id, status, started_at, finished_at, error
           FROM runs
           WHERE id = ?`,
        );
        const existing = checkStmt.get(run.id);

        if (existing) {
          const existingStartedAt = new Date(existing.started_at);
          if (
            existing.saved_search_id !== run.savedSearchId ||
            existingStartedAt.getTime() !== run.startedAt.getTime()
          ) {
            throw new RunIdentityCollisionError({
              runId: run.id,
              existingSavedSearchId: existing.saved_search_id,
              attemptingSavedSearchId: run.savedSearchId,
              existingStartedAt,
              attemptingStartedAt: run.startedAt,
            });
          }

          const updateStmt = tx.prepare(
            `UPDATE runs
             SET status = ?, finished_at = ?, error = ?
             WHERE id = ?`,
          );
          updateStmt.run(run.status, finishedAtIso, cleanError, run.id);
        } else {
          const insertStmt = tx.prepare(
            `INSERT INTO runs (id, saved_search_id, status, started_at, finished_at, error)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          insertStmt.run(
            run.id,
            run.savedSearchId,
            run.status,
            startedAtIso,
            finishedAtIso,
            cleanError,
          );
        }
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  saveSourceRun(sourceRun: SourceRun, metadata: SourceRunExecutionMetadata): Promise<void> {
    try {
      if (
        !metadata ||
        typeof metadata.adapterVersion !== 'string' ||
        metadata.adapterVersion.trim().length === 0
      ) {
        throw new Error('SourceRunExecutionMetadata.adapterVersion must be a non-empty string');
      }
      const adapterVersion = metadata.adapterVersion.trim();

      // Mandatory complete metrics for SUCCESS and ZERO_RESULTS_CONFIRMED (Finding A)
      if (sourceRun.status === 'SUCCESS' || sourceRun.status === 'ZERO_RESULTS_CONFIRMED') {
        if (
          !metadata.metrics ||
          metadata.metrics.pagesRequested === undefined ||
          metadata.metrics.pagesCompleted === undefined ||
          metadata.metrics.rawItemsCount === undefined ||
          metadata.metrics.parsedItemsCount === undefined ||
          metadata.metrics.rejectedItemsCount === undefined ||
          metadata.metrics.stopReason === undefined
        ) {
          throw new Error(
            `SourceRun with status '${sourceRun.status}' requires complete execution metrics (pagesRequested, pagesCompleted, rawItemsCount, parsedItemsCount, rejectedItemsCount, stopReason).`,
          );
        }
      }

      validateMetrics(metadata.metrics);

      const startedAtIso = sourceRun.startedAt.toISOString();
      const finishedAtIso =
        'finishedAt' in sourceRun && sourceRun.finishedAt
          ? sourceRun.finishedAt.toISOString()
          : null;
      const rawError = 'error' in sourceRun ? (sourceRun as { error?: string }).error : undefined;
      const cleanError = sanitizeErrorMessage(rawError) ?? null;
      const itemsCount =
        'itemsCount' in sourceRun && sourceRun.itemsCount !== undefined
          ? sourceRun.itemsCount
          : null;
      const collectorId = 'collectorId' in sourceRun ? (sourceRun.collectorId ?? null) : null;

      const pagesRequested = metadata.metrics?.pagesRequested ?? null;
      const pagesCompleted = metadata.metrics?.pagesCompleted ?? null;
      const rawItemsCount = metadata.metrics?.rawItemsCount ?? null;
      const parsedItemsCount = metadata.metrics?.parsedItemsCount ?? null;
      const rejectedItemsCount = metadata.metrics?.rejectedItemsCount ?? null;
      const stopReason = metadata.metrics?.stopReason ?? null;

      this.db.transaction((tx) => {
        const checkStmt = tx.prepare<
          {
            id: string;
            run_id: string;
            source_id: string;
            started_at: string;
            adapter_version: string;
            collector_id: string | null;
          },
          [string]
        >(
          `SELECT id, run_id, source_id, started_at, adapter_version, collector_id
           FROM source_runs
           WHERE id = ?`,
        );
        const existing = checkStmt.get(sourceRun.id);

        if (existing) {
          const existingStartedAt = new Date(existing.started_at);
          if (
            existing.run_id !== sourceRun.runId ||
            existing.source_id !== sourceRun.sourceId ||
            existingStartedAt.getTime() !== sourceRun.startedAt.getTime()
          ) {
            throw new SourceRunIdentityCollisionError({
              sourceRunId: sourceRun.id,
              existingRunId: existing.run_id,
              attemptingRunId: sourceRun.runId,
              existingSourceId: existing.source_id,
              attemptingSourceId: sourceRun.sourceId,
              existingStartedAt,
              attemptingStartedAt: sourceRun.startedAt,
            });
          }

          // Immutable adapterVersion check (Finding C1)
          if (existing.adapter_version !== adapterVersion) {
            throw new SourceRunIdentityCollisionError(
              {
                sourceRunId: sourceRun.id,
                existingAdapterVersion: existing.adapter_version,
                attemptingAdapterVersion: adapterVersion,
              },
              `SourceRun '${sourceRun.id}' immutable adapterVersion collision: existing '${existing.adapter_version}' cannot be modified to '${adapterVersion}'.`,
            );
          }

          // CollectorId provenance transition policy (Finding C2)
          let resolvedCollectorId = existing.collector_id;
          const incomingCollector = metadata.collectorId ?? collectorId;
          if (existing.collector_id !== null) {
            if (
              incomingCollector !== null &&
              incomingCollector !== undefined &&
              incomingCollector !== existing.collector_id
            ) {
              throw new SourceRunIdentityCollisionError(
                {
                  sourceRunId: sourceRun.id,
                  existingCollectorId: existing.collector_id,
                  attemptingCollectorId: incomingCollector,
                },
                `SourceRun '${sourceRun.id}' immutable collectorId collision: existing '${existing.collector_id}' cannot be modified to '${incomingCollector}'.`,
              );
            }
            // If incoming is null/undefined or equals existing, resolvedCollectorId remains existing.collector_id
          } else {
            // NULL -> concrete: permitted
            resolvedCollectorId = incomingCollector ?? null;
          }

          const updateStmt = tx.prepare(
            `UPDATE source_runs
             SET collector_id = ?, adapter_version = ?, status = ?, finished_at = ?,
                 items_count = ?, error = ?, pages_requested = ?, pages_completed = ?,
                 raw_items_count = ?, parsed_items_count = ?, rejected_items_count = ?,
                 stop_reason = ?
             WHERE id = ?`,
          );
          updateStmt.run(
            resolvedCollectorId,
            adapterVersion,
            sourceRun.status,
            finishedAtIso,
            itemsCount,
            cleanError,
            pagesRequested,
            pagesCompleted,
            rawItemsCount,
            parsedItemsCount,
            rejectedItemsCount,
            stopReason,
            sourceRun.id,
          );
        } else {
          const resolvedCollectorId = metadata.collectorId ?? collectorId ?? null;
          const insertStmt = tx.prepare(
            `INSERT INTO source_runs (
              id, run_id, source_id, collector_id, adapter_version, status,
              started_at, finished_at, items_count, error,
              pages_requested, pages_completed, raw_items_count, parsed_items_count,
              rejected_items_count, stop_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          insertStmt.run(
            sourceRun.id,
            sourceRun.runId,
            sourceRun.sourceId,
            resolvedCollectorId,
            adapterVersion,
            sourceRun.status,
            startedAtIso,
            finishedAtIso,
            itemsCount,
            cleanError,
            pagesRequested,
            pagesCompleted,
            rawItemsCount,
            parsedItemsCount,
            rejectedItemsCount,
            stopReason,
          );
        }
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  listSourceRunsByRunId(runId: string): Promise<readonly SourceRun[]> {
    try {
      const stmt = this.db.prepare<SourceRunRow, [string]>(
        `SELECT id, run_id, source_id, collector_id, adapter_version, status,
                started_at, finished_at, items_count, error,
                pages_requested, pages_completed, raw_items_count, parsed_items_count,
                rejected_items_count, stop_reason
         FROM source_runs
         WHERE run_id = ?
         ORDER BY started_at ASC, id ASC`,
      );
      const rows = stmt.all(runId);
      return Promise.resolve(rows.map((row) => rehydrateSourceRun(row)));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  getSummaryByRunId(runId: string): Promise<RunSummary | null> {
    try {
      const runCheckStmt = this.db.prepare<{ id: string }, [string]>(
        `SELECT id FROM runs WHERE id = ?`,
      );
      const runExists = runCheckStmt.get(runId);
      if (!runExists) {
        return Promise.resolve(null);
      }

      const stmt = this.db.prepare<RunSummaryRow, [string]>(
        `SELECT
           COUNT(*) AS total_source_runs,
           SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
           SUM(CASE WHEN status = 'ZERO_RESULTS_CONFIRMED' THEN 1 ELSE 0 END) AS zero_results_count,
           SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count,
           SUM(CASE WHEN status NOT IN ('PENDING', 'RUNNING', 'SUCCESS', 'ZERO_RESULTS_CONFIRMED', 'CANCELLED') THEN 1 ELSE 0 END) AS failed_count,
           COALESCE(SUM(items_count), 0) AS total_items_count
         FROM source_runs
         WHERE run_id = ?`,
      );
      const row = stmt.get(runId);
      if (!row) {
        return Promise.resolve({
          runId,
          totalSourceRuns: 0,
          successCount: 0,
          zeroResultsCount: 0,
          failedCount: 0,
          cancelledCount: 0,
          totalItemsCount: 0,
        });
      }

      return Promise.resolve({
        runId,
        totalSourceRuns: Number(row.total_source_runs ?? 0),
        successCount: Number(row.success_count ?? 0),
        zeroResultsCount: Number(row.zero_results_count ?? 0),
        failedCount: Number(row.failed_count ?? 0),
        cancelledCount: Number(row.cancelled_count ?? 0),
        totalItemsCount: Number(row.total_items_count ?? 0),
      });
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  getSourceRunMetadata(sourceRunId: string): Promise<SourceRunExecutionMetadata | null> {
    try {
      const stmt = this.db.prepare<SourceRunRow, [string]>(
        `SELECT adapter_version, collector_id, pages_requested, pages_completed, raw_items_count,
                parsed_items_count, rejected_items_count, stop_reason
         FROM source_runs
         WHERE id = ?`,
      );
      const row = stmt.get(sourceRunId);
      if (!row) {
        return Promise.resolve(null);
      }

      const hasMetrics =
        row.pages_requested !== null ||
        row.pages_completed !== null ||
        row.raw_items_count !== null ||
        row.parsed_items_count !== null ||
        row.rejected_items_count !== null ||
        row.stop_reason !== null;

      return Promise.resolve({
        adapterVersion: row.adapter_version,
        ...(row.collector_id !== null ? { collectorId: row.collector_id } : {}),
        ...(hasMetrics
          ? {
              metrics: {
                ...(row.pages_requested !== null
                  ? { pagesRequested: Number(row.pages_requested) }
                  : {}),
                ...(row.pages_completed !== null
                  ? { pagesCompleted: Number(row.pages_completed) }
                  : {}),
                ...(row.raw_items_count !== null
                  ? { rawItemsCount: Number(row.raw_items_count) }
                  : {}),
                ...(row.parsed_items_count !== null
                  ? { parsedItemsCount: Number(row.parsed_items_count) }
                  : {}),
                ...(row.rejected_items_count !== null
                  ? { rejectedItemsCount: Number(row.rejected_items_count) }
                  : {}),
                ...(row.stop_reason !== null
                  ? { stopReason: row.stop_reason as SourceRunStopReason }
                  : {}),
              },
            }
          : {}),
      });
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
