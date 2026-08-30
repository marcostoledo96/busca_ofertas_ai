/**
 * @busca-ofertas-ai/core
 *
 * Foundational core package for Busca Ofertas AI.
 * Domain entities, value objects, and ports will be introduced in BOAI-002.
 */

export const CORE_PACKAGE_NAME = '@busca-ofertas-ai/core' as const;

export interface CorePackageMetadata {
  readonly name: typeof CORE_PACKAGE_NAME;
  readonly initialized: boolean;
}

export const getCorePackageMetadata = (): CorePackageMetadata => ({
  name: CORE_PACKAGE_NAME,
  initialized: true,
});
