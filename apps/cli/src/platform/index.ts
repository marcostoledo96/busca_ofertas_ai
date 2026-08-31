/**
 * @busca-ofertas-ai/cli - Platform Module
 *
 * Encapsulates Linux/Ubuntu platform integration, XDG Base Directory specification paths,
 * local directory security hardening (0700), and report opening seams (xdg-open).
 */

export {
  DEFAULT_APP_NAMESPACE,
  DEFAULT_DATABASE_FILENAME,
  type XdgEnvironment,
  type AppPaths,
  type ResolveXdgAppPathsOptions,
  resolveXdgAppPaths,
} from './xdg-paths.js';

export { PRIVATE_DIRECTORY_MODE, ensureAppDirectories } from './app-directories.js';

export {
  type ReportOpenResult,
  type ReportOpenerOptions,
  type ReportOpenerPort,
  type SpawnFunction,
  type NodeXdgReportOpenerOptions,
  NodeXdgReportOpener,
  type FakeReportOpenerOptions,
  FakeReportOpener,
} from './report-opener.js';
