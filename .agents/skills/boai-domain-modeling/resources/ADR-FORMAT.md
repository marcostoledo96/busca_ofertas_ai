# Formato de ADR de Busca Ofertas AI

Las ADR viven en `docs/decisions/` y usan el formato existente `ADR-NNN-slug.md`.

## Plantilla mínima

```md
# ADR-NNN — Título

**Estado:** Proposed | Accepted | Superseded by ADR-NNN | Rejected

## Contexto

Problema y restricciones relevantes.

## Decisión

Decisión adoptada y límite explícito.

## Alternativas consideradas

Solo las que ayuden a evitar reabrir el mismo debate.

## Consecuencias

Efectos importantes, riesgos y migraciones.
```

## Cuándo corresponde

Crear una ADR solo si se cumplen las tres condiciones:

1. cambiar la decisión más adelante tendría costo significativo;
2. el motivo no resultaría obvio al leer el código;
3. hubo alternativas reales y un trade-off.

No crear ADR para una elección mecánica, una dependencia fácil de reemplazar o un detalle ya impuesto por la issue.
