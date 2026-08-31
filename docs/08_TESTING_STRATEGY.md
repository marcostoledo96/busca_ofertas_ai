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

El pipeline contractual de GitHub Actions (`.github/workflows/ci.yml`) ejecuta de forma determinista y offline:

1. checkout con permisos mínimos (`contents: read`, `persist-credentials: false`);
2. setup de pnpm 10 y Node.js 22 desde `.nvmrc` con caché derivado de `pnpm-lock.yaml`;
3. rechazo de archivos generados de registry (`node scripts/ci/check-generated-files.mjs`);
4. escaneo de secretos y credenciales trackeadas (`node scripts/ci/scan-secrets.mjs`);
5. auditoría de dependencias (`pnpm audit --audit-level=high`);
6. instalación reproducible congelada (`pnpm install --frozen-lockfile`);
7. limpieza de builds anteriores (`pnpm clean`);
8. verificación de formato (`pnpm format:check`);
9. análisis estático estricto (`pnpm lint`);
10. verificación de límites arquitectónicos (`pnpm lint:boundaries`);
11. verificación de tipos (`pnpm typecheck`);
12. ejecución de la suite completa de tests (`pnpm test`);
13. compilación del workspace (`pnpm build`);
14. validación semántica de procedencia cruzada y actions (`pnpm ci:provenance`);
15. validación estructural de la política de CI (`pnpm ci:workflow`);
16. verificación de inmutabilidad del árbol trackeado (`git diff --exit-code`).

## Regresiones

Todo bug debe incluir un test que falle antes del fix y pase después, salvo imposibilidad técnica documentada.
