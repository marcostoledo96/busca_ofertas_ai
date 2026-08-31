# Busca Ofertas AI

Aplicación **local-first** para buscar, normalizar, evaluar y revisar oportunidades provenientes de múltiples fuentes. El primer caso de uso será encontrar **Nintendo Switch Lite en Facebook Marketplace dentro de AMBA**, pero el núcleo se diseña para admitir otros productos, precios, monedas, sitios, inmuebles y vehículos sin modificar la lógica central.

> Estado actual: **workspace TypeScript inicializado con quality gates locales (`BOAI-001`); la lógica de dominio, adaptadores, persistencia y CLI se implementarán en las siguientes etapas del roadmap**.

## Requisitos

- **Node.js**: `22.0.0` o superior (`>=22.0.0`)
- **pnpm**: `9.0.0` o superior (versión fijada del repositorio: `10.33.2`)

## Instalación

```bash
pnpm install --frozen-lockfile
```

## Comandos disponibles

Todos los scripts se ejecutan desde la raíz del monorepo:

### Desarrollo y compilación

- `pnpm format:check`: verifica el formato del código mediante Prettier.
- `pnpm format`: formatea automáticamente los archivos compatibles mediante Prettier.
- `pnpm lint`: ejecuta ESLint con reglas TypeScript estrictas, límites de export maps y verificación de tipos.
- `pnpm lint:boundaries`: valida las reglas arquitectónicas y límites de módulos con dependency-cruiser.
- `pnpm typecheck`: verifica los tipos en todo el monorepo sin emitir archivos mediante TypeScript (`tsc -b`).
- `pnpm test`: compila los paquetes del workspace y ejecuta la suite de tests locales mediante Vitest.
- `pnpm test:watch`: ejecuta Vitest en modo interactivo/watch.
- `pnpm build`: compila los paquetes del workspace y la CLI mediante TypeScript (`tsc -b`).
- `pnpm clean`: limpia los artefactos de build y cachés de compilación.

### Ejecución de la CLI local

Para construir y ejecutar la shell interactiva de `busca-ofertas`:

```bash
# Compilar el monorepo y la aplicación CLI
pnpm build

# Iniciar la CLI interactiva
node apps/cli/dist/bin.js
```

#### Estado de opciones del menú (BOAI-006)

El menú principal contractual presenta 8 opciones:

1. `1. Ejecutar una búsqueda`: Todavía no implementado (previsto para BOAI-011).
2. `2. Crear una búsqueda`: Todavía no implementado (previsto para BOAI-007).
3. `3. Editar una búsqueda`: Todavía no implementado (previsto para BOAI-007).
4. `4. Ver historial`: Todavía no implementado (previsto para BOAI-010).
5. `5. Revisar publicaciones dudosas`: Todavía no implementado (previsto para BOAI-011).
6. `6. Ver errores de fuentes`: Todavía no implementado (previsto para BOAI-011).
7. `7. Configuración`: Todavía no implementado (previsto para BOAI-007).
8. `8. Salir`: **Disponible** — Finaliza la aplicación limpiamente con código de salida `0`.

Seleccionar una opción no disponible informa al usuario que aún no está implementada y regresa de forma segura al menú interactivo.

#### Tabla de Códigos de Salida (Exit Codes)

| Código | Identificador                  | Significado                                                                                   |
| :----- | :----------------------------- | :-------------------------------------------------------------------------------------------- |
| `0`    | `SUCCESS`                      | Finalización exitosa (ej. salida voluntaria mediante opción 8).                               |
| `10`   | `PARTIAL_SUCCESS`              | Al menos una fuente o etapa completó y otra falló.                                            |
| `20`   | `INVALID_CONFIGURATION`        | La configuración de la búsqueda contiene errores de validación.                               |
| `30`   | `TOTAL_SOURCE_FAILURE`         | Todas las fuentes consultadas fallaron.                                                       |
| `40`   | `MANUAL_INTERVENTION_REQUIRED` | Se requiere intervención humana (ej. checkpoint, reautenticación).                            |
| `70`   | `INTERNAL_ERROR`               | Error interno inesperado no manejado por el dominio.                                          |
| `130`  | `CANCELLED`                    | Ejecución interrumpida cooperativamente por el usuario (`SIGINT` / `Ctrl+C` / `AbortSignal`). |

### Supply chain, seguridad y CI

- `pnpm ci:generated`: verifica que los archivos generados de Gentle AI (`.atl/`) no estén versionados y que `.gitignore` tenga reglas exactas (sin ignores globales).
- `pnpm ci:secrets`: escanea archivos trackeados en búsqueda de credenciales, tokens o archivos sensibles sin exponer sus valores.
- `pnpm ci:provenance`: valida semánticamente la procedencia de upstreams, locks cruzados, skills, notices y el pinning de GitHub Actions.
- `pnpm ci:workflow`: comprueba la política de seguridad del workflow de CI (permisos mínimos, pinning por SHA, triggers seguros y calidad).
- `pnpm audit:dependencies`: ejecuta la auditoría de dependencias bloqueante para vulnerabilidades `HIGH` y `CRITICAL` en dev y prod.

## Integración Continua (CI)

El proyecto utiliza GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) para reproducir los quality gates locales en cada `push` y `pull_request`:

1. **Permisos mínimos**: ejecución con `contents: read` y `persist-credentials: false`.
2. **Pinning inmutable**: todas las Actions externas están fijadas por commit SHA completo de 40 caracteres y registradas en [`UPSTREAMS.lock.yml`](UPSTREAMS.lock.yml).
3. **Instalación reproducible**: Node 22 (`.nvmrc`), pnpm 10.33.2 y caché de store derivado estrictamente de `pnpm-lock.yaml`.
4. **Gates estrictos**: ejecución secuencial de format, lint, límites de arquitectura, typecheck, tests unitarios/contrato, build, escaneo de secretos, guard de `.atl/`, validación de procedencia y auditoría de seguridad.
5. **Aislamiento**: la CI permanece 100 % offline respecto de fuentes de Marketplace, sin requerir secretos, credenciales ni Gentle AI en el runner.

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

## Antigravity y Gentle AI

El proyecto se desarrollará con Antigravity y Gentle AI fijado a `v2.5.0-rc.3`. La versión exacta y política de actualización viven en [`GENTLE_AI.lock.yml`](GENTLE_AI.lock.yml).

Reglas principales:

- una issue por unidad de trabajo;
- Gentle AI selecciona orgánicamente trabajo directo, delegado o SDD;
- SDD no es obligatorio: requiere ambigüedad sustancial y aceptación explícita;
- en Antigravity las fases SDD son secuenciales y cada fase relee el artifact anterior desde filesystem;
- review/RDD es opt-in y no reemplaza la política de PR/merge del repositorio;
- las skills locales `boai-*` complementan, sin duplicar, las skills globales.

Consultá [el workflow completo](docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md) y [la auditoría de skills](docs/14_PROJECT_SKILLS.md).

## Skills del workspace

Antigravity descubre las skills versionadas en [`.agents/skills/`](.agents/skills/README.md):

- `boai-domain-modeling`;
- `boai-codebase-design`;
- `boai-module-boundaries`.

Después de clonar o actualizar esas carpetas:

```bash
gentle-ai skill-registry refresh
gentle-ai doctor
```

No hace falta descargarlas globalmente ni ejecutar `npx skills add`; forman parte del repositorio y están fijadas en [`.agents/skills.lock.yml`](.agents/skills.lock.yml).

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
- [Workflow Antigravity + Gentle AI](docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md)
- [Skills locales](docs/14_PROJECT_SKILLS.md)

El lenguaje ubicuo vive en [`CONTEXT.md`](CONTEXT.md). Las decisiones arquitectónicas permanentes viven en [`docs/decisions/`](docs/decisions/).

## Fuentes de autoridad

Ante contradicciones, se aplica el orden definido en [`AGENTS.md`](AGENTS.md). Gentle AI administra routing y lifecycle; la issue, las ADR y los documentos contractuales definen qué debe construirse.

## Licencia

MIT. Consultá [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAMS.lock.yml](UPSTREAMS.lock.yml) y [`.agents/skills.lock.yml`](.agents/skills.lock.yml).
