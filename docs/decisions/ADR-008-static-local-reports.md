# ADR-008 — Reporte HTML estático y exports JSON/CSV

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

Se necesita una revisión cómoda sin desplegar una interfaz. Terminal sola resulta limitada para imágenes, razones y comparación.

## Decisión

Generar por run:

- `report.html` estático y autocontenido;
- `results.json` completo para interoperabilidad;
- `results.csv` para análisis tabular.

El HTML se abre automáticamente y muestra rechazadas en una sección colapsada.

## Consecuencias

- no requiere servidor;
- fácil de archivar y compartir manualmente;
- contenido externo debe escaparse estrictamente;
- las acciones de feedback se realizan en CLI, no dentro del HTML en el MVP;
- una UI local editable puede agregarse después sin reemplazar estos exports.
