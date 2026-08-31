import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  importSavedSearchYaml,
  parseSavedSearchYaml,
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
  ConfigurationError,
} from '@busca-ofertas-ai/configuration';
import { createDefaultSourceRegistry } from '@busca-ofertas-ai/cli';

interface DemoOutcome {
  readonly status: string;
  readonly pagesRead: number;
  readonly itemsCount: number;
  readonly hasMore: boolean;
  readonly stopReason: string;
}

async function invokeRunSyntheticDemo(configPath?: string): Promise<DemoOutcome> {
  const scriptModulePath = '../scripts/demo/run-synthetic-demo.mjs';
  const mod = (await import(scriptModulePath)) as {
    runSyntheticDemo: (cfg?: string) => Promise<DemoOutcome>;
  };
  return mod.runSyntheticDemo(configPath);
}

describe('Synthetic Demo Configuration & Offline Execution (BOAI-009)', () => {
  const demoConfigPath = path.resolve(process.cwd(), 'config/searches/synthetic-demo.example.yml');
  const scriptPath = path.resolve(process.cwd(), 'scripts/demo/run-synthetic-demo.mjs');

  it('validates config/searches/synthetic-demo.example.yml against official v1 schema', () => {
    const rawYaml = fs.readFileSync(demoConfigPath, 'utf8');

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
    const rawYaml = fs.readFileSync(demoConfigPath, 'utf8');
    const parsed = parseSavedSearchYaml(rawYaml);
    const registry = createDefaultSourceRegistry();

    expect(() => validateSearchCapabilities(parsed, registry)).not.toThrow();
  });

  it('executes runSyntheticDemo() in-process and produces successful offline output', async () => {
    const outcome = await invokeRunSyntheticDemo(demoConfigPath);

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.pagesRead).toBeGreaterThanOrEqual(1);
    expect(outcome.itemsCount).toBeGreaterThanOrEqual(1);
  });

  it('executes scripts/demo/run-synthetic-demo.mjs via CLI and exits 0 cleanly', () => {
    const output = execFileSync('node', [scriptPath], {
      encoding: 'utf-8',
      env: { ...process.env },
    });

    expect(output).toContain('Busca Ofertas AI — Synthetic Demo (Offline)');
    expect(output).toContain('Status         : SUCCESS');
    expect(output).toContain('Demo completed successfully');
  });

  it('executes scripts/demo/run-synthetic-demo.mjs passing an explicit config path argument', () => {
    const output = execFileSync('node', [scriptPath, demoConfigPath], {
      encoding: 'utf-8',
      env: { ...process.env },
    });

    expect(output).toContain('Busca Ofertas AI — Synthetic Demo (Offline)');
    expect(output).toContain('Status         : SUCCESS');
    expect(output).toContain('Demo completed successfully');
  });

  describe('Finding 3: Demo Error Handling and Invalid Configuration Differentiation', () => {
    it('throws ConfigurationError in-process and exits with 20 in CLI on nonexistent file', async () => {
      const nonexistentPath = path.resolve(process.cwd(), 'config/searches/does-not-exist.yml');

      // In-process error
      await expect(invokeRunSyntheticDemo(nonexistentPath)).rejects.toThrow(ConfigurationError);

      // CLI exit code
      const result = spawnSync('node', [scriptPath, nonexistentPath], {
        encoding: 'utf-8',
        env: { ...process.env },
      });

      expect(result.status).toBe(20);
      expect(result.stderr).toContain('[INVALID_CONFIGURATION] CONFIG_FILE_NOT_FOUND');
      expect(result.stderr).not.toContain('[INTERNAL_ERROR]');
    });

    it('throws ConfigurationError in-process and exits with 20 in CLI on invalid schema YAML without executing adapter', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-demo-test-'));
      const invalidConfigPath = path.join(tempDir, 'invalid-schema.yml');

      try {
        fs.writeFileSync(
          invalidConfigPath,
          `schemaVersion: 99
id: invalid-id-without-sources
name: Invalid Search
enabled: true
`,
          'utf8',
        );

        // In-process error
        await expect(invokeRunSyntheticDemo(invalidConfigPath)).rejects.toThrow(ConfigurationError);

        // CLI exit code
        const result = spawnSync('node', [scriptPath, invalidConfigPath], {
          encoding: 'utf-8',
          env: { ...process.env },
        });

        expect(result.status).toBe(20);
        expect(result.stderr).toContain('[INVALID_CONFIGURATION]');
        expect(result.stderr).not.toContain('[INTERNAL_ERROR]');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws ConfigurationError in-process and exits with 20 in CLI when synthetic source is not configured/enabled', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boai-demo-test-'));
      const disabledConfigPath = path.join(tempDir, 'no-synthetic-source.yml');

      try {
        fs.writeFileSync(
          disabledConfigPath,
          `schemaVersion: 1
id: no-synthetic-demo
name: No Synthetic Demo
enabled: true
category: PRODUCT
sources:
  - id: other-mock-source
    enabled: true
    queries:
      - Nintendo Switch Lite
evaluation:
  matchThreshold: 80
  reviewThreshold: 40
ai:
  enabled: false
  evaluateOnlyReview: true
  requireConfirmation: true
  maxEvaluationsPerRun: 5
retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30
`,
          'utf8',
        );

        // In-process error
        await expect(invokeRunSyntheticDemo(disabledConfigPath)).rejects.toThrow(
          ConfigurationError,
        );

        // CLI exit code
        const result = spawnSync('node', [scriptPath, disabledConfigPath], {
          encoding: 'utf-8',
          env: { ...process.env },
        });

        expect(result.status).toBe(20);
        expect(result.stderr).toContain('[INVALID_CONFIGURATION] CONFIG_SOURCE_NOT_REGISTERED');
        expect(result.stderr).not.toContain('[INTERNAL_ERROR]');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
