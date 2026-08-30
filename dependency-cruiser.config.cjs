// @ts-check
/**
 * Dependency Cruiser Configuration — Busca Ofertas AI
 * Contractual Rules: BOAI-001 (Architectural Boundaries)
 * Reference: .agents/skills/boai-module-boundaries/SKILL.md
 */

const PACKAGES_ROOT = 'packages';
const R = PACKAGES_ROOT;
const PACKAGE_ENTRYPOINTS = `^${R}/[^/]+/(src/index\\.(ts|js|d\\.ts)|dist/index\\.(ts|js|d\\.ts)|index\\.(ts|js))$`;
const PACKAGE_INTERNALS = `^${R}/[^/]+/(src|dist)/.+`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
