# Avisos de terceros

Este archivo registra fuentes externas estudiadas o previstas para reutilización. La mera inclusión en esta lista **no significa que su código ya haya sido incorporado**.

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

Toda PR que incorpore código, fixtures, datos o diseño sustancial de un tercero debe actualizar:

1. este archivo;
2. `UPSTREAMS.lock.yml`;
3. `docs/05_REUSE_STRATEGY.md`;
4. los encabezados o comentarios de procedencia del módulo afectado;
5. los tests que demuestren la adaptación.
