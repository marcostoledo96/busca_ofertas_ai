import * as path from 'node:path';
import * as os from 'node:os';

export const DEFAULT_APP_NAMESPACE = 'busca-ofertas-ai' as const;
export const DEFAULT_DATABASE_FILENAME = 'busca-ofertas.sqlite' as const;

export interface XdgEnvironment {
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly XDG_DATA_HOME?: string | undefined;
  readonly XDG_STATE_HOME?: string | undefined;
  readonly XDG_CACHE_HOME?: string | undefined;
}

export interface AppPaths {
  readonly configRoot: string;
  readonly searchesDir: string;
  readonly dataRoot: string;
  readonly reportsDir: string;
  readonly databasePath: string;
  readonly stateRoot: string;
  readonly sessionsDir: string;
  readonly logsDir: string;
  readonly cacheRoot: string;
}

export interface ResolveXdgAppPathsOptions {
  readonly env?: XdgEnvironment | Record<string, string | undefined> | undefined;
  readonly homeDir?: string | undefined;
  readonly appName?: string | undefined;
}

/**
 * Pure XDG Base Directory resolver for Busca Ofertas AI.
 *
 * Conforms to the XDG Base Directory Specification:
 * - Environment variables are ONLY honored if they contain absolute paths.
 * - Relative paths in XDG variables are ignored and fall back to /home/marcos-based defaults.
 * - Entirely pure and side-effect free (does not create or mutate filesystem directories).
 * - Independent of process.cwd().
 */
export function resolveXdgAppPaths(options?: ResolveXdgAppPathsOptions): AppPaths {
  const env = options?.env ?? process.env;
  const homeDir = options?.homeDir ?? os.homedir();
  const appName = options?.appName ?? DEFAULT_APP_NAMESPACE;

  // Resolve config root: /appName or ~/.config/appName
  const rawConfig = env.XDG_CONFIG_HOME;
  const configBase =
    rawConfig && path.isAbsolute(rawConfig) ? rawConfig : path.join(homeDir, '.config');
  const configRoot = path.resolve(configBase, appName);

  // Resolve data root: /appName or ~/.local/share/appName
  const rawData = env.XDG_DATA_HOME;
  const dataBase =
    rawData && path.isAbsolute(rawData) ? rawData : path.join(homeDir, '.local', 'share');
  const dataRoot = path.resolve(dataBase, appName);

  // Resolve state root: /appName or ~/.local/state/appName
  const rawState = env.XDG_STATE_HOME;
  const stateBase =
    rawState && path.isAbsolute(rawState) ? rawState : path.join(homeDir, '.local', 'state');
  const stateRoot = path.resolve(stateBase, appName);

  // Resolve cache root: /appName or ~/.cache/appName
  const rawCache = env.XDG_CACHE_HOME;
  const cacheBase = rawCache && path.isAbsolute(rawCache) ? rawCache : path.join(homeDir, '.cache');
  const cacheRoot = path.resolve(cacheBase, appName);

  return {
    configRoot,
    searchesDir: path.join(configRoot, 'searches'),
    dataRoot,
    reportsDir: path.join(dataRoot, 'reports'),
    databasePath: path.join(dataRoot, DEFAULT_DATABASE_FILENAME),
    stateRoot,
    sessionsDir: path.join(stateRoot, 'sessions'),
    logsDir: path.join(stateRoot, 'logs'),
    cacheRoot,
  };
}
