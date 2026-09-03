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
      name: 'cli-non-composition-root-no-adapters',
      comment:
        'Solo apps/cli/src/composition-root.ts puede importar adapters; el resto de apps/cli no debe depender de adapters.',
      severity: 'error',
      from: {
        path: '^apps/cli/',
        pathNot: '^apps/cli/(src|dist)/composition-root\\.(ts|js|d\\.ts)$',
      },
      to: {
        path: '^adapters/',
      },
    },
    {
      name: 'adapters-allowed-dependencies',
      comment: 'adapters solo pueden depender de adapter-sdk, core y sus propios módulos internos.',
      severity: 'error',
      from: { path: '^adapters/([^/]+)/' },
      to: {
        path: '^(?:packages|apps|adapters)/',
        pathNot: ['^adapters/$1/', '^packages/adapter-sdk/', '^packages/core/'],
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
      name: 'report-html-forbidden-dependencies',
      comment:
        'packages/report-html es un renderer puro y no debe depender de storage-sqlite, run-export, apps/cli, node:fs, node:path, node:child_process ni playwright.',
      severity: 'error',
      from: { path: '^packages/report-html/' },
      to: {
        path: [
          '^packages/storage-sqlite',
          '^packages/run-export',
          '^apps/cli',
          'playwright',
          '^node:fs$',
          '^node:path$',
          '^node:child_process$',
          '^fs$',
          '^path$',
          '^child_process$',
        ],
      },
    },
    {
      name: 'run-export-forbidden-dependencies',
      comment:
        'packages/run-export no debe depender de storage-sqlite, report-html, apps/cli, node:fs, node:path, node:child_process ni playwright.',
      severity: 'error',
      from: { path: '^packages/run-export/' },
      to: {
        path: [
          '^packages/storage-sqlite',
          '^packages/report-html',
          '^apps/cli',
          'playwright',
          '^node:fs$',
          '^node:path$',
          '^node:child_process$',
          '^fs$',
          '^path$',
          '^child_process$',
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
