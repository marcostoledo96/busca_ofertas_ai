// @ts-check
// Template adaptado para Busca Ofertas AI.
// Fuente MIT: mattpocock/skills@6654f6b60cd9d5be8b54c6fafe44346dabeb3b76

const PACKAGES_ROOT = "packages";
const R = PACKAGES_ROOT;
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-outside",
      comment: "Apps, adapters y root solo pueden importar entrypoints de packages.",
      severity: "error",
      from: { pathNot: `^${R}/` },
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment: "Un package puede acceder a sus internals, pero no a internals de otro package.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: `^${R}/$1/` },
    },
    {
      name: "tests-through-entrypoints",
      comment: "Los tests ejercitan packages mediante sus entrypoints públicos.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` },
      to: { path: PACKAGE_INTERNALS, pathNot: `^${R}/$1/tests/` },
    },
    {
      name: "tests-folder-is-private",
      comment: "Código productivo no puede importar tests ni fixtures privados.",
      severity: "error",
      from: { pathNot: `(^|/)tests?/` },
      to: { path: `(^|/)tests?/` },
    },
    {
      name: "no-circular",
      comment: "No se permiten ciclos de dependencias.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    // Agregar reglas de layering específicas solo cuando BOAI-002 las materialice.
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
