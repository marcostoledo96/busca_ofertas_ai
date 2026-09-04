# @busca-ofertas-ai/rules-engine

Motor de evaluación determinista, explicable y puro para Busca Ofertas AI.

## Responsabilidad

Evalúa publicaciones (`Listing`) y sus observaciones (`Observation`) contra una búsqueda guardada (`SavedSearch`) aplicando reglas deterministas antes de cualquier interacción con inteligencia artificial.

## Invariantes y Garantías Contractuales

1. **Pureza absoluta**: El motor no realiza operaciones de entrada/salida (I/O), acceso a filesystem, llamadas de red, consultas a base de datos ni ejecución de código arbitrario. No accede a `Date.now()`, `Math.random()` ni `crypto.randomUUID()` de forma no inyectada.
2. **Rechazo duro (`HARD`) incondicional**: Si al menos una regla emite una razón con severidad `HARD`, la decisión final es estrictamente `REJECT`. Este resultado no puede ser compensado por puntaje (incluso con score 100), reglas positivas, perfiles de precisión ni evaluaciones posteriores de IA.
3. **Álgebra de Score acotada y determinista**:
   - `0 <= score <= 100` (entero redondeado y acotado).
   - Sin `NaN`, `Infinity` ni `-Infinity`.
   - Conmutatividad: El orden de evaluación de reglas independientes no altera el score, la decisión ni los motivos emitidos.
4. **Explicabilidad total**: Toda decisión contiene al menos una razón (`EvaluationReason`). Si ninguna regla se activa, se emite una razón neutral documentada (`RULES_DEFAULT_BASELINE`).
5. **Orden canónico de razones**: Las razones se ordenan determinísticamente por severidad (`HARD` > `SOFT` > `INFO`), seguido lexicográficamente por código de razón, mensaje y evidencia.
6. **Umbrales**:
   - `score >= effectiveMatchThreshold` $\rightarrow$ `MATCH`
   - `score >= effectiveReviewThreshold` $\rightarrow$ `REVIEW`
   - `score < effectiveReviewThreshold` $\rightarrow$ `REJECT`

## Contratos Públicos

### Rule & RuleResult

```typescript
export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  evaluate(context: RuleEvaluationContext): RuleResult;
}

export interface RuleResult {
  readonly ruleId: string;
  readonly triggered: boolean;
  readonly impact: number;
  readonly severity: EvaluationSeverity; // 'INFO' | 'SOFT' | 'HARD'
  readonly reasons: readonly EvaluationReason[];
}
```

### Contexto de Evaluación

```typescript
export interface RuleEvaluationContext {
  readonly listing: Listing;
  readonly observation: Observation;
  readonly savedSearch: SavedSearch;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

## Expresiones Booleanas Compuestas (AND / OR / NOT)

El motor soporta un AST validado y seguro para combinar reglas mediante operadores lógicos:

- **`RULE`**: Evalúa una regla registrada por su identificador.
- **`AND`**: Requiere al menos 2 expresiones hijas. Satisfecha si todas las hijas se activan. Su impacto es la suma de los impactos de las hijas.
- **`OR`**: Requiere al menos 2 expresiones hijas. Satisfecha si al menos una hija se activa. Su impacto es el máximo impacto entre las hijas satisfechas.
- **`NOT`**: Requiere exactamente 1 expresión hija. Satisfecha si la hija no se activa.
- **Preservación de `HARD`**: Un operador compuesto (`AND`, `OR`, `NOT`) **nunca** puede ocultar o descartar una razón de severidad `HARD`. Si una rama evaluada produce un rechazo duro, se propaga incondicionalmente a las razones finales.

### Validación Defensiva del AST

- Prohíbe operadores desconocidos o aridades inválidas.
- Rechaza identificadores de reglas no registrados.
- Detecta referencias circulares en tiempo de ejecución.
- Límite de profundidad máxima (default: 5) y recuento total de nodos (default: 50).

## Perfiles de Precisión

El motor soporta cuatro perfiles genéricos inmutables en runtime (`STANDARD_PROFILES`):

| Perfil       | Modificador Umbrales | Severidad Moneda Ambigua | Descripción                                                               |
| ------------ | -------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `STRICT`     | Match +5 / Review +5 | `HARD`                   | Prioriza precisión. Rechaza ambigüedades de precio y exige mayor puntaje. |
| `BALANCED`   | 0 / 0                | `SOFT`                   | Balance estándar entre precisión y recall.                                |
| `PERMISSIVE` | Match -5 / Review -5 | `INFO`                   | Alta tolerancia para maximizar recall hacia revisión.                     |
| `MIXED`      | 0 / 0                | `SOFT`                   | Perfil híbrido por defecto que combina señales suaves.                    |

La resolución estándar de perfiles es completamente pura y sin estado (`resolveStandardPrecisionProfile`).

### Extensibilidad sin Modificar el Evaluador Genérico

Nuevas issues o dominios de producto pueden registrar perfiles adicionales mediante `PrecisionProfileRegistry` de forma aislada y explícita. Para prevenir contaminación o desvíos semánticos ocultos bajo la versión por defecto (`1.0.0`), toda evaluación con perfiles personalizados requiere declarar un `policyVersion` explícito:

```typescript
const registry = new PrecisionProfileRegistry();
registry.register({
  name: 'MI_PERFIL_DOMINIO',
  matchThresholdModifier: 0,
  reviewThresholdModifier: -5,
  ambiguousPriceSeverity: 'HARD',
  missingPriceSeverity: 'HARD',
  defaultBaseScore: 10,
});

// La evaluación con custom registry requiere policyVersion explícito:
const evalResult = evaluateRules(rules, context, policy, {
  precisionProfileRegistry: registry,
  policyVersion: '2.0.0-custom-dominio',
});
```

## Pipeline Pre-IA y Seam Post-IA

Conforme a **ADR-004**, las reglas deterministas operan como la primera línea de defensa:

```typescript
// Pre-IA: Evaluación determinista pura
const evaluation = evaluatePreAi(rules, context, policy);
// evaluatedBy: ['RULES']

// Post-IA: Reconciliación con IA (principalmente sobre casos en REVIEW)
const reconciled = reconcilePostAiEvaluation(evaluation, aiResultParams);
// Si la evaluación previa contenía HARD, cualquier intento de promoción a MATCH o REVIEW
// lanza InvariantViolationError de forma terminal (fail-closed).
```

## Catálogo de Códigos de Razón (`EvaluationReasonCodes`)

Identificadores estables y desacoplados del copy humano:

- `RULES_DEFAULT_BASELINE`: Razón base cuando ninguna regla específica se activa.
- `RULES_REQUIRED_TERM_MATCH`: Coincidencia positiva de términos requeridos.
- `RULES_REQUIRED_TERM_MISSING`: Falta de término requerido.
- `RULES_EXCLUDED_TERM_MATCH`: Detección de término excluido.
- `RULES_PRICE_WITHIN_LIMIT`: Precio verificado dentro del rango aceptable.
- `RULES_PRICE_EXCEEDS_MAXIMUM`: Precio excede el presupuesto máximo.
- `RULES_PRICE_BELOW_MINIMUM_PLAUSIBLE`: Precio sospechosamente bajo (posible señuelo o accesorio).
- `RULES_PRICE_AMBIGUOUS_CURRENCY`: Moneda o importe no resuelto con certeza.
- `RULES_PRICE_MISSING`: Importe numérico ausente.
- `RULES_CONDITION_ACCEPTED`: Condición observada coincide con las aceptadas.
- `RULES_CONDITION_REJECTED`: Condición observada rechazada por la política.
- `RULES_CONDITION_UNKNOWN`: Condición no declarada.
- `RULES_BOOLEAN_AND_SATISFIED` / `RULES_BOOLEAN_AND_UNSATISFIED`: Resultado de operador AND.
- `RULES_BOOLEAN_OR_SATISFIED` / `RULES_BOOLEAN_OR_UNSATISFIED`: Resultado de operador OR.
- `RULES_BOOLEAN_NOT_SATISFIED` / `RULES_BOOLEAN_NOT_UNSATISFIED`: Resultado de operador NOT.
- `RULES_HARD_EXCLUSION`: Rechazo duro genérico.
