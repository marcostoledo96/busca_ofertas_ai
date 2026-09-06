# 04 — Precios y monedas

## Objetivo

Resolver importes sin confundir símbolos ambiguos, separadores regionales, señas, cuotas ni monedas extranjeras.

## Regla central

> Un símbolo `$` aislado no constituye evidencia suficiente de ARS.

El sistema conserva siempre el texto original y separa extracción numérica de resolución de moneda.

## Modelo

```typescript
interface ResolvedPrice {
  rawText: string;
  amount: number | null;
  currency: "ARS" | "USD" | "UNKNOWN";
  resolution: "EXPLICIT" | "SOURCE_METADATA" | "TEXT_INFERENCE" | "AMBIGUOUS";
  confidence: number;
  evidence: string[];
  kind: "TOTAL" | "DEPOSIT" | "INSTALLMENT" | "FROM_PRICE" | "UNKNOWN";
  converted?: {
    amount: number;
    currency: "ARS";
    exchangeRate: number;
    exchangeRateOrigin: "MANUAL";
    convertedAt: string;
  };
}

interface ParsedAmountCandidate {
  readonly rawText: string;
  readonly amount: number | null;
  readonly confidence: number;
  readonly status: "EXTRACTED" | "NO_NUMERIC_AMOUNT" | "AMBIGUOUS" | "INVALID_NUMERIC";
  readonly evidence: readonly string[];
  readonly currencySignals: readonly string[];
  readonly candidates: readonly ParsedAmountCandidateToken[];
}
```

### Separación entre extracción y resolución monetaria

El pipeline separa estrictamente dos fases:
1. **Parser de importes (`parseAmountCandidate`)** (BOAI-018): función pura, determinista y sin I/O que extrae candidatos numéricos enteros, preserva `rawText` de forma idéntica bit a bit, emite evidencia estructurada y detecta señales sintácticas de moneda sin decidir la moneda final (`currency`).
2. **Resolvedor monetario (`CurrencyResolver`)** (BOAI-019) y **Clasificador de tipos de precio** (BOAI-020): consumen los candidatos y su evidencia para construir el `ResolvedPrice` definitivo asignando `currency`, `resolution` y `kind`.

```
Texto crudo ──> parseAmountCandidate() ──> ParsedAmountCandidate ──> Resolver/BOAI-019 ──> ResolvedPrice
```

## Jerarquía de evidencia

De mayor a menor confianza:

1. código de moneda estructurado de la fuente;
2. texto explícito `ARS`, `pesos`, `USD`, `US$`, `U$S`, `dólares`;
3. metadatos de país y contrato conocido de la fuente;
4. contexto textual y rangos plausibles;
5. símbolo `$` sin contexto.

Una inferencia de bajo nivel nunca sobrescribe evidencia explícita.

## Formatos ARS soportados

```text
ARS 250000
ARS 250.000
$ 250.000 pesos
250 mil pesos
250000 pesos argentinos
```

El separador se interpreta según evidencia y magnitud; el parser conserva el valor crudo para auditoría.

## Formatos USD soportados

```text
USD 300
US$ 300
U$S 300
300 dólares
300 dolares
```

Una publicación explícita en USD sigue la política de la búsqueda.

## Política del MVP para USD

La política es configurable. La búsqueda inicial permite convertir con una cotización ingresada manualmente una vez por ejecución.

```text
Se detectaron 3 importes explícitos en USD.
Ingresá USD → ARS para esta ejecución o dejá vacío para enviarlos a REVIEW.
```

El tipo de cambio se registra con el run. No se consulta una cotización online en el MVP.

## Moneda ambigua

Ejemplo:

```text
Nintendo Switch Lite — $300
```

Sin evidencia adicional:

```text
currency = UNKNOWN
resolution = AMBIGUOUS
decision mínima = REVIEW
```

Incluso una IA posterior no puede marcar la moneda como confirmada sin citar evidencia disponible.

## Precio mínimo plausible

Cada búsqueda puede definirlo, pero inicialmente puede ser `null` para aprender del mercado.

Cuando existe:

- por debajo del mínimo y con `seña`, `anticipo` o `reserva` → `REJECT` duro;
- por debajo del mínimo y con moneda explícita USD → aplicar política USD;
- por debajo del mínimo sin evidencia → `REVIEW`;
- un valor absurdo nunca recibe bonus por ser barato.

## Señas, cuotas y precios parciales

Patrones iniciales:

```text
seña
anticipo
reserva con
entrega inicial
cuota
12 cuotas de
por mes
desde
precio por unidad
```

El sistema distingue:

- precio total;
- seña/anticipo;
- cuota individual;
- precio desde;
- importe desconocido.

Una cuota no se multiplica automáticamente sin conocer cantidad y condiciones completas.

## Descuento

Se modelan por separado:

- precio actual;
- precio anterior declarado;
- descuento declarado por la fuente;
- descuento calculado a partir del historial propio.

Nunca se confía en un porcentaje anunciado si los importes no son consistentes.

## Comparación

Solo se compara contra el máximo cuando:

- moneda objetivo confirmada, o
- conversión manual registrada.

Los importes `UNKNOWN` permanecen en `REVIEW`.

## Contrato del parser de importes (`parseAmountCandidate`)

### Gramática y formatos soportados

1. **Enteros continuos**: `ARS 250000`, `250000 ARS`, `250000 pesos`, `250000 pesos argentinos`.
2. **Separador de miles con punto (`.`)**: `ARS 250.000`, `250.000 ARS`, `$ 250.000 pesos`, `$250.000 pesos`, `250.000 pesos`. Cada punto debe separar bloques de exactamente 3 dígitos (`\d{1,3}(?:\.\d{3})+`).
3. **Separador de miles con espacio/NBSP**: `250 000 pesos`, `250 000 pesos argentinos`, `ARS 250 000`. Admite espacio común, NBSP (`\u00A0`) y thin space (`\u202F`).
4. **Multiplicador `mil`**: `250 mil pesos`, `250 mil`. Usa límites de palabra Unicode (`(?<![\p{L}\p{N}])mil(?![\p{L}\p{N}])`) para evitar colisiones con palabras como `militares`, `milímetros` o `millas`. El cálculo se realiza mediante aritmética entera exacta (`base * 1000n`).

### Separadores ambiguos y fail-closed

- **Coma (`250,000` / `1,234`)**: en Argentina la coma es separador decimal mientras que en el estándar anglosajón es separador de miles. Sin evidencia explícita contextual que desambigüe, el parser falla cerrado: devuelve `amount: null`, `status: 'AMBIGUOUS'` y evidencia `AMBIGUOUS_SEPARATOR_COMMA`.
- **Fracciones decimales (`12.34` / `12,34`)**: el MVP es estrictamente entero (`integer-only`). Todo importe con 1 o 2 decimales se marca como `status: 'AMBIGUOUS'`, `amount: null` y evidencia `DECIMAL_FRACTION_UNSUPPORTED`.
- **Número con punto aislado (`1.234`)**: sin prefijo monetario (`$`, `ARS`) ni sufijo (`pesos`), un número con punto es ambiguo entre miles o decimal en notación anglosajona. Se marca como `status: 'AMBIGUOUS'` y `amount: null`.

### Entradas sin importe

Cadenas vacías, espacios en blanco o frases típicas de publicación sin precio (`Gratis`, `Consultar`, `Precio a consultar`, `Sin precio`, `Consultar por privado`, `Oferta disponible`, `Nintendo Switch Lite`) devuelven deterministamente `status: 'NO_NUMERIC_AMOUNT'`, `amount: null`, `confidence: 0` y la evidencia correspondiente. No lanzan excepciones.

### Falsos positivos y números fuera de precio

El parser identifica y excluye automáticamente números asociados a especificaciones de producto, modelos, años o cantidades de artículos antes de extraer el importe:
- Años: `año 2024`, `modelo 2024`.
- Modelos y versiones: `modelo 300`, `versión 2`.
- Especificaciones técnicas: `32GB`, `128 GB`, `60 fps`.
- Unidades y accesorios: `2 controles`, `3 juegos`.

Cuando un texto contiene un número no monetario junto con un precio real (ej. `Modelo 2024 — 250.000 pesos`), el número no monetario se ignora y el precio real se extrae correctamente.

### Múltiples importes en el mismo texto

Si un texto contiene múltiples cantidades monetarias conflictivas (ej. `ARS 250.000 antes 300.000`, `12 cuotas de 30000`, `seña 20000 precio final 250000`), el parser no elige arbitrariamente el primer número ni el más grande. Falla cerrado con `status: 'AMBIGUOUS'`, `amount: null` y expone los candidatos individuales en el array `candidates` para que las issues posteriores (BOAI-019/BOAI-020) apliquen las reglas de negocio adecuadas.

### Escala determinista de confianza (`confidence`)

- `1.0`: Presencia de código explícito `ARS` o frase `pesos argentinos`.
- `0.9`: Presencia de palabra `pesos` o `mil pesos`.
- `0.6`: Símbolo aislado `$` o número numérico sin moneda explícita.
- `0.5`: Señal de moneda extranjera (ej. `USD`, `dólares`).
- `0.0`: Sin importe numérico, formato ambiguo, overflow o error.

### Límites de magnitud y defensas contra DoS

- Rango válido: `0 <= amount <= Number.MAX_SAFE_INTEGER` (9.007.199.254.740.991).
- Toda evaluación numérica se valida mediante `BigInt` antes de convertir a `Number`. Si excede `Number.MAX_SAFE_INTEGER`, emite `status: 'INVALID_NUMERIC'`, `amount: null` y evidencia `NUMERIC_OVERFLOW`.
- Números negativos (`ARS -250.000`) emiten `status: 'INVALID_NUMERIC'`, `amount: null` y evidencia `NEGATIVE_AMOUNT_UNSUPPORTED`.
- Límite de longitud de entrada: entradas de más de 10.000 caracteres fallan cerrado inmediatamente con `INPUT_EXCEEDS_MAX_LENGTH` sin evaluar expresiones regulares potencialmente lentas.

## Matriz mínima de tests

| Entrada | Resultado esperado |
|---|---|
| `$250.000` sin metadatos | moneda contextual o ambigua, nunca ciega |
| `ARS 250.000` | ARS 250000 explícito |
| `250 mil pesos` | ARS 250000 explícito |
| `USD 300` | USD 300 explícito |
| `$300` | `UNKNOWN`, `REVIEW` |
| `Seña $20.000` | kind `DEPOSIT` |
| `12 cuotas de $30.000` | kind `INSTALLMENT` |
| `Gratis` | amount null, regla específica |
| `Consultar` | amount null, `REVIEW` o rechazo configurable |
| `$1` | precio sospechoso |
| `$ 250,000` | resolver con evidencia regional, no solo puntuación |

## Invariantes

1. Nunca se pierde `rawText`.
2. `confidence` está entre 0 y 1.
3. No existe conversión de `UNKNOWN`.
4. Toda conversión registra tasa, origen y run.
5. La IA no reemplaza la evidencia monetaria.
6. Los cálculos usan enteros de la unidad monetaria para el MVP; no `float`.
