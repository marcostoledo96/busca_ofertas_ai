// @ts-check
/**
 * Dependency Cruiser Configuration — Busca Ofertas AI
 * Contractual Rules: BOAI-001 (Architectural Boundaries & Export Maps)
 * Reference: .agents/skills/boai-module-boundaries/SKILL.md
 */

const PACKAGES_ROOT = 'packages';
const R = PACKAGES_ROOT;
const PACKAGE_INTERNALS = `^${R}/[^/]+/(src|dist)/.+`;
const PACKAGE_ENTRYPOINTS = `^${R}/[^/]+/(src/(index|testing)\\.(ts|js|d\\.ts)|dist/(index|testing)\\.(ts|js|d\\.ts)|(index|testing)\\.(ts|js))$`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-relative-package-imports-from-outside',
      comment:
        'Consumidores externos (tests, apps, adapters) deben importar packages mediante @busca-ofertas-ai/*, nunca mediante paths relativos físicos.',
      severity: 'error',
      from: { pathNot: `^${R}/` },
      to: {
        path: `^${R}/`,
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'no-relative-cross-package-imports',
      comment:
        'Un package no puede importar otro package mediante paths relativos físicos; debe usar @busca-ofertas-ai/*.',
      severity: 'error',
      from: { path: `^${R}/([^/]+)/` },
      to: {
        path: `^${R}/`,
        pathNot: `^${R}/$1/`,
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'entrypoint-boundary-from-outside',
      comment: 'Apps, adapters y root solo pueden importar entrypoints de packages.',
      severity: 'error',
      from: { pathNot: `^${R}/` },
      to: { path: PACKAGE_INTERNALS, pathNot: PACKAGE_ENTRYPOINTS },
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment: 'Un package puede acceder a sus internals, pero no a internals de otro package.',
      severity: 'error',
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: [`^${R}/$1/`, PACKAGE_ENTRYPOINTS] },
    },
    {
      name: 'tests-through-entrypoints',
      comment:
        'Los tests ejercitan packages mediante sus entrypoints públicos o sus propios tests.',
      severity: 'error',
      from: { path: `^${R}/([^/]+)/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: [`^${R}/$1/tests/`, PACKAGE_ENTRYPOINTS] },
    },
    {
      name: 'tests-folder-is-private',
      comment: 'Código productivo no puede importar tests ni fixtures privados.',
      severity: 'error',
      from: { pathNot: `(^|/)tests?/` },
      to: { path: `(^|/)tests?/` },
    },
    {
      name: 'cli-forbidden-dependencies',
      comment: 'apps/cli no debe depender de storage-sqlite, adapters, playwright ni módulos HTTP.',
      severity: 'error',
      from: { path: '^apps/cli/' },
      to: {
        path: [
          `^${R}/storage-sqlite`,
          '^adapters/',
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
