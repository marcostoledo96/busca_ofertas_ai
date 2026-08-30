# 07 — Backlog completo

## Convenciones

- ID estable: `BOAI-NNN`.
- Prioridad: `P0` bloqueante, `P1` necesaria, `P2` mejora cercana, `P3` futura.
- Épicas: `E0` a `E8`.
- Los números reales de GitHub pueden cambiar; el ID estable debe conservarse en título, branch, PR y documentación.
- Una issue es una unidad de trabajo; no agrupar la siguiente en la misma rama.

## Ejecución con Gentle AI

La ruta se decide orgánicamente al iniciar cada acción. Las orientaciones siguientes son no vinculantes:

| Señal | Orientación inicial |
|---|---|
| Cambio mecánico conocido de 1–3 archivos | Directo inline |
| Implementación amplia con contrato claro | Directo delegado |
| Ambigüedad sustancial, trade-offs o artifacts durables valiosos | Candidato a SDD, requiere aceptación explícita |

En Antigravity, SDD es secuencial y basado en artifacts. Consultar `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`.

## Orientación por épica

| Épica | Orientación inicial | Skills locales frecuentes |
|---|---|---|
| E0 | BOAI-001/005 delegado; BOAI-002/003/004 candidatos a SDD solo si aparece ambigüedad real | `boai-codebase-design`, `boai-domain-modeling`, `boai-module-boundaries` |
| E1 | Delegado directo con tests E2E offline | `boai-codebase-design` cuando cambien seams |
| E2 | Delegado directo; SDD solo ante cambio coordinado de esquema/contrato | `boai-codebase-design` |
| E3 | BOAI-017 candidato a SDD; money/policies normalmente delegados directos | `boai-domain-modeling`, `boai-codebase-design` |
| E4 | BOAI-022/023/025/026 candidatos a SDD por investigación/decisión; el resto delegado | `boai-codebase-design` |
| E5 | Delegado directo; BOAI-031 es aceptación, no nueva arquitectura | `boai-domain-modeling` cuando cambien términos |
| E6 | BOAI-032 candidato a SDD; integración de proveedor delegada | `boai-codebase-design` |
| E7 | Candidato a SDD cuando se elija mecanismo externo; después delegado | `boai-codebase-design` |
| E8 | Candidato a SDD por arquitectura extensible | `boai-domain-modeling`, `boai-codebase-design` |

Gentle AI debe reevaluar esta orientación según el cambio efectivo; la tabla no autoriza SDD.

## Seguimiento en GitHub

- Issue índice: [#41 — Roadmap general](https://github.com/marcostoledo96/busca_ofertas_ai/issues/41).
- Implementación del MVP: `BOAI-001` a `BOAI-031`.
- El MVP termina contractualmente en [#32 — BOAI-031](https://github.com/marcostoledo96/busca_ofertas_ai/issues/32).
- Trabajo posterior al MVP: `BOAI-032` a `BOAI-039`.

| ID estable | Issue |
|---|---:|
| BOAI-001 | [#2](https://github.com/marcostoledo96/busca_ofertas_ai/issues/2) |
| BOAI-002 | [#3](https://github.com/marcostoledo96/busca_ofertas_ai/issues/3) |
| BOAI-003 | [#4](https://github.com/marcostoledo96/busca_ofertas_ai/issues/4) |
| BOAI-004 | [#5](https://github.com/marcostoledo96/busca_ofertas_ai/issues/5) |
| BOAI-005 | [#6](https://github.com/marcostoledo96/busca_ofertas_ai/issues/6) |
| BOAI-006 | [#7](https://github.com/marcostoledo96/busca_ofertas_ai/issues/7) |
| BOAI-007 | [#8](https://github.com/marcostoledo96/busca_ofertas_ai/issues/8) |
| BOAI-008 | [#9](https://github.com/marcostoledo96/busca_ofertas_ai/issues/9) |
| BOAI-009 | [#10](https://github.com/marcostoledo96/busca_ofertas_ai/issues/10) |
| BOAI-010 | [#11](https://github.com/marcostoledo96/busca_ofertas_ai/issues/11) |
| BOAI-011 | [#12](https://github.com/marcostoledo96/busca_ofertas_ai/issues/12) |
| BOAI-012 | [#13](https://github.com/marcostoledo96/busca_ofertas_ai/issues/13) |
| BOAI-013 | [#14](https://github.com/marcostoledo96/busca_ofertas_ai/issues/14) |
| BOAI-014 | [#15](https://github.com/marcostoledo96/busca_ofertas_ai/issues/15) |
| BOAI-015 | [#16](https://github.com/marcostoledo96/busca_ofertas_ai/issues/16) |
| BOAI-016 | [#17](https://github.com/marcostoledo96/busca_ofertas_ai/issues/17) |
| BOAI-017 | [#18](https://github.com/marcostoledo96/busca_ofertas_ai/issues/18) |
| BOAI-018 | [#19](https://github.com/marcostoledo96/busca_ofertas_ai/issues/19) |
| BOAI-019 | [#20](https://github.com/marcostoledo96/busca_ofertas_ai/issues/20) |
| BOAI-020 | [#21](https://github.com/marcostoledo96/busca_ofertas_ai/issues/21) |
| BOAI-021 | [#22](https://github.com/marcostoledo96/busca_ofertas_ai/issues/22) |
| BOAI-022 | [#23](https://github.com/marcostoledo96/busca_ofertas_ai/issues/23) |
| BOAI-023 | [#24](https://github.com/marcostoledo96/busca_ofertas_ai/issues/24) |
| BOAI-024 | [#25](https://github.com/marcostoledo96/busca_ofertas_ai/issues/25) |
| BOAI-025 | [#26](https://github.com/marcostoledo96/busca_ofertas_ai/issues/26) |
| BOAI-026 | [#27](https://github.com/marcostoledo96/busca_ofertas_ai/issues/27) |
| BOAI-027 | [#28](https://github.com/marcostoledo96/busca_ofertas_ai/issues/28) |
| BOAI-028 | [#29](https://github.com/marcostoledo96/busca_ofertas_ai/issues/29) |
| BOAI-029 | [#30](https://github.com/marcostoledo96/busca_ofertas_ai/issues/30) |
| BOAI-030 | [#31](https://github.com/marcostoledo96/busca_ofertas_ai/issues/31) |
| BOAI-031 | [#32](https://github.com/marcostoledo96/busca_ofertas_ai/issues/32) |
| BOAI-032 | [#33](https://github.com/marcostoledo96/busca_ofertas_ai/issues/33) |
| BOAI-033 | [#34](https://github.com/marcostoledo96/busca_ofertas_ai/issues/34) |
| BOAI-034 | [#35](https://github.com/marcostoledo96/busca_ofertas_ai/issues/35) |
| BOAI-035 | [#36](https://github.com/marcostoledo96/busca_ofertas_ai/issues/36) |
| BOAI-036 | [#37](https://github.com/marcostoledo96/busca_ofertas_ai/issues/37) |
| BOAI-037 | [#38](https://github.com/marcostoledo96/busca_ofertas_ai/issues/38) |
| BOAI-038 | [#39](https://github.com/marcostoledo96/busca_ofertas_ai/issues/39) |
| BOAI-039 | [#40](https://github.com/marcostoledo96/busca_ofertas_ai/issues/40) |

## E0 — Fundación y contratos

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-001 | P0 | Inicializar workspace TypeScript y quality gates | — |
| BOAI-002 | P0 | Implementar dominio, casos de uso y límites de dependencias | 001 |
| BOAI-003 | P0 | Implementar Adapter SDK y errores tipados | 002 |
| BOAI-004 | P0 | Implementar configuración versionada y Source Registry | 002, 003 |
| BOAI-005 | P1 | Implementar CI, seguridad de dependencias y validación de procedencia | 001 |

## E1 — Experiencia local

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-006 | P0 | Implementar shell CLI interactiva | 002, 004 |
| BOAI-007 | P0 | Implementar wizard para crear y editar búsquedas | 004, 006 |
| BOAI-008 | P1 | Crear launcher de Ubuntu y resolver directorios XDG | 006 |
| BOAI-009 | P0 | Implementar adapter sintético y escenario demo | 003, 004 |

## E2 — Persistencia, historial y reportes

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-010 | P0 | Inicializar SQLite y framework de migraciones | 001, 002 |
| BOAI-011 | P0 | Persistir búsquedas, runs, source runs y publicaciones | 010 |
| BOAI-012 | P0 | Implementar identidad canónica, deduplicación e historial de observaciones | 011 |
| BOAI-013 | P0 | Implementar reporte HTML local autocontenido | 002, 011 |
| BOAI-014 | P1 | Implementar exportaciones JSON y CSV | 011 |
| BOAI-015 | P1 | Implementar flujo de revisión y feedback manual | 006, 011, 013 |
| BOAI-016 | P1 | Implementar artifacts crudos, retención y limpieza | 010, 011 |

## E3 — Evaluación y dinero

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-017 | P0 | Implementar motor de reglas y evaluación explicable | 002, 004 |
| BOAI-018 | P0 | Implementar parser de importes ARS y texto crudo | 002 |
| BOAI-019 | P0 | Resolver monedas y conversión manual USD → ARS | 018 |
| BOAI-020 | P0 | Detectar precios implausibles, señas, cuotas y valores parciales | 017, 018, 019 |
| BOAI-021 | P1 | Aplicar umbrales y políticas configurables por búsqueda | 004, 017 |

## E4 — Facebook Marketplace

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-022 | P0 | Spike GraphQL basado en `secondhand-mcp` | 003, 005, 009 |
| BOAI-023 | P0 | Productivizar adapter Facebook GraphQL con paginación, radio y orden | 022 |
| BOAI-024 | P0 | Implementar health checks, errores y zero-result confirmado | 023 |
| BOAI-025 | P0 | Validar ubicaciones e integración AMBA | 023, 024 |
| BOAI-026 | P1 | Implementar fallback Playwright y autenticación manual | 024, 025 |
| BOAI-027 | P0 | Crear fixtures argentinos y contract tests de Facebook | 022, 023, 024 |

## E5 — Primer dominio: Nintendo Switch Lite

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-028 | P0 | Implementar clasificador de Nintendo Switch Lite | 017, 027 |
| BOAI-029 | P0 | Implementar reglas de condición, accesorios y defectos | 028 |
| BOAI-030 | P0 | Publicar configuración `switch-lite-amba` | 019, 021, 025, 029 |
| BOAI-031 | P0 | Completar aceptación end-to-end del MVP | 007–030 aplicables |

## E6 — IA complementaria, posterior al MVP

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-032 | P2 | Crear contrato neutral de proveedores IA | 017, 021, 031 |
| BOAI-033 | P2 | Integrar DeepSeek con parser estricto, caché y presupuesto | 032 |

## E7 — Nuevas fuentes

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-034 | P2 | Implementar adapter Mercado Libre | 003, 012, 031 |
| BOAI-035 | P2 | Implementar watcher de URL exacta | 003, 012, 031 |
| BOAI-036 | P3 | Implementar adapter genérico de tiendas | 035 |

## E8 — Extensibilidad futura

| ID | P | Título | Depende de |
|---|---:|---|---|
| BOAI-037 | P3 | Diseñar carga de plugins y compatibilidad de versiones | 003, 031 |
| BOAI-038 | P3 | Incorporar módulos de inmuebles y vehículos | 002, 037 |
| BOAI-039 | P2 | Endurecer observabilidad, diagnósticos y mantenimiento de upstreams | 005, 024, 031 |

## Orden recomendado de ejecución

```text
001 → 002 → 003 → 004
              ├→ 006 → 007 → 008
              ├→ 009
              ├→ 010 → 011 → 012 → 013/014/015/016
              └→ 017 → 018 → 019 → 020 → 021

022 → 023 → 024 → 025 → 027
                         └→ 026 (si hace falta)

028 → 029 → 030 → 031

Post-MVP: 032/033 → 034 → 035 → 036 → 037/038/039
```

## Definition of Ready

Una issue está lista cuando:

- tiene objetivo y contexto;
- declara alcance y fuera de alcance;
- identifica documentos y ADR aplicables;
- enumera criterios de aceptación verificables;
- explicita dependencias;
- señala procedencia si reutiliza código;
- no depende de una decisión de producto pendiente;
- puede iniciarse como unidad aislada;
- identifica skills probables sin convertirlas en autoridad;
- permite que Gentle AI decida la ruta al comenzar.

## Definition of Done

- criterios cumplidos;
- tests agregados;
- quality gates en verde;
- documentación sincronizada;
- errores observables;
- datos de prueba sintéticos o sanitizados;
- sin secretos;
- procedencia actualizada;
- ruta, skills y artifacts/review registrados cuando apliquen;
- registry generado fuera del commit;
- PR acotada y árbol limpio.
