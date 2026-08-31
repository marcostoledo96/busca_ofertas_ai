import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getAdapterSyntheticPackageMetadata,
  SYNTHETIC_ADAPTER_PACKAGE_NAME,
  SYNTHETIC_FIXTURE_SET_METADATA,
} from '@busca-ofertas-ai/adapter-synthetic';

describe('Synthetic Adapter Architecture, Network & Privacy Gates (BOAI-009)', () => {
  it('exports valid package metadata from entrypoint', () => {
    expect(SYNTHETIC_ADAPTER_PACKAGE_NAME).toBe('@busca-ofertas-ai/adapter-synthetic');
    const metadata = getAdapterSyntheticPackageMetadata();
    expect(metadata).toEqual({
      name: '@busca-ofertas-ai/adapter-synthetic',
      version: '0.1.0',
      initialized: true,
    });
  });

  it('Finding 4: declares contractual fixture set metadata for synthetic corpus', () => {
    expect(SYNTHETIC_FIXTURE_SET_METADATA).toBeDefined();
    expect(SYNTHETIC_FIXTURE_SET_METADATA).toEqual({
      schema: 'raw-listing-candidate-fixture',
      schemaVersion: 1,
      sourceId: 'synthetic',
      sourceVersion: '0.1.0',
    });
  });

  it('contains zero external runtime dependencies in adapters/synthetic/package.json', () => {
    const pkgPath = path.resolve(__dirname, '../adapters/synthetic/package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const content = JSON.parse(raw) as { dependencies?: Record<string, string> };

    const deps = Object.keys(content.dependencies ?? {});
    expect(deps.sort()).toEqual(['@busca-ofertas-ai/adapter-sdk', '@busca-ofertas-ai/core']);
  });

  it('NETWORK GUARD: adapters/synthetic contains zero HTTP, socket, DNS or browser calls', () => {
    const srcDir = path.resolve(__dirname, '../adapters/synthetic/src');
    const files = fs
      .readdirSync(srcDir, { recursive: true })
      .filter(
        (file) => typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.js')),
      ) as string[];

    expect(files.length).toBeGreaterThan(0);

    const forbiddenNetworkTokens = [
      'fetch(',
      'axios',
      'http.request',
      'https.request',
      'net.connect',
      'dns.lookup',
      'WebSocket',
      'playwright',
      'puppeteer',
      'cheerio',
    ];

    for (const file of files) {
      const fullPath = path.join(srcDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      for (const token of forbiddenNetworkTokens) {
        expect(content.includes(token), `Forbidden network token '${token}' found in ${file}`).toBe(
          false,
        );
      }
    }
  });

  it('PRIVACY GUARD: adapters/synthetic fixtures contain zero real emails, tokens, passwords or cookies', () => {
    const fixturePath = path.resolve(
      __dirname,
      '../adapters/synthetic/src/fixtures/synthetic-fixtures.ts',
    );
    const content = fs.readFileSync(fixturePath, 'utf8');

    const forbiddenPatterns = [
      /[a-zA-Z0-9._%+-]+@(?!synthetic\.invalid)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Real email (excluding .invalid)
      /Bearer\s+[A-Za-z0-9-_=]+/,
      /Authorization:/i,
      /Cookie:/i,
      /Set-Cookie:/i,
      /ghp_[a-zA-Z0-9]{36}/,
      /facebook\.com/i,
    ];

    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(content)).toBe(false);
    }
  });

  it('SDK INTEGRITY PROOF: zero special-case branching for synthetic in packages/adapter-sdk, packages/core, packages/configuration', () => {
    const packagesToCheck = [
      'packages/adapter-sdk/src',
      'packages/core/src',
      'packages/configuration/src',
    ];

    for (const pkgRel of packagesToCheck) {
      const pkgDir = path.resolve(__dirname, '..', pkgRel);
      if (!fs.existsSync(pkgDir)) continue;

      const files = fs
        .readdirSync(pkgDir, { recursive: true })
        .filter(
          (file) => typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.js')),
        ) as string[];

      for (const file of files) {
        const fullPath = path.join(pkgDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');

        // Look for conditional branching on synthetic
        expect(
          content.includes("=== 'synthetic'") ||
            content.includes('=== "synthetic"') ||
            content.includes("=== 'Synthetic'") ||
            content.includes('=== "Synthetic"'),
          `Special case branch for synthetic found in ${pkgRel}/${file}`,
        ).toBe(false);
      }
    }
  });

  it('Finding 5: dependency-cruiser boundary rules enforce strict composition-root isolation and adapter whitelist', () => {
    const depcruisePath = path.resolve(__dirname, '../dependency-cruiser.config.cjs');
    const configContent = fs.readFileSync(depcruisePath, 'utf8');

    // Rule: CLI non-composition-root modules cannot import adapters
    expect(configContent).toContain('cli-non-composition-root-no-adapters');

    // Rule: adapters can ONLY depend on adapter-sdk and core (strict whitelist)
    expect(configContent).toContain('adapters-allowed-dependencies');
    expect(configContent).toContain('^packages/adapter-sdk/');
    expect(configContent).toContain('^packages/core/');

    // Rules: packages cannot depend on adapters
    expect(configContent).toContain('core-no-adapters');
    expect(configContent).toContain('adapter-sdk-no-adapters');
    expect(configContent).toContain('configuration-no-adapters');
  });
});
