---
name: boai-domain-modeling
description: Afina el lenguaje ubicuo, las invariantes y las decisiones de dominio de Busca Ofertas AI. Usar al diseñar o cambiar SavedSearch, Source, Listing, Observation, Opportunity, Run, ResolvedPrice, Evaluation, Feedback, CONTEXT.md o una ADR.
---

# Modelado de dominio de Busca Ofertas AI

Usá esta skill para cambiar el modelo conceptual, no para leer vocabulario ya definido ni para implementar una issue mecánica.

## Autoridad

Antes de proponer un cambio, leer en este orden:

1. issue contractual vigente;
2. `CONTEXT.md`;
3. `docs/02_DOMAIN_MODEL.md` y demás documentos citados;
4. ADR aceptadas en `docs/decisions/`;
5. `AGENTS.md` raíz y el más cercano;
6. contratos y tests existentes.

Esta skill no decide la ruta de Gentle AI, no inicia SDD, no cambia de issue y no autoriza delivery.

## Disciplina

### Desambiguar términos

Cuando dos palabras parezcan equivalentes, elegí una y explicá la diferencia. Ejemplos que deben mantenerse separados:

- `Source` y `SourceAdapter`;
- `SourceAdapter` y collector;
- `Listing` y `Observation`;
- `Listing` y `Opportunity`;
- `Run` y `SourceRun`;
- importe extraído y `ResolvedPrice`;
- `REVIEW` y error de fuente.

### Probar con escenarios concretos

Antes de fijar una relación, validala con casos límite. Como mínimo considerar:

- una misma publicación devuelta por dos queries;
- una publicación que cambia de precio;
- `$300` sin moneda;
- una fuente que falla antes de responder;
- una publicación que sirve a dos búsquedas con criterios distintos;
- un hard reject seguido de una respuesta favorable de IA.

### Mantener invariantes explícitas

No aceptar un modelo que permita:

- convertir moneda `UNKNOWN`;
- representar un error externo como éxito vacío;
- sobrescribir el historial de observaciones;
- revertir un hard reject con score o IA;
- acoplar el producto Nintendo a un adaptador de fuente;
- tratar feedback como mutación retroactiva de la evidencia.

## Actualización de `CONTEXT.md`

Modificar `CONTEXT.md` solamente cuando cambie el significado canónico de un término. Debe seguir siendo un glosario sin detalles de TypeScript, SQLite, rutas, frameworks ni algoritmos. Usar `resources/CONTEXT-FORMAT.md`.

## ADR

Crear una ADR únicamente cuando la decisión sea difícil de revertir, sorprendente sin contexto y resultado de una alternativa real. En este repositorio viven en `docs/decisions/` y siguen `ADR-NNN-slug.md`. Usar `resources/ADR-FORMAT.md`.

## Antigravity + Gentle AI

- Si Gentle AI eligió trabajo directo, resolver el modelado dentro de la issue y persistir solo los documentos contractualmente afectados.
- Si el usuario aceptó SDD, trabajar una fase por vez, guardar el artifact completo en la ubicación controlada por Gentle AI y volver a leerlo antes de la siguiente fase.
- No confiar en el historial del chat como estado de SDD.
- Engram solo puede conservar decisiones durables verificadas, no borradores de fase.

## Finalización

Antes de declarar el modelado listo:

- comprobar que no contradice una ADR vigente;
- actualizar tests o criterios contractuales afectados;
- verificar que los nombres aparecen de forma consistente en docs y contratos;
- registrar cualquier ruptura/migración necesaria;
- no ampliar el alcance de la issue.
