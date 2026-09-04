import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('packages/rules-engine — Architectural Boundaries & Module Isolation', () => {
  const rulesEngineSrcDir = path.resolve(__dirname, '../packages/rules-engine/src');
  const coreSrcDir = path.resolve(__dirname, '../packages/core/src');

  const getAllTsFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return getAllTsFiles(fullPath);
        }
        return entry.name.endsWith('.ts') ? [fullPath] : [];
      }),
    );
    return files.flat();
  };

  it('strictly prohibits packages/rules-engine from importing storage-sqlite, apps/cli, packages/ai, adapters, node:fs, or network modules', async () => {
    const tsFiles = await getAllTsFiles(rulesEngineSrcDir);
    expect(tsFiles.length).toBeGreaterThan(0);

    const forbiddenImportPatterns = [
      /from\s+['"]@busca-ofertas-ai\/storage-sqlite['"]/,
      /from\s+['"]@busca-ofertas-ai\/cli['"]/,
      /from\s+['"]@busca-ofertas-ai\/ai['"]/,
      /from\s+['"]@busca-ofertas-ai\/adapter-[^'"]+['"]/,
      /from\s+['"](?:node:)?fs(?:|\/promises)['"]/,
      /from\s+['"](?:node:)?path['"]/,
      /from\s+['"](?:node:)?child_process['"]/,
      /from\s+['"](?:node:)?http['"]/,
      /from\s+['"](?:node:)?https['"]/,
      /from\s+['"](?:node:)?net['"]/,
      /from\s+['"]better-sqlite3['"]/,
      /from\s+['"]sqlite3['"]/,
      /from\s+['"]playwright['"]/,
      /from\s+['"]puppeteer['"]/,
    ];

    for (const filePath of tsFiles) {
      const relativePath = path.relative(rulesEngineSrcDir, filePath);
      const content = await fs.promises.readFile(filePath, 'utf-8');

      for (const pattern of forbiddenImportPatterns) {
        const hasForbiddenImport = pattern.test(content);
        expect(
          hasForbiddenImport,
          `File ${relativePath} must not contain forbidden import matching ${pattern.toString()}`,
        ).toBe(false);
      }
    }
  });

  it('ensures packages/core strictly never imports packages/rules-engine', async () => {
    const coreTsFiles = await getAllTsFiles(coreSrcDir);
    expect(coreTsFiles.length).toBeGreaterThan(0);

    const forbiddenRulesEngineImport =
      /from\s+['"]@busca-ofertas-ai\/rules-engine(?:|\/[^'"]*)['"]/;

    for (const filePath of coreTsFiles) {
      const relativePath = path.relative(coreSrcDir, filePath);
      const content = await fs.promises.readFile(filePath, 'utf-8');

      const hasForbiddenImport = forbiddenRulesEngineImport.test(content);
      expect(
        hasForbiddenImport,
        `File in core ${relativePath} must never import @busca-ofertas-ai/rules-engine`,
      ).toBe(false);
    }
  });

  it('verifies that packages/rules-engine package.json only declares @busca-ofertas-ai/core as dependency', async () => {
    interface PackageManifest {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }
    const pkgJsonPath = path.resolve(__dirname, '../packages/rules-engine/package.json');
    const content = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageManifest;

    expect(pkg.dependencies).toEqual({
      '@busca-ofertas-ai/core': 'workspace:*',
    });
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('verifies dependency-cruiser config explicitly protects rules-engine boundaries', async () => {
    const depCruiseConfigPath = path.resolve(__dirname, '../dependency-cruiser.config.cjs');
    const content = await fs.promises.readFile(depCruiseConfigPath, 'utf-8');

    expect(content).toContain('core-no-rules-engine');
    expect(content).toContain('rules-engine-no-adapters');
    expect(content).toContain('rules-engine-forbidden-dependencies');
    expect(content).toContain('^packages/rules-engine/');
  });
});
