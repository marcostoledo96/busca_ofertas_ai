# 11 — Modelo de errores y observabilidad

## Regla central

> Una ejecución observable explica qué ocurrió en cada etapa y no confunde un fallo con ausencia de datos.

## Estados globales

```text
SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
```

`PARTIAL_SUCCESS` se usa cuando al menos una fuente o etapa útil finalizó y otra falló.

## Estados de fuente

```text
SUCCESS
ZERO_RESULTS_CONFIRMED
AUTHENTICATION_REQUIRED
MANUAL_INTERVENTION_REQUIRED
RATE_LIMITED
NETWORK_ERROR
SOURCE_UNAVAILABLE
CONTRACT_CHANGED
PARSER_FAILED
TIMEOUT
CONFIGURATION_UNSUPPORTED
CANCELLED
```

## Zero results

Solo se declara `ZERO_RESULTS_CONFIRMED` cuando:

- el health check relevante fue satisfactorio;
- la respuesta externa fue válida;
- el parser reconoció el contrato;
- la búsqueda completó al menos la primera página;
- la lista válida resultó vacía;
- no existen señales de challenge o rate limit.

## Anomalía histórica

Si una búsqueda que normalmente devuelve resultados cae a cero, el reporte debe destacarlo aunque la fuente parezca sana. Es diagnóstico, no prueba automática de fallo.

## Logging

Formato estructurado previsto:

```json
{
  "timestamp": "2026-08-30T22:00:00Z",
  "level": "info",
  "event": "source.search.completed",
  "runId": "...",
  "sourceRunId": "...",
  "sourceId": "facebook-marketplace",
  "durationMs": 3400,
  "itemsReceived": 24,
  "itemsParsed": 22,
  "itemsRejectedAtBoundary": 2
}
```

No registrar:

- cookies;
- tokens;
- passwords;
- cuerpos crudos completos;
- headers de autenticación;
- datos personales innecesarios.

## Métricas por run

- inicio y fin;
- duración;
- fuentes solicitadas;
- health status;
- páginas;
- items crudos;
- items normalizados;
- duplicados;
- observaciones nuevas;
- `MATCH`, `REVIEW`, `REJECT`;
- errores por código;
- artifacts creados;
- exports generados;
- IA solicitada, ejecutada y omitida.

## Diagnósticos de parser

Cuando cambie un contrato:

- código `CONTRACT_CHANGED` o `PARSER_FAILED`;
- path/campo esperado sin incluir secretos;
- muestra mínima sanitizada;
- fingerprint del payload;
- artifact opcional con vencimiento;
- versión del adapter y fixture más cercano.

## Timeouts y cancelación

Cada operación externa usa:

- timeout individual;
- deadline total del source run;
- `AbortSignal`;
- retry limitado solo para errores retryable;
- backoff con jitter;
- razón final visible.

No existen retries infinitos ni recursivos sin límite.

## Reporte de errores

El HTML incluye una sección por fuente con:

- estado;
- mensaje humano;
- código estable;
- acción sugerida;
- collector utilizado;
- cantidad parcial si existe;
- enlace local a artifact sanitizado cuando corresponda.

## Salida del proceso

La CLI devuelve códigos diferenciables, a definir en implementación, al menos para:

- éxito;
- éxito parcial;
- configuración inválida;
- fallo total de fuentes;
- intervención manual requerida;
- error interno.

## Depuración

La opción de diagnóstico debe ser explícita. Activarla nunca deshabilita redacción de secretos.
