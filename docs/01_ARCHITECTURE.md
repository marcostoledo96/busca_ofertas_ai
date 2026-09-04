# 01 — Arquitectura

## Estilo

Monorepo modular TypeScript ejecutado como una sola aplicación local. No se usarán microservicios ni infraestructura remota en el MVP.

## Componentes previstos

```text
apps/cli
  └─ interacción, comandos y presentación

packages/core
  └─ dominio y casos de uso puros

packages/adapter-sdk
  └─ contratos, capacidades y errores de fuentes

packages/configuration
  └─ esquemas, versionado y wizard

packages/rules-engine
  └─ reglas deterministas y explicaciones

packages/storage-sqlite
  └─ migraciones y repositorios

packages/report-html
  └─ reporte estático local

packages/exports
  └─ JSON y CSV

packages/ai
  └─ interfaz opcional de proveedores, parser y caché

adapters/*
  └─ implementaciones aisladas por fuente
```

## Dirección de dependencias

```text
apps/cli ───────────────┐
adapters/* ─────────────┤
packages/storage-sqlite ┤
packages/rules-engine ──┤
packages/report-html ───┤
packages/exports ───────┤
packages/ai ────────────┤
                        ▼
                 packages/core
                        ▲
                        │
              packages/adapter-sdk
```

Reglas:

- `core` no depende de CLI, SQLite, Playwright, APIs ni formatos externos.
- un adaptador puede depender de `adapter-sdk` y tipos de dominio públicos, nunca de la CLI.
- la CLI orquesta casos de uso; no implementa reglas de negocio.
- reportes y exportadores consumen modelos de lectura, no consultan fuentes.
- la capa de IA es opcional y reemplazable.

## Flujo principal

```text
1. Cargar búsqueda versionada
2. Validar configuración
3. Resolver adaptadores y capabilities
4. Ejecutar health checks
5. Recolectar páginas/resultados
6. Normalizar a ListingCandidate
7. Canonizar identidad y URL
8. Resolver precio/moneda
9. Persistir observación cruda y normalizada
10. Aplicar reglas deterministas
11. Consultar IA solo si fue solicitada y el caso es REVIEW
12. Persistir evaluación y feedback pendiente
13. Generar HTML, JSON y CSV
14. Abrir reporte y ofrecer revisión manual
```

## Estrategia de adaptadores

Durante el MVP los adaptadores serán paquetes internos registrados explícitamente. El diseño debe permitir plugins posteriores, pero no se agregará carga dinámica prematura.

Adaptadores planificados:

1. `synthetic` para desarrollo y tests;
2. `facebook-graphql` como primera investigación productiva;
3. `facebook-playwright` como fallback explícito;
4. `mercadolibre` después del MVP;
5. `url-watcher` después del MVP;
6. `generic-store` para sitios simples.

## Persistencia

SQLite será la fuente de verdad local. Todo cambio de esquema requiere migración. El sistema conserva:

- búsquedas;
- runs globales y por fuente;
- publicaciones canónicas;
- observaciones;
- evaluaciones;
- razones;
- feedback;
- caché de IA;
- artifacts crudos con vencimiento.

## Transacciones

La persistencia de una observación y su asociación con el run debe ser atómica. Un fallo al generar el reporte no debe borrar resultados ya recolectados. La generación de exports se puede reintentar desde un run persistido.

## Concurrencia

El MVP se ejecuta manualmente, pero debe usar un lock local para impedir dos runs simultáneos sobre la misma base. La ausencia de daemon no elimina el riesgo de doble apertura.

## Reportes

El HTML será estático, autocontenido y seguro para abrir mediante `file://`:

- sin backend;
- sin recursos remotos obligatorios;
- contenido externo escapado;
- secciones `MATCH`, `REVIEW`, `REJECT` y errores;
- rechazadas colapsadas;
- enlace explícito a la fuente;
- JSON y CSV hermanos.

## IA

La IA no pertenece al camino obligatorio. Su ejecución requiere:

- caso en `REVIEW`;
- proveedor configurado;
- confirmación manual;
- límite por run;
- respuesta validada por esquema;
- caché basada en contenido, configuración, versión de política y modelo.

## Fronteras futuras

PostgreSQL, servidor HTTP, multiusuario y plugins externos solo se evaluarán cuando exista una necesidad real. Ninguno debe contaminar los contratos del MVP.
