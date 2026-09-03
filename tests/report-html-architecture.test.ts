import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('packages/report-html — Architecture & Boundary Isolation', () => {
  const reportHtmlSrcDir = path.resolve(__dirname, '../packages/report-html/src');

  it('strictly prohibits packages/report-html from importing storage-sqlite, apps/cli, node:fs, node:path, node:child_process or playwright', async () => {
    const files = await fs.promises.readdir(reportHtmlSrcDir);
    const tsFiles = files.filter((f) => f.endsWith('.ts'));

    expect(tsFiles.length).toBeGreaterThan(0);

    const forbiddenImportPatterns = [
      /from\s+['"]@busca-ofertas-ai\/storage-sqlite['"]/,
      /from\s+['"]@busca-ofertas-ai\/cli['"]/,
      /from\s+['"](?:node:)?fs(?:|\/promises)['"]/,
      /from\s+['"](?:node:)?path['"]/,
      /from\s+['"](?:node:)?child_process['"]/,
      /from\s+['"]playwright['"]/,
      /from\s+['"]puppeteer['"]/,
    ];

    for (const file of tsFiles) {
      const filePath = path.join(reportHtmlSrcDir, file);
      const content = await fs.promises.readFile(filePath, 'utf-8');

      for (const pattern of forbiddenImportPatterns) {
        const hasForbiddenImport = pattern.test(content);
        expect(
          hasForbiddenImport,
          `File ${file} must not contain forbidden import matching ${pattern.toString()}`,
        ).toBe(false);
      }
    }
  });

  it('verifies that report-html package.json declares zero runtime dependencies', async () => {
    interface PackageManifest {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }
    const pkgJsonPath = path.resolve(__dirname, '../packages/report-html/package.json');
    const content = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageManifest;

    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('verifies that dependency-cruiser.config.cjs enforces report-html-forbidden-dependencies', async () => {
    const depCruiseConfigPath = path.resolve(__dirname, '../dependency-cruiser.config.cjs');
    const content = await fs.promises.readFile(depCruiseConfigPath, 'utf-8');

    expect(content).toContain('report-html-forbidden-dependencies');
    expect(content).toContain('packages/report-html');
    expect(content).toContain('node:fs');
    expect(content).toContain('node:path');
    expect(content).toContain('node:child_process');
  });
});
