import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  importSavedSearchYaml,
  parseSavedSearchYaml,
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
} from '@busca-ofertas-ai/configuration';
import { createDefaultSourceRegistry } from '@busca-ofertas-ai/cli';

describe('Synthetic Demo Configuration & Offline Execution (BOAI-009)', () => {
  const demoConfigPath = resolve(process.cwd(), 'config/searches/synthetic-demo.example.yml');

  it('validates config/searches/synthetic-demo.example.yml against official v1 schema', () => {
    const rawYaml = readFileSync(demoConfigPath, 'utf8');

    // 1. Schema parse
    const parsed = parseSavedSearchYaml(rawYaml);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.id).toBe('synthetic-demo');
    expect(parsed.name).toBe('Demo sintética offline');
    expect(parsed.enabled).toBe(true);

    const syntheticSource = parsed.sources.find((s) => s.id === 'synthetic');
    expect(syntheticSource).toBeDefined();
    expect(syntheticSource?.enabled).toBe(true);
    expect(syntheticSource?.queries.length).toBeGreaterThan(0);

    // 2. Direct validation
    expect(() => validateSavedSearchConfiguration(parsed)).not.toThrow();

    // 3. Domain import with clock
    const imported = importSavedSearchYaml(rawYaml, {
      clock: { now: () => new Date('2026-08-31T12:00:00Z') },
    });
    expect(imported.configuration.id).toBe('synthetic-demo');
    expect(imported.savedSearch.id).toBe('synthetic-demo');
  });

  it('validates synthetic-demo.example.yml capabilities against createDefaultSourceRegistry()', () => {
    const rawYaml = readFileSync(demoConfigPath, 'utf8');
    const parsed = parseSavedSearchYaml(rawYaml);
    const registry = createDefaultSourceRegistry();

    expect(() => validateSearchCapabilities(parsed, registry)).not.toThrow();
  });

  it('executes scripts/demo/run-synthetic-demo.mjs via CLI and exits 0 cleanly', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/demo/run-synthetic-demo.mjs');
    const output = execFileSync('node', [scriptPath], {
      encoding: 'utf-8',
      env: { ...process.env },
    });

    expect(output).toContain('Busca Ofertas AI — Synthetic Demo (Offline)');
    expect(output).toContain('Status         : SUCCESS');
    expect(output).toContain('Demo completed successfully');
  });

  it('executes scripts/demo/run-synthetic-demo.mjs passing an explicit config path argument', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/demo/run-synthetic-demo.mjs');
    const output = execFileSync('node', [scriptPath, demoConfigPath], {
      encoding: 'utf-8',
      env: { ...process.env },
    });

    expect(output).toContain('Busca Ofertas AI — Synthetic Demo (Offline)');
    expect(output).toContain('Status         : SUCCESS');
    expect(output).toContain('Demo completed successfully');
  });
});
