# 08 — Estrategia de testing

## Objetivo

Probar el comportamiento de negocio sin depender de sitios externos, y reservar la red en vivo para verificaciones manuales/canary explícitas.

## Capas

### Unit tests

Para:

- value objects;
- parser de precios;
- resolución de moneda;
- reglas;
- scoring;
- canonización;
- configuración;
- parsers de IA;
- serialización de exports.

Deben ser deterministas, rápidos y sin filesystem real cuando pueda usarse un temporary directory.

### Contract tests de adapters

Suite compartida aplicada a todos los adapters:

- lifecycle;
- capabilities;
- cancelación;
- errores tipados;
- cero resultados;
- paginación;
- ausencia de secretos;
- identidad estable;
- normalización sobre fixtures.

### Integration tests

Para:

- SQLite y migraciones;
- transacciones;
- repositorios;
- pipeline completo con adapter sintético;
- generación de reportes;
- retención y cleanup;
- fallback controlado entre collectors simulados.

Cada test usa una base temporal independiente.

### End-to-end local

Ejecutar la CLI contra fixtures/synthetic:

```text
crear búsqueda
→ ejecutar
→ abrir/generar reportes
→ revisar oportunidad
→ guardar feedback
→ consultar historial
```

No requiere Facebook.

### Live verification manual

Las pruebas contra Facebook:

- nunca se ejecutan en CI;
- requieren una bandera explícita;
- tienen límites bajos;
- no guardan secretos ni HTML sin sanitizar;
- producen un informe de comparación;
- no son sustituto de fixtures.

## Fixtures

Carpetas previstas:

```text
tests/fixtures/synthetic/
tests/fixtures/money/
tests/fixtures/facebook/es-AR/
tests/fixtures/ai/
```

Reglas:

- preferir datos sintéticos;
- sanitizar IDs, nombres y datos de vendedores cuando se capture un caso real;
- conservar solo campos necesarios;
- documentar fecha, fuente, licencia/permiso y sanitización;
- no guardar cookies, tokens, headers de sesión ni URLs privadas.

## Characterization tests para reutilización

Antes de adaptar código de un upstream:

1. fijar SHA;
2. identificar entradas/salidas actuales;
3. crear tests que reproduzcan comportamiento útil;
4. crear tests que capturen defectos conocidos;
5. recién entonces refactorizar detrás del contrato propio.

## Casos P0 monetarios

- `$300` ambiguo;
- `ARS 250.000`;
- `USD 300`;
- `250 mil pesos`;
- seña;
- cuota;
- gratis;
- consultar;
- separadores `.` y `,`;
- límite exacto;
- conversión manual;
- ausencia de conversión de `UNKNOWN`.

## Casos P0 de fuentes

- error de red;
- timeout;
- 429;
- login requerido;
- checkpoint;
- cambio de contrato;
- parser parcial;
- cero resultados real;
- límite de páginas;
- cancelación;
- resultado duplicado en dos queries.

## Cobertura

Objetivos iniciales:

- `core`, `rules-engine`, `money` y `configuration`: 90 % o más de líneas y branches;
- adapters: cobertura alta de parsers y manejo de errores mediante fixtures;
- CLI y reportes: priorizar flujos significativos sobre perseguir cobertura artificial.

No se aceptan exclusiones de cobertura destinadas a esconder lógica compleja sin una justificación.

## CI

El pipeline mínimo ejecutará:

1. instalación reproducible con lockfile;
2. format check;
3. lint;
4. typecheck;
5. unit tests;
6. contract tests offline;
7. integration tests SQLite;
8. build;
9. auditoría de dependencias;
10. validación de archivos de procedencia.

## Regresiones

Todo bug debe incluir un test que falle antes del fix y pase después, salvo imposibilidad técnica documentada.
