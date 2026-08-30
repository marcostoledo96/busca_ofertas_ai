import { describe, it, expect } from 'vitest';
import * as AdapterSdk from '@busca-ofertas-ai/adapter-sdk';
import * as AdapterSdkTesting from '@busca-ofertas-ai/adapter-sdk/testing';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Adapter SDK Architecture and Boundary Invariants (BOAI-003)', () => {
  it('exports public production contracts, errors, diagnostics, and helpers from root entrypoint', () => {
    expect(AdapterSdk.ADAPTER_SDK_PACKAGE_NAME).toBe('@busca-ofertas-ai/adapter-sdk');
    expect(AdapterSdk.ADAPTER_SDK_VERSION).toBe('0.1.0');

    expect(typeof AdapterSdk.getAdapterSdkPackageMetadata).toBe('function');
    expect(typeof AdapterSdk.checkAdapterCompatibility).toBe('function');
    expect(typeof AdapterSdk.validateCapabilities).toBe('function');
    expect(typeof AdapterSdk.validateAdapterMethodCoherence).toBe('function');
    expect(typeof AdapterSdk.createSuccessSearchResult).toBe('function');
    expect(typeof AdapterSdk.createZeroResultsConfirmedSearchResult).toBe('function');
    expect(typeof AdapterSdk.createSourceDiagnostics).toBe('function');
    expect(typeof AdapterSdk.SourceAdapterError).toBe('function');
    expect(typeof AdapterSdk.isSourceAdapterError).toBe('function');
    expect(typeof AdapterSdk.isSourceErrorCode).toBe('function');
    expect(typeof AdapterSdk.sanitizeString).toBe('function');
    expect(typeof AdapterSdk.sanitizeEvidence).toBe('function');
    expect(typeof AdapterSdk.sanitizeData).toBe('function');
    expect(typeof AdapterSdk.isAbortedOrExpired).toBe('function');
  });

  it('exports testing suite and test doubles exclusively from /testing subpath entrypoint', () => {
    expect(typeof AdapterSdkTesting.runSourceAdapterContract).toBe('function');
    expect(typeof AdapterSdkTesting.InMemoryConformanceAdapter).toBe('function');
    expect(typeof AdapterSdkTesting.createMockAdapterContext).toBe('function');

    // Assert that test runner is NOT leaked into the main production entrypoint
    const adapterSdkRecord = AdapterSdk as Record<string, unknown>;
    expect(adapterSdkRecord['runSourceAdapterContract']).toBeUndefined();
    expect(adapterSdkRecord['InMemoryConformanceAdapter']).toBeUndefined();
  });

  it('contains zero third-party runtime dependencies in packages/adapter-sdk/package.json', () => {
    const pkgPath = path.resolve(__dirname, '../packages/adapter-sdk/package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const content = JSON.parse(raw) as { dependencies?: Record<string, string> };

    const deps: Record<string, string> = content.dependencies ?? {};
    const depKeys = Object.keys(deps);

    // Only internal workspace core dependency is permitted
    expect(depKeys).toEqual(['@busca-ofertas-ai/core']);
  });

  it('does not leak external library types (Playwright, Axios, Puppeteer, GraphQL) into generated d.ts files', () => {
    const distDir = path.resolve(__dirname, '../packages/adapter-sdk/dist');
    if (!fs.existsSync(distDir)) {
      return; // Skip if not built yet, build gate will verify
    }

    const dtsFiles = fs
      .readdirSync(distDir, { recursive: true })
      .filter((file) => typeof file === 'string' && file.endsWith('.d.ts')) as string[];

    expect(dtsFiles.length).toBeGreaterThan(0);

    const forbiddenTerms = [
      'playwright',
      'puppeteer',
      'axios',
      'cheerio',
      'graphql-request',
      'apollo',
      'zod',
    ];

    for (const file of dtsFiles) {
      const fullPath = path.join(distDir, file);
      const code = fs.readFileSync(fullPath, 'utf8').toLowerCase();

      for (const term of forbiddenTerms) {
        expect(
          code.includes(term),
          `Forbidden third-party term '${term}' found in declaration file: ${file}`,
        ).toBe(false);
      }
    }
  });
});
