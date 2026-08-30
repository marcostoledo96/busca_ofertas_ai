# AGENTS.md — `tests`

## Reglas

- no usar red real en CI;
- datos sintéticos por defecto;
- fixtures reales solo sanitizados y documentados;
- ningún secreto, cookie, token, nombre o dato personal innecesario;
- tests independientes del orden;
- filesystem y SQLite en directorios temporales;
- reloj e IDs deterministas;
- distinguir unit, contract, integration y e2e;
- live tests bajo bandera explícita y fuera del gate normal;
- todo bug corregido agrega regresión;
- evitar snapshots gigantes y frágiles;
- los fixtures deben declarar schema/source/version.

## Tests de procedencia

Cuando se adapte upstream, conservar tests de caracterización y casos que reproduzcan defectos conocidos.
