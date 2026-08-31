// @ts-check
/**
 * Dependency Cruiser Configuration — Busca Ofertas AI
 * Contractual Rules: BOAI-001, BOAI-009 (Architectural Boundaries & Export Maps)
 * Reference: .agents/skills/boai-codebase-design/SKILL.md, .agents/skills/boai-module-boundaries/SKILL.md
 */

const MODULE_ENTRYPOINTS =
  '^(?:packages|adapters)/[^/]+/(?:src/(?:index|testing)\\.(?:ts|js|d\\.ts)|dist/(?:index|testing)\\.(?:ts|js|d\\.ts)|(?:index|testing)\\.(?:ts|js))$';
const MODULE_INTERNALS = '^(?:packages|adapters)/[^/]+/(?:src|dist)/.+';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-relative-package-imports-from-outside',
      comment:
        'Consumidores externos (tests, apps, adapters) deben importar packages y adapters mediante @busca-ofertas-ai/*, nunca mediante paths relativos físicos.',
      severity: 'error',
      from: { pathNot: '^(?:packages|adapters)/' },
      to: {
        path: '^(?:packages|adapters)/',
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'no-relative-cross-package-imports',
      comment:
        'Un package o adapter no puede importar otro package/adapter mediante paths relativos físicos; debe usar @busca-ofertas-ai/*.',
      severity: 'error',
      from: { path: '^((?:packages|adapters)/[^/]+)/' },
      to: {
        path: '^(?:packages|adapters)/',
        pathNot: '^$1/',
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'entrypoint-boundary-from-outside',
      comment:
        'Apps, adapters, tests y root solo pueden importar entrypoints públicos de packages y adapters.',
      severity: 'error',
      from: { pathNot: '^(?:packages|adapters)/' },
      to: { path: MODULE_INTERNALS, pathNot: MODULE_ENTRYPOINTS },
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment:
        'Un package/adapter puede acceder a sus internals, pero no a internals de otro package/adapter.',
      severity: 'error',
      from: {
        path: '^((?:packages|adapters)/[^/]+)/',
        pathNot: '^((?:packages|adapters)/[^/]+)/tests/',
      },
      to: { path: MODULE_INTERNALS, pathNot: ['^$1/', MODULE_ENTRYPOINTS] },
    },
    {
      name: 'tests-through-entrypoints',
      comment:
        'Los tests ejercitan packages y adapters mediante sus entrypoints públicos o sus propios tests.',
      severity: 'error',
      from: { path: '^((?:packages|adapters)/[^/]+)/tests/' },
      to: { path: MODULE_INTERNALS, pathNot: ['^$1/tests/', MODULE_ENTRYPOINTS] },
    },
    {
      name: 'tests-folder-is-private',
      comment: 'Código productivo no puede importar tests ni fixtures privados.',
      severity: 'error',
      from: { pathNot: '(^|/)tests?/' },
      to: { path: '(^|/)tests?/' },
    },
    {
      name: 'core-no-adapters',
      comment: 'packages/core no debe depender de adapters.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^adapters/' },
    },
    {
      name: 'adapter-sdk-no-adapters',
      comment: 'packages/adapter-sdk no debe depender de adapters.',
      severity: 'error',
      from: { path: '^packages/adapter-sdk/' },
      to: { path: '^adapters/' },
    },
    {
      name: 'configuration-no-adapters',
      comment: 'packages/configuration no debe depender de adapters.',
      severity: 'error',
      from: { path: '^packages/configuration/' },
      to: { path: '^adapters/' },
    },
    {
      name: 'adapters-allowed-dependencies',
      comment: 'adapters solo pueden depender de adapter-sdk y core.',
      severity: 'error',
      from: { path: '^adapters/' },
      to: {
        path: [
          '^packages/storage-sqlite',
          '^apps/cli',
          '^packages/configuration',
          '^packages/rules-engine',
          '^packages/report-html',
        ],
      },
    },
    {
      name: 'cli-forbidden-dependencies',
      comment: 'apps/cli no debe depender de storage-sqlite, playwright ni módulos HTTP.',
      severity: 'error',
      from: { path: '^apps/cli/' },
      to: {
        path: [
          '^packages/storage-sqlite',
          'playwright',
          '^node:http$',
          '^node:https$',
          '^http$',
          '^https$',
        ],
      },
    },
    {
      name: 'no-circular',
      comment: 'No se permiten ciclos de dependencias.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.d.ts', '.mjs', '.cjs'],
    },
  },
};
