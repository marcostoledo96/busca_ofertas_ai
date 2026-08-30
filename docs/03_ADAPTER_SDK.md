# 03 — Adapter SDK

## Objetivo

Aislar cada fuente detrás de un contrato estable para que el núcleo pueda ejecutar Facebook Marketplace, Mercado Libre, una tienda o un watcher de URL sin conocer sus detalles técnicos.

## Principios

- capacidades explícitas;
- errores tipados;
- lifecycle controlado;
- paginación observable;
- health check real;
- resultados crudos separados de normalización;
- sin dependencia de CLI, SQLite o reportes;
- ningún adapter puede convertir un fallo en una búsqueda exitosa vacía.

## Contrato mínimo

```typescript
export interface SourceAdapter {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SourceCapabilities;

  initialize(context: AdapterContext): Promise<void>;
  healthCheck(request: HealthCheckRequest): Promise<SourceHealth>;
  search(request: SourceSearchRequest): Promise<SourceSearchResult>;
  getDetails?(reference: ListingReference): Promise<RawListingDetails>;
  authenticate?(request: AuthenticationRequest): Promise<AuthenticationResult>;
  dispose(): Promise<void>;
}
```

## Capabilities

```typescript
export interface SourceCapabilities {
  textSearch: boolean;
  exactUrlWatch: boolean;
  listingDetails: boolean;
  authentication: boolean;
  pagination: boolean;
  geographicSearch: boolean;
  priceAndCurrency: boolean;
  stock: boolean;
  advertisedDiscount: boolean;
}
```

El orquestador valida las capacidades antes de ejecutar. Una búsqueda que exija radio geográfico no puede utilizar silenciosamente una fuente que no lo soporte.

## Contexto

```typescript
export interface AdapterContext {
  runId: string;
  logger: StructuredLogger;
  clock: Clock;
  abortSignal: AbortSignal;
  artifactWriter: RawArtifactWriter;
  secretProvider: SecretProvider;
  sessionDirectory: string;
}
```

No se entregan repositorios SQLite al adapter. El núcleo recibe resultados y decide qué persistir.

## Request de búsqueda

```typescript
export interface SourceSearchRequest {
  savedSearchId: string;
  queries: string[];
  pagination: {
    maxPages: number;
    maxItems: number;
  };
  location?: {
    mode: "POINT_RADIUS" | "MULTI_POINT" | "REGION" | "COUNTRY";
    radiusKm?: number;
    sourceLocationIds?: string[];
    latitude?: number;
    longitude?: number;
  };
  priceHint?: {
    minimum?: number;
    maximum?: number;
    currency?: string;
  };
  sort?: "RELEVANCE" | "NEWEST" | "PRICE_ASC" | "PRICE_DESC";
  sourceOptions: Record<string, unknown>;
}
```

`priceHint` es una optimización para la fuente. La aceptación final siempre se realiza en el núcleo.

## Resultado

```typescript
export interface SourceSearchResult {
  sourceId: string;
  status: "SUCCESS" | "ZERO_RESULTS_CONFIRMED";
  items: RawListingCandidate[];
  pagesRead: number;
  hasMore: boolean;
  diagnostics: SourceDiagnostics;
}
```

Una fuente que falla debe lanzar `SourceAdapterError`; no devuelve `items: []` con `SUCCESS`.

## Errores

```typescript
export type SourceErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "MANUAL_INTERVENTION_REQUIRED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "SOURCE_UNAVAILABLE"
  | "CONTRACT_CHANGED"
  | "PARSER_FAILED"
  | "TIMEOUT"
  | "CONFIGURATION_UNSUPPORTED";

export class SourceAdapterError extends Error {
  readonly code: SourceErrorCode;
  readonly retryable: boolean;
  readonly evidence: string[];
  readonly artifactIds: string[];
}
```

Los mensajes visibles no reemplazan los códigos estables.

## Health check

Un health check debe probar el camino externo que puede fallar. No es válido declarar salud porque una tabla local de ciudades respondió.

Debe distinguir:

- conectividad;
- autenticación;
- disponibilidad de endpoint;
- contrato esperado;
- capacidad de obtener una respuesta mínima válida.

No debe generar carga equivalente a una búsqueda completa.

## Autenticación

- las credenciales y sesiones se obtienen mediante `SecretProvider` o archivos locales fuera del repositorio;
- el adapter devuelve `AUTHENTICATION_REQUIRED` o `MANUAL_INTERVENTION_REQUIRED` ante login/checkpoint;
- no resuelve CAPTCHA automáticamente;
- no registra cookies, tokens ni contenido sensible en logs.

## Paginación

Los adapters paginables deben exponer diagnósticos:

- páginas solicitadas;
- páginas completadas;
- cantidad cruda;
- cursores utilizados en forma sanitizada;
- razón de detención;
- `hasMore`.

Alcanzar `maxPages` o `maxItems` no es error, pero debe quedar visible.

## Normalización

Cada adapter contiene su traductor de `RawListingCandidate` a un DTO normalizado de frontera. La resolución de moneda, reglas de negocio y scoring permanecen en el núcleo.

El adapter puede aportar evidencia:

```typescript
{
  rawPriceText: "$300",
  sourceCurrencyCode: null,
  title: "Nintendo Switch Lite",
  description: "300 dólares",
  sourceMetadata: { ... }
}
```

No debe decidir por sí solo que la publicación es `MATCH`.

## Contract tests obligatorios

Todo adapter productivo debe pasar la suite compartida exportada por `@busca-ofertas-ai/adapter-sdk/testing` (`runSourceAdapterContract`), que comprueba:

1. ID y versión no vacíos.
2. capabilities coherentes con los métodos.
3. inicialización y `dispose()` idempotentes.
4. cancelación mediante `AbortSignal`.
5. timeout tipado.
6. error externo distinto de cero resultados.
7. no inclusión de secretos en errores o diagnósticos.
8. IDs y URLs canónicas estables.
9. resultados deterministas sobre fixtures.
10. paginación respetando límites.

Los tests unitarios y de contrato no utilizan red en vivo.
