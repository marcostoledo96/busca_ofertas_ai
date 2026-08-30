# Procedencia

- Catálogo: `https://skills.sh/mattpocock/skills/setup-ts-deep-modules`
- Repositorio: `https://github.com/mattpocock/skills`
- SHA: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- Archivo base: `skills/in-progress/setup-ts-deep-modules/SKILL.md`
- Recurso base: `dependency-cruiser.config.cjs`
- Madurez upstream: `in-progress`
- Licencia: MIT, conservada en `../_licenses/mattpocock-skills-MIT.txt`

## Adaptaciones

- skill marcada explicit-only;
- root de packages fijado a `packages/`;
- topología alineada con ADR-001/002 y BOAI-001;
- se eliminó el scaffold genérico en favor de módulos reales y adapter sintético;
- se mantuvo la prueba pass-fail-pass;
- no selecciona versiones, arquitectura, routing ni delivery fuera de la issue.
