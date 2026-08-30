import { describe, it, expect } from 'vitest';
import { CORE_PACKAGE_NAME, getCorePackageMetadata } from '@busca-ofertas-ai/core';

describe('Workspace Bootstrap (BOAI-001)', () => {
  it('should execute Vitest test runner under Node.js environment >= 22', () => {
    expect(typeof process.versions.node).toBe('string');
    const [majorStr] = process.versions.node.split('.');
    const major = Number(majorStr);
    expect(major).toBeGreaterThanOrEqual(22);
  });

  it('should resolve and import @busca-ofertas-ai/core from its public entrypoint', () => {
    expect(CORE_PACKAGE_NAME).toBe('@busca-ofertas-ai/core');
    const metadata = getCorePackageMetadata();
    expect(metadata).toEqual({
      name: '@busca-ofertas-ai/core',
      initialized: true,
    });
  });
});
