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
