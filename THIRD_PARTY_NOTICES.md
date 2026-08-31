# Avisos de terceros

Este archivo registra fuentes externas estudiadas, incorporadas o previstas para reutilización. La inclusión en esta lista no significa que todo su código forme parte del producto.

## Skills incorporadas y adaptadas

### `mattpocock/skills`

- Repositorio: `https://github.com/mattpocock/skills`
- SHA: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- Licencia: MIT
- Contenido utilizado: `domain-modeling`, `codebase-design`, `setup-ts-deep-modules` y recursos seleccionados.
- Ubicación derivada: `.agents/skills/boai-*`.
- Adaptaciones: traducción, namespacing, paths BOAI, autoridad contractual, modelo secuencial de Antigravity y límites de Gentle AI.
- Licencia conservada: `.agents/skills/_licenses/mattpocock-skills-MIT.txt`.
- Lock detallado: `.agents/skills.lock.yml`.

La skill `setup-ts-deep-modules` está marcada upstream como `in-progress`; la variante local es explicit-only y fue reducida al alcance contractual de BOAI-001/002.

## Herramienta de workflow fijada

### `Gentleman-Programming/gentle-ai`

- Release: `v2.5.0-rc.3`
- Commit: `8e5c79b08c14b5ecded4a449e7d21cd526f52e94`
- Licencia: MIT
- Uso: routing orgánico, SDD opcional, review/RDD opcional y skill registry en Antigravity.
- Estado: herramienta externa instalada por el usuario; no se vendorea ningún binario.
- Contrato: `GENTLE_AI.lock.yml` y `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`.

## Acciones de GitHub CI fijadas

### `actions/checkout`

- Repositorio: `https://github.com/actions/checkout`
- Release: `v7.0.1`
- Commit SHA: `3d3c42e5aac5ba805825da76410c181273ba90b1`
- Licencia: MIT
- Uso: checkout del repositorio en GitHub Actions con `persist-credentials: false`.
- Estado: herramienta externa de CI fijada por commit SHA completo en `.github/workflows/ci.yml`.

### `actions/setup-node`

- Repositorio: `https://github.com/actions/setup-node`
- Release: `v7.0.0`
- Commit SHA: `820762786026740c76f36085b0efc47a31fe5020`
- Licencia: MIT
- Uso: configuración del runtime Node.js 22 y caché de pnpm en GitHub Actions.
- Estado: herramienta externa de CI fijada por commit SHA completo en `.github/workflows/ci.yml`.

### `pnpm/action-setup`

- Repositorio: `https://github.com/pnpm/action-setup`
- Release: `v6.0.10`
- Commit SHA: `0977fd99725f1db4007ccb2928dbb4e90d06cc86`
- Licencia: MIT
- Uso: instalación de pnpm 10 en GitHub Actions sin ejecución automática de install.
- Estado: herramienta externa de CI fijada por commit SHA completo en `.github/workflows/ci.yml`.


## Código previsto para reutilización

### `jlsookiki/secondhand-mcp`

- Repositorio: `https://github.com/jlsookiki/secondhand-mcp`
- SHA auditado: `6241a770013348c3f69db3a5301999c536e0e700`
- Licencia: MIT
- Uso previsto: partes aisladas del collector GraphQL de Facebook, retry/backoff, parseo y tests.
- Condición: conservar el aviso MIT y documentar cada archivo o fragmento adaptado.

### `gmoz22/facebook-marketplace-nationwide`

- Repositorio: `https://github.com/gmoz22/facebook-marketplace-nationwide`
- SHA auditado: `d5f02ea075e89e6f8e2460cb218f1077dcaee2e8`
- Licencia: MIT
- Uso previsto: referencias e identificadores geográficos de Argentina y parámetros de búsqueda.
- Condición: revalidar los IDs antes de depender de ellos.

## Código propio previsto para adaptación

### `marcostoledo96/busca_empleos`

- Repositorio: `https://github.com/marcostoledo96/busca_empleos`
- SHA de referencia: `38455d152963794a8e07a5b324a2c0f03dd265e3`
- Titular: Marcos Ezequiel Toledo
- Uso previsto: patrones y módulos puros de registry, normalización, reglas deterministas, parser estricto de IA, caché por hash, logging y tests.
- Condición: adaptar al nuevo dominio, TypeScript, SQLite y contratos de Busca Ofertas AI; no copiar la aplicación full-stack.

## Referencias sin incorporación directa

### `BoPeng/ai-marketplace-monitor`

- SHA auditado: `16394b3e2a8c232f6d78a942fb85237f4e193a85`
- Licencia: AGPL-3.0
- Uso permitido en este proyecto MIT: referencia funcional, estudio de layouts, comparación y diseño de casos de prueba.
- Restricción: no copiar código AGPL dentro del núcleo MIT sin una decisión explícita de relicenciamiento del proyecto.

### `evanoseen/fb-car-bot`

- SHA auditado: `c0f293dc24153bc73500bf6d26033b3064f0d0eb`
- Licencia: MIT
- Uso previsto: referencia de sesión manual, `storageState`, SQLite y operación local.
- Restricción: no reutilizar sin corregir la semántica de entrega, el hardcode geográfico y las carreras detectadas en la auditoría.

## Obligación de actualización

Toda PR que incorpore código, fixtures, datos, skills o diseño sustancial de un tercero debe actualizar:

1. este archivo;
2. `UPSTREAMS.lock.yml`;
3. el lock específico (`.agents/skills.lock.yml`, `GENTLE_AI.lock.yml` u otro);
4. `docs/05_REUSE_STRATEGY.md` o el documento de workflow aplicable;
5. los encabezados/archivos de procedencia del módulo afectado;
6. los tests que demuestren la adaptación.
