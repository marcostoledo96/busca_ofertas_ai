import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
    expect(terminal.isClosed()).toBe(true);
  });

  it('ensures resources are safely disposed when an action throws a fatal error', async () => {
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

    // After action fails, user inputs 8 to exit cleanly
    terminal.enqueueInput('8');

    const defaultActions = createDefaultMenuActions();
    const app = createCliApplication({
      terminal,
      signalManager,
      actions: [failingAction, ...defaultActions.filter((a: MenuAction) => a.optionNumber !== 1)],
    });

    const exitCode = await app.run();
    expect(exitCode).toBe(EXIT_CODES.SUCCESS);

    const raw = terminal.getRawOutput();
    expect(raw).toContain('[TOTAL_SOURCE_FAILURE] Todas las fuentes configuradas fallaron.');
    expect(terminal.isClosed()).toBe(true);
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
      '@busca-ofertas-ai/storage-sqlite',
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

    // Must only depend on core
    expect(Object.keys(pkgContent.dependencies ?? {})).toEqual(['@busca-ofertas-ai/core']);
  });
});
