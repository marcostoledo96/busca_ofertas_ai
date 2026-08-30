# 06 — Roadmap del MVP

## Estado actual

**Etapa 0 — documentación, skills y gobernanza.** No existe todavía implementación ejecutable.

## Capa transversal: Antigravity + Gentle AI

Todas las etapas usan el workflow definido en `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`:

- Gentle AI `v2.5.0-rc.3` fijado;
- una issue por unidad de trabajo;
- routing orgánico por acción;
- SDD opcional y aceptado explícitamente;
- fases SDD secuenciales con artifacts físicos y relectura;
- un writer y verificación read-only;
- review/RDD opt-in sin autoridad de delivery;
- skills locales `boai-*` cargadas solo cuando aportan técnica relevante.

El backlog puede sugerir una ruta inicial, pero Gentle AI debe reevaluarla al comenzar cada acción.

## Etapa 0 — Contratos y gobierno

Entregables:

- brief;
- arquitectura;
- modelo de dominio;
- Adapter SDK;
- política monetaria;
- seguridad;
- backlog;
- ADR;
- `CONTEXT.md`;
- `AGENTS.md` jerárquicos;
- workflow Antigravity/Gentle AI;
- skills locales auditadas;
- locks de herramienta, skills y upstreams;
- licencia y trazabilidad.

Gate:

- no quedan decisiones bloqueantes para iniciar el workspace;
- las issues implementables citan criterios de aceptación;
- Antigravity descubre las tres skills locales;
- `gentle-ai doctor` no presenta bloqueos para comenzar;
- no se afirma que el programa ya funciona.

## Etapa 1 — Núcleo local con fuente sintética

Implementar:

- workspace TypeScript estricto;
- contratos de dominio;
- registry;
- configuración versionada;
- CLI y wizard;
- SQLite y migraciones;
- reglas y evaluación;
- adapter sintético;
- HTML, JSON y CSV;
- revisión manual.

Skills esperadas según subproblema:

- `boai-codebase-design` para packages y seams;
- `boai-module-boundaries` explícita para BOAI-001/002;
- `boai-domain-modeling` para BOAI-002.

Gate:

```text
crear búsqueda sintética
→ ejecutar
→ persistir
→ clasificar
→ exportar
→ abrir HTML
→ registrar feedback
```

Todo sin Internet.

## Etapa 2 — Motor monetario

Implementar:

- parser de importes;
- resolución ARS/USD/UNKNOWN;
- cotización manual;
- detección de seña, cuota y precio parcial;
- reglas de plausibilidad;
- historial de precios.

Gate P0:

```text
$300 sin evidencia nunca se interpreta automáticamente como ARS 300.
```

## Etapa 3 — Spike Facebook GraphQL

Extraer el mínimo necesario de `secondhand-mcp` detrás del Adapter SDK.

Probar:

- resultados reales argentinos;
- AMBA;
- paginación;
- radio;
- newest-first;
- detalles;
- moneda;
- cambio de contrato;
- zero results confirmado.

Esta etapa es candidata a SDD por investigación/decisión, pero solo si Gentle AI lo propone y el usuario acepta.

Gate:

- informe técnico que decida `GO`, `GO_WITH_LIMITATIONS` o `NO_GO`;
- no declarar productivo el spike;
- procedencia y licencia registradas.

## Etapa 4 — Adapter Facebook productivo

Implementar:

- normalización estable;
- ubicación AMBA;
- límites y cancelación;
- health check real;
- errores tipados;
- artifacts sanitizados;
- fixtures `es-AR`;
- integración con runs e historial.

Gate:

- una falla no se representa como cero resultados;
- tests de contrato en verde;
- resultados manualmente comparados con una búsqueda equivalente.

## Etapa 5 — Fallback Playwright

Solo si el spike demuestra necesidad. La decisión debe quedar en la issue/ADR o artifact aceptado; no se implementa por prevención.

Implementar:

- Playwright estándar;
- login manual;
- sesión local;
- detección de expiración, checkpoint y CAPTCHA;
- fallback explícito y visible;
- cierre seguro de browser/context/page.

Gate:

- ninguna credencial en código o logs;
- no existe bypass de controles;
- el usuario recibe instrucciones de intervención;
- el reporte identifica qué collector se usó.

## Etapa 6 — Reglas Nintendo Switch Lite

Implementar:

- modelo Lite;
- accesorios y juegos;
- cajas vacías y repuestos;
- funcionalidad y defectos;
- condiciones aceptadas;
- señas/cuotas;
- precios y moneda;
- configuración `switch-lite-amba`.

Gate:

- menos del 10 % de falsos positivos entre `MATCH` en el conjunto de validación;
- ningún accessory-only conocido entra como `MATCH`;
- defectos funcionales prohibidos generan rechazo duro;
- `$300` permanece en `REVIEW` si sigue ambiguo.

## Etapa 7 — Aceptación del MVP

Validar extremo a extremo:

- instalación local;
- launcher de Ubuntu;
- wizard;
- Facebook;
- SQLite;
- historial;
- reporte y exports;
- revisión y feedback;
- limpieza por retención;
- errores y diagnósticos;
- CI;
- evidencia de workflow y skills sin registry generado en Git.

El MVP termina aquí.

## Después del MVP

Orden previsto:

1. proveedor neutral de IA y DeepSeek;
2. Mercado Libre;
3. watcher de URL exacta;
4. adapter genérico de tiendas;
5. plugins externos;
6. módulos de inmuebles y vehículos;
7. notificaciones opcionales;
8. automatización opcional.

Ningún trabajo post-MVP bloquea la utilidad del primer caso de uso.
