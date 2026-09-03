/**
 * @busca-ofertas-ai/report-html
 *
 * Pure, deterministic HTML report renderer for Busca Ofertas AI.
 * Free of Node.js filesystem, child_process, SQLite, or browser automation dependencies.
 */

export const REPORT_HTML_PACKAGE_NAME = '@busca-ofertas-ai/report-html' as const;

export * from './view-model.js';
export { escapeHtml } from './html-escape.js';
export { validateSafeUrl } from './url-policy.js';
export {
  sortMatchItems,
  sortReviewItems,
  sortRejectItems,
  sortSourceErrors,
  sortSources,
} from './sort.js';
export { REPORT_CSS } from './styles.js';
export { renderReport } from './renderer.js';
