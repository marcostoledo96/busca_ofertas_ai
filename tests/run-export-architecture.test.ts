import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as runExport from '@busca-ofertas-ai/run-export';

describe('Run Export Architecture & Boundaries (BOAI-014)', () => {
  it('exports all contractual interfaces, schemas, sorters, serializers, and projector', () => {
    expect(runExport.RUN_EXPORT_SCHEMA_VERSION).toBe(1);
    expect(typeof runExport.serializeJson).toBe('function');
    expect(typeof runExport.serializeCsv).toBe('function');
    expect(typeof runExport.sanitizeSpreadsheetFormula).toBe('function');
    expect(typeof runExport.compareBinary).toBe('function');
    expect(typeof runExport.sortSources).toBe('function');
    expect(typeof runExport.sortResults).toBe('function');
    expect(typeof runExport.validateRunExportSnapshot).toBe('function');
    expect(typeof runExport.resolveHistoricalSearchRevision).toBe('function');
    expect(typeof runExport.projectPersistedRunExport).toBe('function');
    expect(Array.isArray(runExport.CSV_COLUMNS)).toBe(true);
    expect(runExport.CSV_COLUMN_COUNT).toBe(65);
    expect(runExport.CSV_COLUMNS).toHaveLength(65);
  });

  it('has zero external runtime dependencies in package manifest', () => {
    const pkgPath = path.resolve(__dirname, '../packages/run-export/package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };

    const deps = pkg.dependencies ?? {};
    const externalDeps = Object.keys(deps).filter((d) => !d.startsWith('@busca-ofertas-ai/'));
    expect(externalDeps).toEqual([]);
    expect(Object.keys(deps)).toEqual(['@busca-ofertas-ai/core']);
  });

  it('pure serialization files in packages/run-export do not import node:fs, sqlite, html or cli', () => {
    const srcDir = path.resolve(__dirname, '../packages/run-export/src');
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

    const forbiddenImports = [
      'node:fs',
      'node:path',
      'node:child_process',
      'fs',
      'path',
      'child_process',
      'better-sqlite3',
      '@busca-ofertas-ai/storage-sqlite',
      '@busca-ofertas-ai/report-html',
      '@busca-ofertas-ai/cli',
      'playwright',
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
      for (const forbidden of forbiddenImports) {
        expect(content).not.toContain(`from '${forbidden}'`);
        expect(content).not.toContain(`from "${forbidden}"`);
        expect(content).not.toContain(`require('${forbidden}')`);
        expect(content).not.toContain(`require("${forbidden}")`);
      }
    }
  });
});
