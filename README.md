# Busca Ofertas AI

Aplicación **local-first** para buscar, normalizar, evaluar y revisar oportunidades provenientes de múltiples fuentes. El primer caso de uso será encontrar **Nintendo Switch Lite en Facebook Marketplace dentro de AMBA**, pero el núcleo se diseña para admitir otros productos, precios, monedas, sitios, inmuebles y vehículos sin modificar la lógica central.

> Estado actual: **producto, arquitectura y backlog definidos; implementación todavía no iniciada**.

## Objetivo

Reducir la revisión manual de sitios y transformar resultados heterogéneos en oportunidades comparables, explicables y trazables.

```text
Fuentes configurables
        ↓
Adaptadores aislados
        ↓
Publicaciones normalizadas
        ↓
Resolución de precio y moneda
        ↓
Reglas deterministas
        ↓
MATCH / REVIEW / REJECT
        ↓
SQLite + HTML + JSON + CSV
```

## MVP contractual

El MVP será una herramienta local para Ubuntu, ejecutada manualmente y sin servidores pagos. Incluirá:

- núcleo propio en TypeScript;
- CLI interactivo y launcher de Ubuntu;
- búsquedas creadas mediante wizard;
- SQLite con migraciones e historial de observaciones;
- adaptador sintético y adaptador de Facebook Marketplace;
- resolución explícita de ARS, USD y moneda ambigua;
- tipo de cambio manual por ejecución;
- reglas deterministas explicables;
- decisiones `MATCH`, `REVIEW` y `REJECT`;
- reporte HTML local que se abre automáticamente;
- exportaciones JSON y CSV;
- revisión manual y feedback;
- tests, CI, seguridad local y atribución de código reutilizado.

Quedan fuera del MVP: Telegram, cron, backend HTTP, frontend hospedado, PostgreSQL, Mercado Libre, watcher de URLs, análisis de imágenes e IA habilitada por defecto.

## Principios no negociables

1. **Configuración antes que código.** Producto, fuente, precio, moneda, ubicación, reglas y umbrales no pueden quedar hardcodeados.
2. **Una fuente rota no equivale a cero resultados.** Todos los adaptadores deben reportar errores tipados y health checks reales.
3. **Reglas antes que IA.** La IA es opcional, complementaria y nunca puede anular un rechazo determinista duro.
4. **Evidencia monetaria.** Un valor como `$300` no se interpreta automáticamente como ARS 300.
5. **Local-first.** Sesiones, base de datos, reportes y datos crudos permanecen en la computadora del usuario.
6. **Adaptadores reemplazables.** El núcleo no conoce detalles internos de Facebook ni de ninguna otra fuente.
7. **Reutilización trazable.** Todo código externo debe registrar origen, SHA, licencia y cambios.
8. **Sin evasión.** No se resuelven CAPTCHAs automáticamente, no se rotan cuentas y no se incorporan mecanismos destinados a ocultar automatización.

## Arquitectura prevista

```text
apps/cli
packages/core
packages/adapter-sdk
packages/configuration
packages/rules-engine
packages/storage-sqlite
packages/report-html
packages/exports
packages/ai
adapters/synthetic
adapters/facebook-graphql
adapters/facebook-playwright
adapters/mercadolibre          # posterior al MVP
adapters/url-watcher           # posterior al MVP
```

Es un monorepo modular, no un sistema de microservicios.

## Documentación

La documentación normativa se encuentra en [`docs/`](docs/README.md):

- [Brief de producto](docs/00_PRODUCT_BRIEF.md)
- [Arquitectura](docs/01_ARCHITECTURE.md)
- [Modelo de dominio](docs/02_DOMAIN_MODEL.md)
- [SDK de adaptadores](docs/03_ADAPTER_SDK.md)
- [Precios y monedas](docs/04_PRICE_AND_CURRENCY.md)
- [Estrategia de reutilización](docs/05_REUSE_STRATEGY.md)
- [Roadmap del MVP](docs/06_MVP_ROADMAP.md)
- [Backlog completo](docs/07_BACKLOG.md)
- [Testing](docs/08_TESTING_STRATEGY.md)
- [Seguridad y privacidad](docs/09_SECURITY_AND_PRIVACY.md)
- [Contrato de configuración](docs/10_CONFIGURATION_CONTRACT.md)
- [Errores y observabilidad](docs/11_ERROR_MODEL_AND_OBSERVABILITY.md)
- [UX del CLI y reportes](docs/12_CLI_AND_REPORT_UX.md)

Las decisiones arquitectónicas permanentes viven en [`docs/decisions/`](docs/decisions/).

## Fuentes de autoridad

Ante contradicciones, se aplica este orden:

1. issue contractual aceptada;
2. ADR vigente;
3. documentación normativa en `docs/`;
4. `AGENTS.md` raíz y el más cercano al archivo;
5. tests y contratos de código;
6. comentarios de implementación.

## Licencia

MIT. Consultá [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) y [UPSTREAMS.lock.yml](UPSTREAMS.lock.yml).
