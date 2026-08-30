# AGENTS.md — `adapters/facebook-graphql`

## Objetivo

Implementar el collector GraphQL de Facebook como adapter aislado, comenzando por un spike basado en código MIT de `secondhand-mcp`.

## Reglas específicas

- no copiar servidor MCP ni otros marketplaces;
- registrar procedencia por archivo;
- aislar `doc_id` y contratos internos en un módulo versionado;
- health check debe realizar una operación externa mínima;
- implementar paginación por cursor;
- aplicar o declarar limitaciones de radio y sort;
- no asumir que el primer resultado geográfico es correcto;
- aceptar IDs/coord explícitos para AMBA;
- medir edges recibidos, parseados y rechazados;
- payload inesperado = `CONTRACT_CHANGED`, no cero resultados;
- detalles/fotos son enriquecimientos parciales; su fallo no descarta automáticamente la publicación base;
- sin browser ni stealth dentro de este adapter.

## Gate del spike

No promover a productivo sin informe `GO`, `GO_WITH_LIMITATIONS` o `NO_GO`, fixtures `es-AR`, comparación manual y contract tests.
