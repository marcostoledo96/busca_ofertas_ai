import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

describe('Ubuntu Installer and Uninstaller Scripts (BOAI-008)', () => {
  const repoRoot = path.resolve(process.cwd());
  const installScriptPath = path.join(repoRoot, 'scripts/install-ubuntu.sh');
  const uninstallScriptPath = path.join(repoRoot, 'scripts/uninstall-ubuntu.sh');

  let testHome: string;
  let testConfigHome: string;
  let testDataHome: string;
  let testStateHome: string;
  let testCacheHome: string;

  beforeEach(async () => {
    testHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-installer-home-'));
    testConfigHome = path.join(testHome, '.config');
    testDataHome = path.join(testHome, '.local/share');
    testStateHome = path.join(testHome, '.local/state');
    testCacheHome = path.join(testHome, '.cache');
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  const isValidatorAvailable = (): boolean => {
    try {
      execFileSync('desktop-file-validate', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  const runScript = (
    scriptPath: string,
    envOverrides?: Record<string, string>,
    cwd?: string,
  ): { stdout: string; stderr: string; status: number } => {
    try {
      const bashBin = fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';
      const stdout = execFileSync(bashBin, [scriptPath], {
        cwd: cwd ?? repoRoot,
        env: {
          ...process.env,
          HOME: testHome,
          XDG_CONFIG_HOME: testConfigHome,
          XDG_DATA_HOME: testDataHome,
          XDG_STATE_HOME: testStateHome,
          XDG_CACHE_HOME: testCacheHome,
          ...(envOverrides ?? {}),
        },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stdout, stderr: '', status: 0 };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: execErr.stdout ?? '',
        stderr: execErr.stderr ?? '',
        status: execErr.status ?? 1,
      };
    }
  };

  it('installs user command wrapper and desktop launcher with restrictive permissions', async () => {
    const res = runScript(installScriptPath);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Instalación completada exitosamente');

    // 1. Check local bin wrapper
    const commandPath = path.join(testHome, '.local/bin/busca-ofertas');
    expect(fs.existsSync(commandPath)).toBe(true);

    const commandStat = await fs.promises.stat(commandPath);
    expect(commandStat.mode & 0o777).toBe(0o755);

    const commandContent = await fs.promises.readFile(commandPath, 'utf-8');
    expect(commandContent).toContain('#!/usr/bin/env bash');
    expect(commandContent).toContain(path.join(repoRoot, 'apps/cli/dist/bin.js'));
    expect(commandContent).toContain('"$@"');

    // 2. Check desktop file
    const desktopPath = path.join(testDataHome, 'applications/busca-ofertas-ai.desktop');
    expect(fs.existsSync(desktopPath)).toBe(true);

    const desktopStat = await fs.promises.stat(desktopPath);
    expect(desktopStat.mode & 0o777).toBe(0o644);

    const desktopContent = await fs.promises.readFile(desktopPath, 'utf-8');
    expect(desktopContent).toContain('[Desktop Entry]');
    expect(desktopContent).toContain('Type=Application');
    expect(desktopContent).toContain('Name=Busca Ofertas AI');
    expect(desktopContent).toContain('Comment=Buscar y revisar ofertas locales');
    expect(desktopContent).toContain(`Exec="${commandPath}"`);
    expect(desktopContent).toContain(`TryExec=${commandPath}`);
    expect(desktopContent).toContain('Terminal=true');
    expect(desktopContent).toContain('Categories=Utility;');

    // Verify negative invariants: no server, daemon, cron, nohup, sudo
    expect(desktopContent).not.toContain('sudo');
    expect(desktopContent).not.toContain('server');
    expect(desktopContent).not.toContain('daemon');
    expect(desktopContent).not.toContain('cron');
    expect(desktopContent).not.toContain('systemctl');
    expect(desktopContent).not.toContain('nohup');
    expect(desktopContent).not.toContain('npm start');

    // 3. FINDING 3: Validate strictly with desktop-file-validate when present (without swallowing errors)
    if (isValidatorAvailable()) {
      // Must succeed and exit 0
      execFileSync('desktop-file-validate', [desktopPath], { stdio: 'pipe' });
    }

    // 4. Verify directory creation & 0700 permissions
    const privateDirs = [
      path.join(testConfigHome, 'busca-ofertas-ai'),
      path.join(testConfigHome, 'busca-ofertas-ai/searches'),
      path.join(testDataHome, 'busca-ofertas-ai'),
      path.join(testDataHome, 'busca-ofertas-ai/reports'),
      path.join(testStateHome, 'busca-ofertas-ai'),
      path.join(testStateHome, 'busca-ofertas-ai/sessions'),
      path.join(testStateHome, 'busca-ofertas-ai/logs'),
      path.join(testCacheHome, 'busca-ofertas-ai'),
    ];

    for (const dir of privateDirs) {
      expect(fs.existsSync(dir)).toBe(true);
      const stat = await fs.promises.stat(dir);
      expect(stat.mode & 0o777).toBe(0o700);
    }
  });

  it('FINDING 3: desktop-file-validate negative proof fails as expected on invalid desktop files', async () => {
    if (!isValidatorAvailable()) {
      return;
    }

    const invalidDesktopPath = path.join(testDataHome, 'invalid.desktop');
    await fs.promises.mkdir(path.dirname(invalidDesktopPath), { recursive: true });
    await fs.promises.writeFile(
      invalidDesktopPath,
      'InvalidDesktopFileWithoutHeader=true\nKey=Value\n',
      'utf-8',
    );

    expect(() => {
      execFileSync('desktop-file-validate', [invalidDesktopPath], { stdio: 'pipe' });
    }).toThrow();
  });

  it('FINDING 3: fails and prevents partial installation when Node is missing from PATH', () => {
    const noNodeBinDir = path.join(testHome, 'no-node-bin');
    fs.mkdirSync(noNodeBinDir, { recursive: true });

    // Link essential system binaries except node
    for (const bin of [
      'bash',
      'uname',
      'sed',
      'cat',
      'mkdir',
      'chmod',
      'dirname',
      'basename',
      'which',
    ]) {
      try {
        const binPath = execFileSync('which', [bin], { encoding: 'utf-8' }).trim();
        fs.symlinkSync(binPath, path.join(noNodeBinDir, bin));
      } catch {
        // Ignore if binary not found
      }
    }

    const res = runScript(installScriptPath, { PATH: noNodeBinDir });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Node.js no está instalado o no se encuentra en $PATH');

    // Verify zero partial installation
    expect(fs.existsSync(path.join(testHome, '.local/bin/busca-ofertas'))).toBe(false);
    expect(fs.existsSync(path.join(testDataHome, 'applications/busca-ofertas-ai.desktop'))).toBe(
      false,
    );
  });

  it('FINDING 3: fails and prevents partial installation when Node version is too old (< 22)', () => {
    const mockBinDir = path.join(testHome, 'old-node-bin');
    fs.mkdirSync(mockBinDir, { recursive: true });

    // Create a mock node binary that reports v18.0.0
    const mockNodePath = path.join(mockBinDir, 'node');
    fs.writeFileSync(mockNodePath, '#!/usr/bin/env bash\necho "v18.0.0"\n', { mode: 0o755 });

    const res = runScript(installScriptPath, {
      PATH: `${mockBinDir}:${process.env['PATH'] ?? ''}`,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Node.js >= 22.0.0 es requerido. Versión detectada: v18.0.0');

    // Verify zero partial installation
    expect(fs.existsSync(path.join(testHome, '.local/bin/busca-ofertas'))).toBe(false);
    expect(fs.existsSync(path.join(testDataHome, 'applications/busca-ofertas-ai.desktop'))).toBe(
      false,
    );
  });

  it('fails with clear error and prevents partial installation if application build does not exist', async () => {
    // Create a mock repo directory without dist
    const fakeRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boai-fake-repo-'));
    try {
      const fakeScripts = path.join(fakeRepo, 'scripts');
      await fs.promises.mkdir(fakeScripts, { recursive: true });
      await fs.promises.copyFile(installScriptPath, path.join(fakeScripts, 'install-ubuntu.sh'));

      const res = runScript(path.join(fakeScripts, 'install-ubuntu.sh'), undefined, fakeRepo);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Build no encontrado. Ejecutá: pnpm build');

      // Verify zero partial installation
      expect(fs.existsSync(path.join(testHome, '.local/bin/busca-ofertas'))).toBe(false);
      expect(fs.existsSync(path.join(testDataHome, 'applications/busca-ofertas-ai.desktop'))).toBe(
        false,
      );
    } finally {
      await fs.promises.rm(fakeRepo, { recursive: true, force: true });
    }
  });

  it('installer is idempotent and can be run multiple times safely', () => {
    const res1 = runScript(installScriptPath);
    expect(res1.status).toBe(0);

    const res2 = runScript(installScriptPath);
    expect(res2.status).toBe(0);
    expect(res2.stdout).toContain('Instalación completada exitosamente');

    const commandPath = path.join(testHome, '.local/bin/busca-ofertas');
    const desktopPath = path.join(testDataHome, 'applications/busca-ofertas-ai.desktop');
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(fs.existsSync(desktopPath)).toBe(true);
  });

  it('uninstaller removes command wrapper and desktop file and is idempotent', () => {
    // 1. Install first
    runScript(installScriptPath);
    const commandPath = path.join(testHome, '.local/bin/busca-ofertas');
    const desktopPath = path.join(testDataHome, 'applications/busca-ofertas-ai.desktop');
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(fs.existsSync(desktopPath)).toBe(true);

    // 2. Run uninstaller
    const uninst1 = runScript(uninstallScriptPath);
    expect(uninst1.status).toBe(0);
    expect(uninst1.stdout).toContain('Comando eliminado');
    expect(uninst1.stdout).toContain('Launcher desktop eliminado');
    expect(fs.existsSync(commandPath)).toBe(false);
    expect(fs.existsSync(desktopPath)).toBe(false);

    // 3. Second uninstall is idempotent
    const uninst2 = runScript(uninstallScriptPath);
    expect(uninst2.status).toBe(0);
    expect(uninst2.stdout).toContain('No se encontraron archivos de launcher previos');
  });

  it('CONTRACTUAL ACCEPTANCE GATE: uninstallation strictly PRESERVES all user data', async () => {
    // 1. Install launcher
    runScript(installScriptPath);

    // 2. Populate user data files across XDG hierarchy
    const searchFile = path.join(testConfigHome, 'busca-ofertas-ai/searches/nintendo-switch.yml');
    const reportFile = path.join(testDataHome, 'busca-ofertas-ai/reports/2026-08-31_report.html');
    const sessionFile = path.join(testStateHome, 'busca-ofertas-ai/sessions/auth-session.json');
    const logFile = path.join(testStateHome, 'busca-ofertas-ai/logs/app.log');
    const cacheFile = path.join(testCacheHome, 'busca-ofertas-ai/temp-token.cache');

    await fs.promises.writeFile(searchFile, 'schemaVersion: 1\nid: nintendo-switch\n', 'utf-8');
    await fs.promises.writeFile(reportFile, '<!doctype html><title>Report</title>', 'utf-8');
    await fs.promises.writeFile(sessionFile, '{"state":"active"}', 'utf-8');
    await fs.promises.writeFile(logFile, '[2026-08-31] Log line\n', 'utf-8');
    await fs.promises.writeFile(cacheFile, 'cached binary data', 'utf-8');

    // 3. Run uninstaller
    const uninst = runScript(uninstallScriptPath);
    expect(uninst.status).toBe(0);
    expect(uninst.stdout).toContain('INFORMACIÓN DE DATOS PRESERVADOS');

    // 4. Launcher artifacts are removed
    expect(fs.existsSync(path.join(testHome, '.local/bin/busca-ofertas'))).toBe(false);
    expect(fs.existsSync(path.join(testDataHome, 'applications/busca-ofertas-ai.desktop'))).toBe(
      false,
    );

    // 5. ALL user data files remain completely intact
    expect(fs.existsSync(searchFile)).toBe(true);
    expect(await fs.promises.readFile(searchFile, 'utf-8')).toBe(
      'schemaVersion: 1\nid: nintendo-switch\n',
    );

    expect(fs.existsSync(reportFile)).toBe(true);
    expect(await fs.promises.readFile(reportFile, 'utf-8')).toBe(
      '<!doctype html><title>Report</title>',
    );

    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(await fs.promises.readFile(sessionFile, 'utf-8')).toBe('{"state":"active"}');

    expect(fs.existsSync(logFile)).toBe(true);
    expect(await fs.promises.readFile(logFile, 'utf-8')).toBe('[2026-08-31] Log line\n');

    expect(fs.existsSync(cacheFile)).toBe(true);
    expect(await fs.promises.readFile(cacheFile, 'utf-8')).toBe('cached binary data');
  });
});
