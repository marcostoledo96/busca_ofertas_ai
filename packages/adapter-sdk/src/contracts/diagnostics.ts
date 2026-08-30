/**
 * Structured diagnostics for source search and adapter execution observability.
 */

export type DiagnosticsStopReason =
  | 'ALL_PAGES_FETCHED'
  | 'MAX_PAGES_REACHED'
  | 'MAX_ITEMS_REACHED'
  | 'NO_MORE_RESULTS'
  | 'RATE_LIMIT_STOP'
  | 'USER_ABORTED'
  | 'DEADLINE_EXCEEDED';

export interface SourceDiagnostics {
  readonly pagesRequested: number;
  readonly pagesCompleted: number;
  readonly rawItemsCount: number;
  readonly parsedItemsCount: number;
  readonly rejectedItemsCount: number;
  readonly sanitizedCursor?: string | null;
  readonly stopReason: DiagnosticsStopReason;
  readonly warnings: readonly string[];
  readonly collectorId?: string;
}

export interface CreateSourceDiagnosticsParams {
  readonly pagesRequested: number;
  readonly pagesCompleted: number;
  readonly rawItemsCount: number;
  readonly parsedItemsCount: number;
  readonly rejectedItemsCount: number;
  readonly sanitizedCursor?: string | null;
  readonly stopReason: DiagnosticsStopReason;
  readonly warnings?: readonly string[];
  readonly collectorId?: string;
}

export function createSourceDiagnostics(params: CreateSourceDiagnosticsParams): SourceDiagnostics {
  if (params.pagesRequested < 0 || params.pagesCompleted < 0) {
    throw new Error('Diagnostics page counts cannot be negative');
  }
  if (params.rawItemsCount < 0 || params.parsedItemsCount < 0 || params.rejectedItemsCount < 0) {
    throw new Error('Diagnostics item counts cannot be negative');
  }

  return {
    pagesRequested: params.pagesRequested,
    pagesCompleted: params.pagesCompleted,
    rawItemsCount: params.rawItemsCount,
    parsedItemsCount: params.parsedItemsCount,
    rejectedItemsCount: params.rejectedItemsCount,
    ...(params.sanitizedCursor !== undefined && { sanitizedCursor: params.sanitizedCursor }),
    stopReason: params.stopReason,
    warnings: params.warnings ? [...params.warnings] : [],
    ...(params.collectorId !== undefined && { collectorId: params.collectorId }),
  };
}
