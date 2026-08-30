# AGENTS.md — `packages/adapter-sdk`

## Responsabilidad

Definir la frontera estable entre el núcleo y las fuentes externas.

## Reglas

- contratos pequeños y versionables;
- capabilities explícitas;
- `SourceAdapterError` con código, retryability y evidencia sanitizada;
- `AbortSignal` obligatorio en operaciones externas;
- no incluir decisiones de producto;
- no depender de una fuente específica;
- no exponer tipos de librerías de browser/HTTP en la API pública;
- no devolver `[]` para representar errores;
- `healthCheck` debe comprobar el camino externo real;
- datos crudos se modelan como `unknown` validado en el adapter.

## Compatibilidad

Todo cambio incompatible del SDK requiere ADR, versión mayor interna y actualización de contract tests.

## Tests

Mantener una suite reutilizable que cada adapter deba ejecutar.
