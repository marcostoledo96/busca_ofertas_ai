import {
  projectPersistedRunExport,
  serializeJson,
  serializeCsv,
  type ProjectPersistedRunExportParams,
  type RunExportSnapshot,
} from '@busca-ofertas-ai/run-export';
import {
  persistRunExports,
  type PersistRunExportsOptions,
  type PersistedRunExportsLocation,
} from '../platform/report-writer.js';

export interface GenerateRunExportsOptions extends ProjectPersistedRunExportParams {
  readonly reportsDir: string;
  readonly signal?: AbortSignal | undefined;
  readonly persistFn?:
    ((options: PersistRunExportsOptions) => Promise<PersistedRunExportsLocation>) | undefined;
}

export interface GenerateRunExportsResult extends PersistedRunExportsLocation {
  readonly snapshot: RunExportSnapshot;
}

/**
 * Orchestrates export generation from a persisted run.
 *
 * Coordinates:
 * 1. Infrastructure-agnostic projection from Core repository ports.
 * 2. Deterministic serialization to JSON and CSV.
 * 3. Atomic, pair-consistent filesystem persistence with 0700/0600 permissions.
 */
export async function generateRunExports(
  options: GenerateRunExportsOptions,
): Promise<GenerateRunExportsResult> {
  const {
    runId,
    runRepository,
    savedSearchRepository,
    listingRepository,
    observationRepository,
    reportsDir,
    signal,
    persistFn = persistRunExports,
  } = options;

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  // 1. Project persisted facts through Core ports
  const snapshot = await projectPersistedRunExport({
    runId,
    runRepository,
    savedSearchRepository,
    listingRepository,
    observationRepository,
  });

  // 2. Pure deterministic serialization
  const jsonContent = serializeJson(snapshot);
  const csvContent = serializeCsv(snapshot);

  // 3. Pair-consistent filesystem persistence
  const location = await persistFn({
    reportsDir,
    searchName: snapshot.search.name,
    runId: snapshot.run.id,
    startedAt: snapshot.run.startedAt,
    jsonContent,
    csvContent,
    signal,
  });

  return {
    ...location,
    snapshot,
  };
}
