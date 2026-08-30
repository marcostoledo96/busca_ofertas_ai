# ADR-005 — Licencia MIT y límites de reutilización

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

Se desea un proyecto personal reutilizable por desarrolladores. Existen fuentes MIT, código propio y una referencia relevante AGPL-3.0.

## Decisión

Licenciar Busca Ofertas AI bajo MIT.

- código MIT puede adaptarse conservando avisos;
- código propio de `busca_empleos` puede relicenciarse por su titular;
- `ai-marketplace-monitor` AGPL se usa solo como referencia funcional y de tests, no como donante de código al núcleo MIT;
- toda reutilización registra repositorio, SHA, licencia, archivos y cambios.

## Consecuencias

- licencia clara y permisiva;
- disciplina adicional de procedencia;
- algunas implementaciones útiles solo pueden estudiarse, no copiarse;
- una futura incorporación AGPL requeriría nueva ADR y posible relicenciamiento global.
