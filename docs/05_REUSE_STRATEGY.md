# 05 — Estrategia de reutilización

## Objetivo

Maximizar reutilización comprobable sin convertir el proyecto en una mezcla difícil de mantener ni violar límites de licencia.

## Regla de oro

> Reutilizar contratos y componentes aislados; no fusionar aplicaciones completas sin una razón demostrada.

## Dos clases de reutilización

### Código de producto

Collectors, normalizadores, reglas, datos geográficos y tests que pueden terminar dentro de la aplicación. Se controla mediante `UPSTREAMS.lock.yml`, notices, archivos de procedencia y tests de caracterización.

### Herramientas y skills de desarrollo

Gentle AI y skills de Antigravity guían el proceso, pero no forman parte del runtime del producto. Se controlan mediante `GENTLE_AI.lock.yml`, `.agents/skills.lock.yml`, `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md` y `docs/14_PROJECT_SKILLS.md`.

Una skill no autoriza a incorporar automáticamente código de su upstream al producto.

## Fuentes de producto

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

## Skills y workflow

### `mattpocock/skills`

Tres skills MIT se incorporan de forma adaptada y namespaced:

- `boai-domain-modeling`;
- `boai-codebase-design`;
- `boai-module-boundaries`.

No se usan los nombres originales para evitar colisiones globales. El SHA, archivos base, adaptaciones y licencia se registran en `.agents/skills.lock.yml` y dentro de cada `UPSTREAM.md`.

### Gentle AI

Gentle AI se fija como herramienta externa, no vendoreada. Cambiar la versión requiere revisar:

- routing orgánico;
- proyecciones administradas;
- formato de artifacts;
- compatibilidad Antigravity;
- review/RDD y comandos de continuación;
- skill registry.

No copiar contenido administrado por una versión distinta ni mezclar proyecciones sin ejecutar `gentle-ai sync` después de la actualización aceptada.

### Acciones de GitHub CI

Las GitHub Actions externas utilizadas en los workflows (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`) son herramientas externas ejecutables de CI.
- No constituyen código de runtime del producto ni se vendorean sus fuentes en el árbol de trabajo.
- Se fijan inmutablemente por commit SHA completo de 40 caracteres en `.github/workflows/ci.yml`.
- Se registran en `UPSTREAMS.lock.yml` (con rol `ci-action` y estado `pinned-ci-action`) y en `THIRD_PARTY_NOTICES.md`.
- El validador `pnpm ci:provenance` exige consistencia cruzada automática entre las Actions utilizadas en los workflows y las registradas en `UPSTREAMS.lock.yml`.


## Procedimiento por PR

Toda PR que reutilice código, datos o skills externos debe incluir:

```markdown
## Procedencia
- Upstream:
- SHA:
- Licencia:
- Archivos originales:
- Archivos derivados:
- Cambios realizados:
- Tests/verificación agregados:
```

También debe actualizar lo aplicable:

- `THIRD_PARTY_NOTICES.md`;
- `UPSTREAMS.lock.yml`;
- `.agents/skills.lock.yml` o `GENTLE_AI.lock.yml`;
- encabezados/`UPSTREAM.md` cuando el fragmento sea sustancial;
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

Para una skill, además:

1. comprobar que cubre un hueco real;
2. comparar con Gentle AI y skills globales;
3. revisar instrucciones peligrosas, tooling impuesto y paths;
4. adaptar routing/delivery al contrato del proyecto;
5. probar descubrimiento después de refrescar el registry.

## Actualizaciones

Los upstreams permanecen fijados por SHA. Actualizar implica:

- revisar diff desde el SHA anterior;
- repetir auditoría de licencia y seguridad;
- ejecutar tests de caracterización o verificación de skill;
- verificar fixtures argentinos cuando aplique;
- actualizar locks y avisos;
- no adoptar automáticamente cambios de GraphQL, selectores, sesión, routing o commands.

## Licencia del proyecto

MIT mientras no se incorpore código incompatible. Una decisión de incorporar AGPL requeriría una ADR nueva y revisión de licencia de todo el repositorio.
