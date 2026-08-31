import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveXdgAppPaths,
  DEFAULT_APP_NAMESPACE,
  DEFAULT_DATABASE_FILENAME,
  ensureAppDirectories,
  PRIVATE_DIRECTORY_MODE,
} from '@busca-ofertas-ai/cli';

describe('XDG Base Directory Path Resolution & Permissions (BOAI-008)', () => {
  describe('resolveXdgAppPaths (Pure Resolver)', () => {
    it('honors all valid absolute XDG environment variables', () => {
      const paths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: '/custom/config',
          XDG_DATA_HOME: '/custom/data',
          XDG_STATE_HOME: '/custom/state',
          XDG_CACHE_HOME: '/custom/cache',
        },
        homeDir: '/user/home',
        appName: 'busca-ofertas-ai',
      });

      expect(paths.configRoot).toBe(path.resolve('/custom/config/busca-ofertas-ai'));
      expect(paths.searchesDir).toBe(path.resolve('/custom/config/busca-ofertas-ai/searches'));
      expect(paths.dataRoot).toBe(path.resolve('/custom/data/busca-ofertas-ai'));
      expect(paths.reportsDir).toBe(path.resolve('/custom/data/busca-ofertas-ai/reports'));
      expect(paths.databasePath).toBe(
        path.resolve('/custom/data/busca-ofertas-ai', DEFAULT_DATABASE_FILENAME),
      );
      expect(paths.stateRoot).toBe(path.resolve('/custom/state/busca-ofertas-ai'));
      expect(paths.sessionsDir).toBe(path.resolve('/custom/state/busca-ofertas-ai/sessions'));
      expect(paths.logsDir).toBe(path.resolve('/custom/state/busca-ofertas-ai/logs'));
      expect(paths.cacheRoot).toBe(path.resolve('/custom/cache/busca-ofertas-ai'));
    });

    it('falls back to $HOME-based directories when XDG variables are unset or empty', () => {
      const paths = resolveXdgAppPaths({
        env: {},
        homeDir: '/home/testuser',
      });

      expect(paths.configRoot).toBe(path.resolve('/home/testuser/.config/busca-ofertas-ai'));
      expect(paths.searchesDir).toBe(
        path.resolve('/home/testuser/.config/busca-ofertas-ai/searches'),
      );
      expect(paths.dataRoot).toBe(path.resolve('/home/testuser/.local/share/busca-ofertas-ai'));
      expect(paths.reportsDir).toBe(
        path.resolve('/home/testuser/.local/share/busca-ofertas-ai/reports'),
      );
      expect(paths.databasePath).toBe(
        path.resolve('/home/testuser/.local/share/busca-ofertas-ai', DEFAULT_DATABASE_FILENAME),
      );
      expect(paths.stateRoot).toBe(path.resolve('/home/testuser/.local/state/busca-ofertas-ai'));
      expect(paths.sessionsDir).toBe(
        path.resolve('/home/testuser/.local/state/busca-ofertas-ai/sessions'),
      );
      expect(paths.logsDir).toBe(path.resolve('/home/testuser/.local/state/busca-ofertas-ai/logs'));
      expect(paths.cacheRoot).toBe(path.resolve('/home/testuser/.cache/busca-ofertas-ai'));
    });

    it('CONTRACTUAL XDG SPEC: strictly ignores relative XDG variables and uses HOME fallback', () => {
      const paths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: 'relative/config',
          XDG_DATA_HOME: '.local-data',
          XDG_STATE_HOME: './state-relative',
          XDG_CACHE_HOME: 'cache',
        },
        homeDir: '/home/testuser',
      });

      expect(paths.configRoot).toBe(path.resolve('/home/testuser/.config/busca-ofertas-ai'));
      expect(paths.dataRoot).toBe(path.resolve('/home/testuser/.local/share/busca-ofertas-ai'));
      expect(paths.stateRoot).toBe(path.resolve('/home/testuser/.local/state/busca-ofertas-ai'));
      expect(paths.cacheRoot).toBe(path.resolve('/home/testuser/.cache/busca-ofertas-ai'));
    });

    it('correctly handles mixed environment with some absolute and some relative/missing variables', () => {
      const paths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: '/abs/config',
          XDG_DATA_HOME: 'relative-ignored',
          // XDG_STATE_HOME is unset
          XDG_CACHE_HOME: '/abs/cache',
        },
        homeDir: '/home/testuser',
      });

      expect(paths.configRoot).toBe(path.resolve('/abs/config/busca-ofertas-ai'));
      expect(paths.dataRoot).toBe(path.resolve('/home/testuser/.local/share/busca-ofertas-ai'));
      expect(paths.stateRoot).toBe(path.resolve('/home/testuser/.local/state/busca-ofertas-ai'));
      expect(paths.cacheRoot).toBe(path.resolve('/abs/cache/busca-ofertas-ai'));
    });

    it('handles home directory containing spaces, parentheses, or dashes without corruption', () => {
      const complexHome = '/home/user (main-account)/sub dir';
      const paths = resolveXdgAppPaths({
        env: {},
        homeDir: complexHome,
      });

      expect(paths.configRoot).toBe(path.resolve(complexHome, '.config', DEFAULT_APP_NAMESPACE));
      expect(paths.searchesDir).toBe(
        path.resolve(complexHome, '.config', DEFAULT_APP_NAMESPACE, 'searches'),
      );
      expect(paths.dataRoot).toBe(path.resolve(complexHome, '.local/share', DEFAULT_APP_NAMESPACE));
    });

    it('is completely deterministic and independent of process.cwd()', () => {
      const originalCwd = process.cwd();
      const tmpDir = os.tmpdir();

      try {
        process.chdir(tmpDir);
        const paths1 = resolveXdgAppPaths({
          env: {},
          homeDir: '/home/testuser',
        });
        expect(paths1.configRoot).not.toContain(tmpDir);
        expect(paths1.configRoot).toBe(path.resolve('/home/testuser/.config/busca-ofertas-ai'));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('ensureAppDirectories (Directory Hardening & Permissions)', () => {
    let testTempDir: string;

    beforeEach(async () => {
      testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-xdg-perms-'));
    });

    afterEach(async () => {
      try {
        await fs.promises.rm(testTempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup
      }
    });

    it('creates all application-owned directories with 0700 permissions', async () => {
      const appPaths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: path.join(testTempDir, 'config'),
          XDG_DATA_HOME: path.join(testTempDir, 'data'),
          XDG_STATE_HOME: path.join(testTempDir, 'state'),
          XDG_CACHE_HOME: path.join(testTempDir, 'cache'),
        },
      });

      const ensured = await ensureAppDirectories(appPaths);
      expect(ensured).toEqual(appPaths);

      const dirs = [
        appPaths.configRoot,
        appPaths.searchesDir,
        appPaths.dataRoot,
        appPaths.reportsDir,
        appPaths.stateRoot,
        appPaths.sessionsDir,
        appPaths.logsDir,
        appPaths.cacheRoot,
      ];

      for (const dir of dirs) {
        const stat = await fs.promises.stat(dir);
        expect(stat.isDirectory()).toBe(true);

        if (process.platform !== 'win32') {
          // Verify mode mask matches 0o700 (rwx------)
          const mode = stat.mode & 0o777;
          expect(mode).toBe(PRIVATE_DIRECTORY_MODE);
        }
      }
    });

    it('hardens pre-existing application directories with more permissive modes (e.g. 0755) to 0700', async () => {
      const customConfig = path.join(testTempDir, 'existing-config');
      const customSearches = path.join(customConfig, 'searches');

      // Create with permissive 0755
      await fs.promises.mkdir(customSearches, { recursive: true, mode: 0o755 });
      if (process.platform !== 'win32') {
        await fs.promises.chmod(customConfig, 0o755);
        await fs.promises.chmod(customSearches, 0o755);
        expect((await fs.promises.stat(customConfig)).mode & 0o777).toBe(0o755);
      }

      const appPaths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: customConfig,
          XDG_DATA_HOME: path.join(testTempDir, 'data'),
          XDG_STATE_HOME: path.join(testTempDir, 'state'),
          XDG_CACHE_HOME: path.join(testTempDir, 'cache'),
        },
      });

      await ensureAppDirectories(appPaths);

      if (process.platform !== 'win32') {
        const configStat = await fs.promises.stat(appPaths.configRoot);
        const searchesStat = await fs.promises.stat(appPaths.searchesDir);
        expect(configStat.mode & 0o777).toBe(0o700);
        expect(searchesStat.mode & 0o777).toBe(0o700);
      }
    });

    it('never alters permissions of shared parent directories (/home/marcos or parent)', async () => {
      const sharedParent = path.join(testTempDir, 'shared-parent');
      await fs.promises.mkdir(sharedParent, { recursive: true, mode: 0o755 });
      if (process.platform !== 'win32') {
        await fs.promises.chmod(sharedParent, 0o755);
      }

      const appPaths = resolveXdgAppPaths({
        env: {
          XDG_CONFIG_HOME: path.join(sharedParent, 'cfg'),
          XDG_DATA_HOME: path.join(sharedParent, 'dat'),
          XDG_STATE_HOME: path.join(sharedParent, 'st'),
          XDG_CACHE_HOME: path.join(sharedParent, 'cac'),
        },
      });

      await ensureAppDirectories(appPaths);

      if (process.platform !== 'win32') {
        const parentStat = await fs.promises.stat(sharedParent);
        // Shared parent must remain 0755
        expect(parentStat.mode & 0o777).toBe(0o755);
      }
    });
  });
});
