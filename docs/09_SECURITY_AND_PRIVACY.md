# 09 — Seguridad y privacidad

## Modelo de amenaza

El MVP procesa contenido público o visible para una sesión autorizada, pero maneja activos sensibles locales:

- cookies y sesiones;
- tokens de APIs opcionales;
- historial de búsquedas;
- datos crudos de publicaciones;
- reportes locales;
- archivos HTML con contenido externo.

## Principios

- mínimo privilegio;
- secretos fuera del repositorio;
- retención limitada;
- logs estructurados y redactados;
- datos externos tratados como no confiables;
- intervención humana ante controles de la fuente;
- sin servidor abierto a la red en el MVP.

## Directorios locales

Usar XDG cuando esté disponible:

```text
$XDG_CONFIG_HOME/busca-ofertas-ai/
$XDG_DATA_HOME/busca-ofertas-ai/
$XDG_STATE_HOME/busca-ofertas-ai/
$XDG_CACHE_HOME/busca-ofertas-ai/
```

Fallback bajo `~/.config`, `~/.local/share`, `~/.local/state` y `~/.cache`.

Permisos recomendados:

- directorios privados `0700`;
- archivos de secretos/sesión `0600`;
- base y reportes no accesibles para otros usuarios por defecto.

## Secretos

Nunca versionar:

- `.env` real;
- cookies;
- `storageState`;
- perfiles de Chromium;
- tokens de IA;
- headers capturados;
- snapshots con sesión.

El `SecretProvider` debe permitir variables de entorno y archivos locales. No imprimir valores ni longitudes que permitan inferencias innecesarias.

## Facebook y otras fuentes

No implementar:

- bypass de CAPTCHA;
- rotación de cuentas;
- proxies para evadir límites;
- técnicas cuyo propósito principal sea ocultar automatización;
- contacto o compra automática;
- scraping masivo.

Ante challenge/checkpoint:

1. detener el adapter;
2. guardar diagnóstico sanitizado;
3. devolver `MANUAL_INTERVENTION_REQUIRED`;
4. permitir restaurar sesión manualmente.

## Datos de publicaciones

Persistir solo lo necesario:

- ID externo;
- URL;
- título y descripción;
- precio;
- ubicación general;
- condición;
- imágenes como URL, no descarga automática;
- timestamps;
- evidencia de evaluación.

No construir perfiles de vendedores ni conservar datos personales no necesarios.

## Raw artifacts

- **Políticas canónicas**: `NONE`, `ERRORS_ONLY`, `ERRORS_AND_REVIEW` (default) y `ALL_LIMITED`. Configuraciones existentes con legacy `ALL` se canonicalizan a `ALL_LIMITED` en la proyección de dominio sin perder compatibilidad.
- **Retención y vencimiento**: Configuración predeterminada de 30 días (`rawDataDays: 30`). El cálculo del vencimiento se realiza al momento de la creación (`expiresAt = createdAt + rawDataDays * 86400000`) y se almacena en SQLite en formato canónico ISO UTC.
- **Sanitización estricta y Fail-Closed**: Todo contenido de texto o JSON pasa por `ArtifactSanitizerPort` antes de ser almacenado. Patrones sensibles (tokens Bearer, claves de API, cookies, contraseñas) se redactan determinísticamente a `[REDACTED]`. Si `validateNoSensitiveData()` detecta secretos remanentes, la operación aborta fail-closed inmediatamente (0 bytes escritos en disco y 0 filas insertadas en la base).
- **Tipos de contenido soportados**: Exclusivamente texto codificado en UTF-8 (`text/plain`, `text/html`, etc.) y estructuras serializables JSON (`application/json`). Se rechazan tipos no soportados o blobs binarios arbitrarios.
- **Límites de tamaño y presupuesto**:
  - Límite por artifact: 5 MB (`maxArtifactSizeBytes`).
  - Presupuesto por run: 50 MB o 100 artifacts (`maxRunBudgetBytes` y `maxArtifactsPerRun`). Superar estos límites emite errores tipados (`ArtifactSizeLimitExceededError` o `RunArtifactBudgetExceededError`).
- **Ubicación y permisos restrictivos**:
  - Directorio base: `$XDG_DATA_HOME/busca-ofertas-ai/artifacts/`.
  - Estructura: subdirectorios mensuales `YYYY-MM/` con permisos `0700` y archivos `art_<uuid>.<ext>` con permisos `0600`.
  - Los nombres de archivo se generan internamente mediante UUIDs criptográficos. Jamás se utiliza input externo, títulos ni URLs como nombres de archivo.
- **Defensa contra Path Traversal y Symlinks**:
  - El adapter filesystem valida estrictamente la ruta relativa (rechaza paths absolutos `/`, segmentos `..`, separadores `\`, caracteres de control y bytes nulos).
  - Cada componente del path se inspecciona mediante `lstat` para prohibir escapes a través de symlinks tanto en directorios intermedios como en el archivo destino.
- **Escritura atómica e inmutabilidad**:
  - Los archivos se escriben primero en un directorio temporal `.tmp/` bajo el root de artifacts con flag exclusivo `wx`, permisos `0600`, sincronización a disco vía `fsync()` y renombrado atómico (`rename`).
  - Detección de colisión de identidad: Si el archivo destino ya existe, se aborta con `ArtifactIdentityCollisionError` sin sobrescribir el archivo preexistente.
- **Coherencia relacional en SQLite**:
  - Tabla `raw_artifacts` creada mediante la migración 005 con clave foránea compuesta `(source_run_id, run_id) REFERENCES source_runs(id, run_id) ON DELETE SET NULL` y clave foránea `run_id REFERENCES runs(id) ON DELETE SET NULL`.
  - Impide cross-association accidental entre `source_run_id` y `run_id` dispares.
- **Limpieza (Cleanup)**:
  - **Limpieza manual**: Accesible desde el submenú de Configuración ("Limpiar artifacts vencidos"). Muestra un conteo y tamaño estimado de artifacts expirados, solicita confirmación explícita (cancelar no borra nada) y ejecuta la eliminación reportando un resumen sanitizado (`encontrados`, `eliminados`, `ya ausentes`, `fallidos`).
  - **Limpieza al inicio**: Configurable mediante `cleanupOnStartup: boolean` (deshabilitada por defecto `false`). Cuando se activa, depura artifacts vencidos consultando directamente el campo `expiresAt` de SQLite.
  - **Orden de limpieza y convergencia**: Primero se valida y elimina el archivo físico en disco, y luego se borra el registro en SQLite. Si el archivo físico ya no existía en disco, el registro en SQLite se depura convergiendo el estado (`alreadyMissing++`). Si la eliminación del archivo falla, el registro en SQLite se preserva (`failed++`).

## HTML local

Todo contenido externo debe escaparse. Requisitos:

- CSP restrictiva cuando sea aplicable en archivo local;
- no insertar HTML de descripción con `innerHTML` sin sanitización;
- enlaces con protocolos permitidos (`https` preferido);
- imágenes remotas opcionales y sin scripts;
- no ejecutar JavaScript proveniente de publicaciones;
- no depender de CDN para funcionar.

## SQLite

- queries parametrizadas;
- migraciones versionadas;
- transacciones;
- integridad referencial habilitada;
- backups manuales documentados;
- no almacenar secretos dentro de la base.

## IA

Antes de enviar contenido a un proveedor:

- informar qué datos se enviarán;
- pedir confirmación;
- limitar cantidad;
- reducir campos al mínimo;
- no enviar cookies, identificadores privados ni archivos crudos completos;
- validar respuesta como input no confiable.

## Supply chain y seguridad en CI

- **Mínimo privilegio**: Los workflows de GitHub Actions declaran explícitamente `permissions: contents: read` y `persist-credentials: false`.
- **Triggers seguros**: Se utilizan exclusivamente `push` y `pull_request`. Se prohíbe el uso de `pull_request_target` para evitar ejecución de código no confiable con privilegios elevados.
- **Pinning inmutable de Actions**: Todas las GitHub Actions externas se fijan por commit SHA completo de 40 caracteres (no por tags mutables como `@v7` o `@main`) y se registran en `UPSTREAMS.lock.yml` y `THIRD_PARTY_NOTICES.md`.
- **Caché seguro y reproducible**: El caché de Node y pnpm en CI deriva exclusivamente de `pnpm-lock.yaml`. No se cachean `node_modules`, cookies, sesiones ni credenciales.
- **Auditoría estricta de dependencias**: La auditoría (`pnpm audit --audit-level=high`) bloquea vulnerabilidades `HIGH` y `CRITICAL` en dependencias de producción y `devDependencies`. No se permite el uso de `--ignore-registry-errors` ni `--ignore-unfixable`, ni suppressions/overrides automáticos.
- **Detección determinista de secretos**: Escaneo de archivos trackeados mediante `pnpm ci:secrets` que reporta alertas sin exponer valores sensibles en stdout/stderr.
- **Límites entre validación y branch protection**: La validación de políticas dentro del workflow (`pnpm ci:workflow`) actúa como defensa en profundidad, pero no reemplaza la configuración server-side de GitHub (como required status checks y branch protection), la cual corresponde a la administración del repositorio y queda fuera del scope de la CI local.


## Respuesta ante incidente

Si se versiona accidentalmente un secreto:

1. revocar/rotar inmediatamente;
2. eliminarlo de la rama y evaluar reescritura de historial;
3. documentar alcance;
4. agregar test o control preventivo;
5. no limitarse a borrar el archivo del commit más reciente.
