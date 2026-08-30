# Índice de documentación

Los documentos de esta carpeta son contractuales. No describen una implementación ya existente: definen el producto y el proceso que deben construirse y seguirse.

| Documento | Alcance |
|---|---|
| [`00_PRODUCT_BRIEF.md`](00_PRODUCT_BRIEF.md) | Objetivo, usuarios, alcance y decisiones de producto |
| [`01_ARCHITECTURE.md`](01_ARCHITECTURE.md) | Arquitectura modular, dependencias y flujos |
| [`02_DOMAIN_MODEL.md`](02_DOMAIN_MODEL.md) | Entidades, value objects y estados |
| [`03_ADAPTER_SDK.md`](03_ADAPTER_SDK.md) | Contrato que debe cumplir cada fuente |
| [`04_PRICE_AND_CURRENCY.md`](04_PRICE_AND_CURRENCY.md) | Política ARS, USD, ambigüedad y conversión |
| [`05_REUSE_STRATEGY.md`](05_REUSE_STRATEGY.md) | Reutilización, licencias y upstreams |
| [`06_MVP_ROADMAP.md`](06_MVP_ROADMAP.md) | Etapas y gates del MVP |
| [`07_BACKLOG.md`](07_BACKLOG.md) | Backlog completo, dependencias y orientación de routing |
| [`08_TESTING_STRATEGY.md`](08_TESTING_STRATEGY.md) | Pirámide de tests, fixtures y gates |
| [`09_SECURITY_AND_PRIVACY.md`](09_SECURITY_AND_PRIVACY.md) | Sesiones, secretos, datos y automatización responsable |
| [`10_CONFIGURATION_CONTRACT.md`](10_CONFIGURATION_CONTRACT.md) | Esquema de búsquedas y versionado |
| [`11_ERROR_MODEL_AND_OBSERVABILITY.md`](11_ERROR_MODEL_AND_OBSERVABILITY.md) | Errores tipados, runs, health y diagnósticos |
| [`12_CLI_AND_REPORT_UX.md`](12_CLI_AND_REPORT_UX.md) | Menús, reporte HTML y revisión manual |
| [`13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`](13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md) | Routing, SDD/RDD, artifacts y delivery con Antigravity |
| [`14_PROJECT_SKILLS.md`](14_PROJECT_SKILLS.md) | Auditoría, instalación y mantenimiento de skills locales |

El vocabulario canónico vive en [`../CONTEXT.md`](../CONTEXT.md).

## Decisiones arquitectónicas

Las ADR se encuentran en [`decisions/`](decisions/README.md). Una ADR aceptada no debe alterarse de forma silenciosa: debe reemplazarse mediante una nueva ADR que indique qué decisión queda superseded.

## Autoridad

Cuando una issue implementa o cambia comportamiento, debe citar los documentos relevantes y declarar cualquier desviación. Si la desviación es permanente, requiere ADR. Gentle AI administra el routing y lifecycle; no modifica el alcance contractual.
