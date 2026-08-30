# Architecture Decision Records

Las ADR registran decisiones permanentes y sus consecuencias.

## Estados

- `Proposed`
- `Accepted`
- `Superseded by ADR-NNN`
- `Rejected`

## Reglas

- no editar retrospectivamente la decisión de una ADR aceptada para cambiar su significado;
- correcciones editoriales menores son válidas;
- un cambio de decisión crea una ADR nueva y marca la anterior como superseded;
- toda PR que contradiga una ADR necesita incorporar primero la nueva decisión.

## Índice

| ADR | Decisión | Estado |
|---|---|---|
| [001](ADR-001-local-first-typescript-monorepo.md) | Aplicación local-first y monorepo TypeScript | Accepted |
| [002](ADR-002-adapter-architecture.md) | Adaptadores internos y SDK estable | Accepted |
| [003](ADR-003-sqlite-persistence.md) | SQLite como persistencia del MVP | Accepted |
| [004](ADR-004-deterministic-rules-before-ai.md) | Reglas deterministas antes que IA | Accepted |
| [005](ADR-005-mit-and-license-boundaries.md) | MIT y límites de reutilización | Accepted |
| [006](ADR-006-manual-execution-no-notifications.md) | Ejecución manual sin notificaciones en MVP | Accepted |
| [007](ADR-007-facebook-collectors.md) | Spike GraphQL y Playwright condicional | Accepted |
| [008](ADR-008-static-local-reports.md) | HTML estático más JSON y CSV | Accepted |
