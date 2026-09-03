import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLI_PACKAGE_NAME,
  getCliPackageMetadata,
  createCliApplication,
  createDefaultMenuActions,
  FakeTerminal,
  TestSignalManager,
  EXIT_CODES,
  CliError,
  type MenuAction,
  type ActionResult,
  type ExitCode,
} from '@busca-ofertas-ai/cli';

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe('CLI Composition Root and Architecture (BOAI-006)', () => {
  it('exports valid package metadata and public interface symbols', () => {
    expect(CLI_PACKAGE_NAME).toBe('@busca-ofertas-ai/cli');
    const metadata = getCliPackageMetadata();
    expect(metadata).toEqual({
      name: '@busca-ofertas-ai/cli',
      initialized: true,
    });
  });

  it('creates and executes application with in-memory test ports', async () => {
    const terminal = new FakeTerminal(['8']);
    const signalManager = new TestSignalManager();

    const app = createCliApplication({
      terminal,
      signalManager,
    });

    expect(app.shell).toBeDefined();
    expect(app.terminal).toBe(terminal);
    expect(app.signalManager).toBe(signalManager);

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(terminal.closeCount).toBe(1);
  });

  it('Finding 3: propagates contractual exit codes from terminal action outcomes', async () => {
    const testCases: Array<{ name: string; exitCode: ExitCode; expectedCode: number }> = [
      { name: 'PARTIAL_SUCCESS', exitCode: EXIT_CODES.PARTIAL_SUCCESS, expectedCode: 10 },
      {
        name: 'INVALID_CONFIGURATION',
        exitCode: EXIT_CODES.INVALID_CONFIGURATION,
        expectedCode: 20,
      },
      { name: 'TOTAL_SOURCE_FAILURE', exitCode: EXIT_CODES.TOTAL_SOURCE_FAILURE, expectedCode: 30 },
      {
        name: 'MANUAL_INTERVENTION_REQUIRED',
        exitCode: EXIT_CODES.MANUAL_INTERVENTION_REQUIRED,
        expectedCode: 40,
      },
      { name: 'INTERNAL_ERROR', exitCode: EXIT_CODES.INTERNAL_ERROR, expectedCode: 70 },
    ];

    for (const { exitCode, expectedCode } of testCases) {
      const terminal = new FakeTerminal(['1']);
      const signalManager = new TestSignalManager();

      const terminalAction: MenuAction = {
        id: 'terminal-action',
        optionNumber: 1,
        title: 'Terminal Action',
        execute: (): Promise<ActionResult> => {
          return Promise.resolve({ kind: 'finish', exitCode });
        },
      };

      const app = createCliApplication({
        terminal,
        signalManager,
        actions: [
          terminalAction,
          ...createDefaultMenuActions().filter((a: MenuAction) => a.optionNumber !== 1),
        ],
      });

      const result = await app.run();
      expect(result).toBe(expectedCode);
      expect(terminal.closeCount).toBe(1);
    }
  });

  it('Finding 3: uncaught CliError in action terminates application with error.exitCode', async () => {
    const terminal = new FakeTerminal(['1']);
    const signalManager = new TestSignalManager();

    const failingAction: MenuAction = {
      id: 'failing-action',
      optionNumber: 1,
      title: 'Failing Action',
      execute: () => {
        throw new CliError({
          code: 'TOTAL_SOURCE_FAILURE',
          userMessage: 'Todas las fuentes configuradas fallaron.',
          exitCode: EXIT_CODES.TOTAL_SOURCE_FAILURE,
        });
      },
    };

    const defaultActions = createDefaultMenuActions();
    const app = createCliApplication({
      terminal,
      signalManager,
      actions: [failingAction, ...defaultActions.filter((a: MenuAction) => a.optionNumber !== 1)],
    });

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.TOTAL_SOURCE_FAILURE);

    const raw = terminal.getRawOutput();
    expect(raw).toContain('[TOTAL_SOURCE_FAILURE] Todas las fuentes configuradas fallaron.');
    expect(terminal.closeCount).toBe(1);
  });

  it('Finding 4: terminal close is called exactly once in success, failure, and cancellation lifecycles', async () => {
    // 1. Success case
    const termSuccess = new FakeTerminal(['8']);
    const appSuccess = createCliApplication({ terminal: termSuccess });
    await appSuccess.run();
    expect(termSuccess.closeCount).toBe(1);

    // 2. Failure case
    const termFail = new FakeTerminal(['1']);
    const failAction: MenuAction = {
      id: 'fail',
      optionNumber: 1,
      title: 'Fail',
      execute: () => {
        throw new Error('Unexpected crash');
      },
    };
    const appFail = createCliApplication({
      terminal: termFail,
      actions: [
        failAction,
        ...createDefaultMenuActions().filter((a: MenuAction) => a.optionNumber !== 1),
      ],
    });
    await appFail.run();
    expect(termFail.closeCount).toBe(1);

    // 3. Cancellation case
    const termCancel = new FakeTerminal();
    const sigMgr = new TestSignalManager();
    sigMgr.abort('Cancelled');
    const appCancel = createCliApplication({
      terminal: termCancel,
      signalManager: sigMgr,
    });
    await appCancel.run();
    expect(termCancel.closeCount).toBe(1);
  });

  it('ARCHITECTURAL NEGATIVE PROOF: apps/cli package manifest contains no forbidden dependencies', () => {
    const pkgPath = resolve(process.cwd(), 'apps/cli/package.json');
    const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageManifest;

    const allDeps: Record<string, string> = {
      ...(pkgContent.dependencies ?? {}),
      ...(pkgContent.devDependencies ?? {}),
      ...(pkgContent.peerDependencies ?? {}),
    };

    const forbiddenPackages = [
      'playwright',
      'puppeteer',
      'sqlite3',
      'better-sqlite3',
      'axios',
      'got',
      'node-fetch',
      'inquirer',
      'commander',
      'chalk',
    ];

    for (const forbidden of forbiddenPackages) {
      expect(allDeps[forbidden]).toBeUndefined();
    }

    expect(Object.keys(pkgContent.dependencies ?? {}).sort()).toEqual([
      '@busca-ofertas-ai/adapter-synthetic',
      '@busca-ofertas-ai/configuration',
      '@busca-ofertas-ai/core',
      '@busca-ofertas-ai/report-html',
      '@busca-ofertas-ai/run-export',
      '@busca-ofertas-ai/storage-sqlite',
    ]);
  });

  it('ARCHITECTURAL ISOLATION PROOF: only composition-root.ts imports @busca-ofertas-ai/storage-sqlite in apps/cli', () => {
    const cliSrcDir = resolve(process.cwd(), 'apps/cli/src');

    function getFilesRecursively(dir: string): string[] {
      let results: string[] = [];
      const list = readdirSync(dir);
      for (const file of list) {
        const fullPath = resolve(dir, file);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(getFilesRecursively(fullPath));
        } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const allTsFiles = getFilesRecursively(cliSrcDir);
    const nonCompositionFiles = allTsFiles.filter((f) => !f.endsWith('composition-root.ts'));

    for (const file of nonCompositionFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(
        content.includes('@busca-ofertas-ai/storage-sqlite'),
        `File ${file} should NOT import storage-sqlite directly; only composition-root.ts is allowed to wire persistence infrastructure.`,
      ).toBe(false);
    }
  });
});
