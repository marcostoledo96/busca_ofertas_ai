import { renderReport, type ReportViewModel } from '@busca-ofertas-ai/report-html';
import {
  persistReportHtml,
  type PersistReportHtmlOptions,
  type PersistedReportLocation,
} from '../platform/report-writer.js';
import type { ReportOpenerPort } from '../platform/report-opener.js';

export interface GenerateAndOpenReportOptions {
  readonly viewModel: ReportViewModel;
  readonly reportsDir: string;
  readonly opener?: ReportOpenerPort | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly persistFn?: (options: PersistReportHtmlOptions) => Promise<PersistedReportLocation>;
}

export interface GenerateAndOpenReportResult {
  readonly generated: boolean;
  readonly opened: boolean;
  readonly reportDirectory: string;
  readonly reportPath: string;
  readonly openerReason?: string | undefined;
}

/**
 * Reporting Orchestration Service.
 *
 * Coordinates:
 * 1. Pure HTML rendering (ReportViewModel -> HTML string) via @busca-ofertas-ai/report-html.
 * 2. Secure local filesystem persistence (0700 dir / 0600 file).
 * 3. Browser opening via ReportOpenerPort (xdg-open or fake).
 *
 * Guarantee: A failure to open the browser does NOT mark the report generation as failed.
 */
export async function generateAndOpenReport(
  options: GenerateAndOpenReportOptions,
): Promise<GenerateAndOpenReportResult> {
  const { viewModel, reportsDir, opener, signal, persistFn = persistReportHtml } = options;

  if (signal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  // 1. Pure HTML rendering
  const htmlContent = renderReport(viewModel);

  // 2. Local filesystem persistence
  const { reportDirectory, reportPath } = await persistFn({
    reportsDir,
    searchName: viewModel.run.searchName,
    runId: viewModel.run.runId,
    startedAt: viewModel.run.startedAt,
    htmlContent,
    signal,
  });

  // 3. Attempt opening report in browser if opener is provided
  if (!opener) {
    return {
      generated: true,
      opened: false,
      reportDirectory,
      reportPath,
    };
  }

  const openResult = await opener.openLocalReport(reportPath, { signal });

  return {
    generated: true,
    opened: openResult.opened,
    reportDirectory,
    reportPath,
    ...(openResult.reason !== undefined ? { openerReason: openResult.reason } : {}),
  };
}
