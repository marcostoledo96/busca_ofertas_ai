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

#### Identidad canónica y fallback seguro

1. **Identidad primaria**: el par natural `(sourceId, externalId)` es la clave única y estable de una `Listing`.
2. **Identidad de fallback**: cuando una fuente externa no expone un identificador nativo estable, se deriva un `externalId` sintético con el namespace reservado `urn:boai:fallback:url:<sha256(canonicalUrl)>`.
3. **Precondición de hash**: el hash SHA-256 se calcula estrictamente sobre la `canonicalUrl` normalizada (sin parámetros de tracking ni fragmentos y con query params ordenados), nunca sobre la URL cruda.
4. **Aislamiento por fuente**: la identidad compuesta `(sourceId, externalId)` garantiza que el mismo fallback hash en fuentes distintas no se mezcle.
5. **Detección de colisiones (fail-closed)**: si una publicación entrante con fallback externalId colisiona con una `Listing` existente que posee una `canonicalUrl` distinta, el sistema rechaza la mutación emitiendo `ListingIdentityCollisionError` y preservando el registro original.

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

#### Fingerprint determinístico de Observation

- **Representación**: hash SHA-256 sobre la serialización canónica JSON de los datos semánticos observables.
- **Campos incluidos**: `title` (normalizado en espacios), `description`, `price` (`amount`, `currency`, `kind`), `location` (`rawText`, `region`, `city`, `neighborhood`, `coordinates` redondeadas a 5 decimales), `condition`, `availability`, `imageUrls` (deduplicadas y ordenadas lexicográficamente) y `publishedAt`.
- **Campos excluidos**: metadatos de infraestructura y variables por ejecución (`id`, `listingId`, `sourceRunId`, `observedAt`).
- **Invariante de contenido**: un fingerprint idéntico actúa como acelerador de equivalencia pero **no autoriza** a descartar contenido contradictorio. Si dos observaciones bajo la misma `(listingId, sourceRunId, rawFingerprint)` poseen payloads semánticos dispares, se emite un error tipado de colisión (`ObservationFingerprintCollisionError`) con mutación cero.

#### Inmutabilidad e historial de observaciones

- Toda `Observation` persistida es estrictamente **inmutable**. Guardar un `Observation.id` existente solo es una operación idempotente si el contenido completo persistido es idéntico. Cualquier divergencia emite `ObservationIdentityCollisionError`.
- **Deduplicación intra-run**: si en el mismo `sourceRunId` se observa la misma `Listing` con idéntico payload y fingerprint, se actualiza `lastSeenAt` de la `Listing` y no se inserta una fila redundante (`isNewObservation = false`).
- **Monotonicidad temporal de Listing**:
  - `Listing.lastSeenAt = max(persisted.lastSeenAt, incoming.lastSeenAt, incomingObservation.observedAt)`: el avistamiento de una publicación siempre actualiza su presencia más reciente, incluso cuando la observación es deduplicada.
  - `Listing.firstSeenAt = min(persisted.firstSeenAt, incoming.firstSeenAt, incomingObservation.observedAt)`: la fecha de primer avistamiento jamás puede ser posterior a ninguna observación registrada para esa publicación.
- **Formato canónico de timestamps UTC**: todo timestamp persistido debe ser exactamente el formato producido por `Date.prototype.toISOString()`: `YYYY-MM-DDTHH:mm:ss.sssZ` (longitud fija de 24 caracteres con 3 dígitos de milisegundos y terminación en `Z`), validado contra round-trip exacto (`parsed.toISOString() === value`). Esto garantiza que el ordenamiento textual en SQLite (`ORDER BY observed_at`) equivalga estrictamente al orden cronológico (`lexicographic order == chronological order`). Formas de ancho variable (sin milisegundos `2026-08-30T10:00:00Z`, con 1 o 4 dígitos de milisegundos) o con offsets numéricos se rechazan estrictamente con `StorageCorruptionError` sin reparación silenciosa.
- **Formas JSON persistidas estrictas**: el JSON persistido se trata como `unknown`. Un campo opcional ausente se permite; si la clave está presente, el valor debe pertenecer al tipo exacto del dominio. Si el dominio no admite `null` (por ejemplo `price.converted`, `location.region`, `city`, `neighborhood` o `coordinates`), la presencia de `null` se rechaza con `StorageCorruptionError`.

#### Clasificación de novedad (`changeKind`)

La clasificación de cambios durante `recordObservation` evalúa la transición respecto de la última observación cronológica de la publicación:

1. `NEW`: primera observación registrada para la publicación en el sistema (`isNewObservation = true`).
2. `REAPPEARED`: la publicación estaba previamente en estado `SOLD` o `REMOVED` y ahora vuelve a observarse en estado `AVAILABLE` o `PENDING` (`isNewObservation = true`).
3. `PRICE_CHANGED`: el precio resolvió un importe, moneda o tipo diferente respecto de la última observación (`isNewObservation = true`).
4. `UNCHANGED`: no ocurrió un cambio de precio ni una reaparición ni es un nuevo ítem.
   - **Semántica crítica**: `UNCHANGED != no new Observation`. Si cambian atributos no relacionados al precio (título, descripción, ubicación, condición), se persiste una nueva `Observation` en el historial (`isNewObservation = true`) mientras que `changeKind` permanece `UNCHANGED`. Solo cuando el fingerprint semántico es idéntico dentro del mismo run se concluye `isNewObservation = false`.
5. **Política cronológica y defensiva ante observaciones desordenadas**: para garantizar resultados deterministas e impedir calcular novedades o deduplicar anacrónicamente, el chequeo cronológico (`incoming.observedAt < latestPersisted.observedAt`) precede estrictamente a cualquier retorno por deduplicación o inserción. Si una observación entrante posee un `observedAt` anterior a la última observación ya persistida para la misma publicación, se rechaza la operación fail-closed con `RecordObservationCoherenceError` (`OUT_OF_ORDER_OBSERVED_AT`) con rollback transaccional total y mutación cero (recuento de observaciones y estado de la publicación intactos).
6. **Política de reaparición**: la transición a `REAPPEARED` requiere evidencia positiva de disponibilidad (`AVAILABLE`/`PENDING`) posterior a un estado terminal explícito (`SOLD`/`REMOVED`). La mera ausencia en los resultados de una búsqueda **no** se infiere como eliminación ni autoriza a declarar reaparición.

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

### Feedback

Representa una decisión o corrección humana explícita registrada por el usuario sobre una oportunidad evaluada.

```typescript
type FeedbackActor = 'LOCAL_USER';

type FeedbackDecision =
  | 'CONFIRMED_MATCH'
  | 'FALSE_POSITIVE'
  | 'PRICE_INCORRECT'
  | 'NOT_INTERESTED'
  | 'OTHER';

interface Feedback {
  readonly id: string;
  readonly opportunityId: string;
  readonly previousEvaluationId: string;
  readonly actor: FeedbackActor;
  readonly decision: FeedbackDecision;
  readonly notes?: string;
  readonly createdAt: Date;
}
```

Invariantes de Feedback:
- Inmutable y append-only: nunca se actualiza ni se elimina una fila de feedback previa. Protegido por triggers `BEFORE UPDATE` y `BEFORE DELETE` en base de datos.
- Preservación de decisiones contradictorias: si el usuario cambia de opinión en el tiempo (ej. marca inicialmente `CONFIRMED_MATCH` y más adelante `FALSE_POSITIVE`), todas las decisiones sobreviven en orden cronológico en SQLite.
- Integridad referencial: la clave foránea compuesta `(opportunity_id, previous_evaluation_id)` asegura consistencia con la evaluación evaluada.
- Longitud máxima de `notes`: 2000 caracteres UTF-8.
- Privacidad local-first: el feedback se almacena únicamente en la base de datos local SQLite (`storage-sqlite`) y jamás en memoria de proveedores de IA ni en memorias de agentes (Gentle AI / Engram).

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
11. El feedback humano es estrictamente append-only e inmutable, sin alterar jamás observaciones ni evaluaciones previas.
