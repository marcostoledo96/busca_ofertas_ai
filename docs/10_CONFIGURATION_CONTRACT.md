# 10 — Contrato de configuración

## Objetivo

Permitir crear búsquedas sin modificar código y conservar compatibilidad mediante versionado explícito.

## Formato

YAML será el formato visible inicial. Toda configuración se valida contra un esquema TypeScript en runtime.

## Ejemplo

```yaml
schemaVersion: 1
id: switch-lite-amba
name: Nintendo Switch Lite en AMBA
enabled: true
category: PRODUCT

sources:
  - id: facebook-marketplace
    enabled: true
    queries:
      - Nintendo Switch Lite
      - Switch Lite
      - Nintendo Lite
    options:
      sort: NEWEST
      maxPages: 3
      maxItems: 200

location:
  mode: REGION
  region: AMBA
  radiusKm: 80

price:
  targetCurrency: ARS
  maximum: 250000
  minimumPlausible: null
  foreignCurrency:
    mode: MANUAL_RATE
    onUnknown: REVIEW

condition:
  accepted:
    - NEW
    - LIKE_NEW
    - GOOD

product:
  expectedModels:
    - NINTENDO_SWITCH_LITE
  requireFunctional: true
  chargerRequired: false
  boxRequired: false

rules:
  profile: switch-lite
  include: []
  exclude: []

evaluation:
  matchThreshold: 80
  reviewThreshold: 40
  precisionProfile: MIXED

ai:
  enabled: false
  evaluateOnlyReview: true
  provider: deepseek
  requireConfirmation: true
  maxEvaluationsPerRun: 5

retention:
  rawArtifacts: ERRORS_AND_REVIEW
  rawDataDays: 30

report:
  openAutomatically: true
  includeRejected: COLLAPSED
  exports:
    - HTML
    - JSON
    - CSV
```

## Reglas de validación

- `schemaVersion` obligatorio y soportado;
- `id` estable en kebab-case;
- al menos una fuente habilitada;
- al menos una query para fuentes de búsqueda textual;
- `maximum >= minimumPlausible` cuando ambos existan;
- umbrales entre 0 y 100;
- `matchThreshold > reviewThreshold`;
- moneda objetivo soportada;
- capacidades requeridas compatibles con la fuente;
- límites de paginación positivos y acotados;
- ningún secreto inline.

## Separación fuente / negocio

`source.options` contiene parámetros técnicos propios de la fuente. El resto expresa intención de negocio común.

Ejemplo incorrecto:

```yaml
facebookSelector: "div.x1..."
```

Los selectores pertenecen al adapter o a una configuración técnica versionada, no a la búsqueda de usuario.

## Secretos

La configuración puede referenciar un alias:

```yaml
sources:
  - id: facebook-marketplace
    sessionRef: facebook-personal
```

`sessionRef` se resuelve localmente; nunca contiene cookies o contraseñas.

## Wizard

El wizard debe:

- generar configuración válida;
- ocultar opciones avanzadas por defecto;
- explicar moneda y ambigüedad;
- advertir sobre fuentes que requieren sesión;
- permitir editar sin perder campos desconocidos compatibles;
- mostrar diff antes de guardar cambios destructivos.

## Versionado

Cambios incompatibles requieren incrementar `schemaVersion` y proveer migración o mensaje accionable.

No se modifica silenciosamente la semántica de una búsqueda antigua.

## Almacenamiento

La fuente de verdad puede ser YAML importado a SQLite o configuración persistida directamente mediante repositorios. El MVP debe permitir exportar nuevamente una búsqueda a YAML sin pérdida semántica.

## Extensiones futuras

Campos futuros deben vivir bajo namespaces claros y ser rechazados o preservados según la política de compatibilidad. No usar un objeto global `options` para toda la aplicación.
