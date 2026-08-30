# 05 — Estrategia de reutilización

## Objetivo

Maximizar reutilización comprobable sin convertir el proyecto en una mezcla difícil de mantener ni violar límites de licencia.

## Regla de oro

> Reutilizar contratos y componentes aislados; no fusionar aplicaciones completas sin una razón demostrada.

## Fuentes

### `marcostoledo96/busca_empleos`

Código propio autorizado para adaptación.

Reutilización prioritaria:

- registry central de fuentes;
- separación extracción/normalización;
- motor de reglas deterministas;
- parser estricto de IA;
- caché por hash de contenido y configuración;
- orquestación tolerante a fallos;
- logging;
- organización de fixtures y tests;
- CI.

No trasladar:

- Express;
- Angular;
- Firebase;
- PostgreSQL;
- Apify;
- cron;
- autenticación multiusuario;
- API REST.

Toda adaptación debe convertirse a TypeScript, contratos del nuevo dominio y SQLite cuando corresponda.

### `jlsookiki/secondhand-mcp`

Fuente MIT prevista para el spike GraphQL de Facebook.

Reutilizar de forma aislada:

- construcción de requests GraphQL;
- parseo de publicaciones;
- retry/backoff;
- resolución de ubicaciones;
- tests y fixtures aplicables.

Corregir antes de considerar productivo:

- radio ignorado;
- ausencia de paginación completa;
- orden no aplicado;
- health check con falso positivo;
- `doc_id` internos sin canary;
- parseo demasiado permisivo.

No incorporar el servidor MCP, otros marketplaces ni browser helpers innecesarios.

### `gmoz22/facebook-marketplace-nationwide`

Fuente MIT prevista para datos geográficos y nombres de parámetros.

- copiar solo el bloque estrictamente necesario;
- registrar procedencia;
- revalidar IDs de ubicación;
- no incorporar la aplicación Next.js.

### `BoPeng/ai-marketplace-monitor`

AGPL-3.0, referencia únicamente.

Permitido:

- comparar comportamiento;
- estudiar layouts;
- inspirar casos de prueba;
- revisar estrategias operativas.

No permitido dentro del núcleo MIT sin nueva decisión explícita:

- copiar clases, parsers, templates o flujos sustanciales;
- derivar archivos conservando estructura de código AGPL;
- mezclar código y luego declarar el conjunto MIT.

### `evanoseen/fb-car-bot`

MIT, referencia operativa. Sus defectos auditados deben convertirse en tests negativos:

- no marcar como procesado antes de completar la acción posterior;
- no hardcodear ubicación;
- esperar handlers asíncronos;
- impedir runs superpuestos;
- detectar checkpoints además de `/login`;
- no ejecutar como root.

## Procedimiento por PR

Toda PR que reutilice código externo debe incluir una sección:

```markdown
## Procedencia
- Upstream:
- SHA:
- Licencia:
- Archivos originales:
- Archivos derivados:
- Cambios realizados:
- Tests agregados:
```

También debe actualizar:

- `THIRD_PARTY_NOTICES.md`;
- `UPSTREAMS.lock.yml`;
- encabezados de procedencia cuando el fragmento sea sustancial;
- esta estrategia si cambia el rol de un upstream.

## Evaluación make / reuse / reference

Antes de implementar una pieza:

1. buscar componente propio reutilizable;
2. revisar upstreams permitidos;
3. verificar licencia y estado exacto;
4. medir cuánto código realmente se puede aislar;
5. preferir dependencia o extracción pequeña antes que fork completo;
6. escribir tests de caracterización;
7. adaptar detrás de un contrato propio;
8. documentar divergencias.

## Actualizaciones

Los upstreams permanecen fijados por SHA. Actualizar implica:

- revisar diff desde el SHA anterior;
- repetir auditoría de licencia;
- ejecutar tests de caracterización;
- verificar fixtures argentinos;
- actualizar lock y avisos;
- no adoptar automáticamente cambios de GraphQL, selectores o sesión.

## Licencia del proyecto

MIT mientras no se incorpore código incompatible. Una decisión de incorporar AGPL requeriría una ADR nueva y revisión de licencia de todo el repositorio.
