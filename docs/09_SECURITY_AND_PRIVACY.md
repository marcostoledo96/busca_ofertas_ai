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

- desactivables por fuente;
- predeterminado: solo errores y `REVIEW`;
- retención predeterminada: 30 días;
- sanitización antes de escribir;
- inventario en SQLite;
- cleanup explícito y testeado;
- jamás incluir secretos de request/response.

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
