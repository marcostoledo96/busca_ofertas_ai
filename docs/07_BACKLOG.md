# 07 — Backlog completo

## Convenciones

- ID estable: `BOAI-NNN`.
- Prioridad: `P0` bloqueante, `P1` necesaria, `P2` mejora cercana, `P3` futura.
- Épicas: `E0` a `E8`.
- Los números reales de GitHub pueden cambiar; el ID estable debe conservarse en título, branch, PR y documentación.

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
- no depende de una decisión de producto pendiente.

## Definition of Done

- criterios cumplidos;
- tests agregados;
- quality gates en verde;
- documentación sincronizada;
- errores observables;
- datos de prueba sintéticos o sanitizados;
- sin secretos;
- procedencia actualizada;
- PR acotada y árbol limpio.
