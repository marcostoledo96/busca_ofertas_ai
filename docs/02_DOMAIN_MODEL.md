# 02 — Modelo de dominio

## Lenguaje ubicuo

- **Source**: sitio o sistema del que se obtienen datos.
- **Adapter**: implementación técnica que habla con una Source.
- **SavedSearch**: intención persistida del usuario.
- **Run**: ejecución completa de una o varias fuentes.
- **SourceRun**: resultado de una fuente dentro de un Run.
- **Listing**: publicación canónica identificable en una fuente.
- **Observation**: estado observado de una Listing en un momento.
- **Opportunity**: Listing evaluada dentro del contexto de una SavedSearch.
- **Evaluation**: decisión explicable sobre una oportunidad.
- **Feedback**: corrección o preferencia expresada por el usuario.
- **RawArtifact**: evidencia temporal usada para depuración o fixtures.

## Agregados principales

### SavedSearch

```typescript
interface SavedSearch {
  id: string;
  schemaVersion: number;
  name: string;
  enabled: boolean;
  category: "PRODUCT" | "REAL_ESTATE" | "VEHICLE";
  sourceConfigs: SourceSearchConfig[];
  query: QueryPolicy;
  price: PricePolicy | null;
  location: LocationPolicy | null;
  condition: ConditionPolicy | null;
  rules: RuleExpression[];
  evaluation: EvaluationPolicy;
  ai: AiPolicy;
  retention: RetentionPolicy;
  createdAt: Date;
  updatedAt: Date;
}
```

### Listing

```typescript
interface Listing {
  id: string;
  sourceId: string;
  externalId: string;
  canonicalUrl: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
```

La identidad estable es `(sourceId, externalId)`. La URL canónica actúa como respaldo y diagnóstico, no como única identidad cuando existe un ID externo confiable.

### Observation

```typescript
interface Observation {
  id: string;
  listingId: string;
  sourceRunId: string;
  observedAt: Date;
  title: string;
  description: string | null;
  price: ResolvedPrice | null;
  location: ResolvedLocation | null;
  condition: ListingCondition | null;
  availability: Availability;
  imageUrls: string[];
  publishedAt: Date | null;
  rawFingerprint: string;
}
```

No se sobrescribe el historial: cada cambio relevante produce una nueva Observation. Se puede deduplicar una observación idéntica dentro del mismo run.

### Opportunity

```typescript
interface Opportunity {
  id: string;
  savedSearchId: string;
  observationId: string;
  evaluationId: string;
  novelty: "NEW" | "UNCHANGED" | "PRICE_CHANGED" | "REAPPEARED";
}
```

### Evaluation

```typescript
interface Evaluation {
  id: string;
  decision: "MATCH" | "REVIEW" | "REJECT";
  score: number;
  reasons: EvaluationReason[];
  evaluatedBy: Array<"RULES" | "AI" | "USER">;
  policyVersion: string;
  createdAt: Date;
}
```

```typescript
interface EvaluationReason {
  code: string;
  message: string;
  impact: number;
  severity: "INFO" | "SOFT" | "HARD";
  evidence?: string;
}
```

Un motivo `HARD` rechazado por reglas no puede ser revertido por IA.

## Value objects

### ResolvedPrice

```typescript
interface ResolvedPrice {
  rawText: string;
  amount: number | null;
  currency: "ARS" | "USD" | "UNKNOWN";
  resolution: "EXPLICIT" | "SOURCE_METADATA" | "TEXT_INFERENCE" | "AMBIGUOUS";
  confidence: number;
  evidence: string[];
  converted?: {
    amount: number;
    currency: "ARS";
    exchangeRate: number;
    exchangeRateOrigin: "MANUAL";
  };
}
```

### SourceHealth

```typescript
interface SourceHealth {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "AUTH_REQUIRED";
  checkedAt: Date;
  evidence: string[];
}
```

## Estados de ejecución

### Run

```text
CREATED
RUNNING
SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
```

### SourceRun

```text
PENDING
RUNNING
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
```

## Invariantes

1. Una `Observation` pertenece a exactamente una `Listing` y un `SourceRun`.
2. Un error de fuente no puede representarse mediante una lista vacía exitosa.
3. Todo `MATCH`, `REVIEW` o `REJECT` debe tener al menos una razón.
4. `score` está siempre entre 0 y 100.
5. Una moneda ambigua no se convierte.
6. La IA no puede cambiar un `REJECT` causado por una razón `HARD`.
7. Las búsquedas persistidas tienen versión de esquema.
8. Los datos crudos nunca contienen secretos de sesión.
9. La eliminación por retención no borra el historial normalizado necesario para auditoría.
10. Una fuente puede implementar capacidades parciales y debe declararlas explícitamente.
