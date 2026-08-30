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

## Supply chain

- lockfile obligatorio;
- dependencias mínimas;
- auditoría en CI;
- revisión manual de updates que afecten browsers, parsers o SQLite;
- acciones de GitHub fijadas a versiones estables y permisos mínimos;
- procedencia obligatoria para código copiado.

## Respuesta ante incidente

Si se versiona accidentalmente un secreto:

1. revocar/rotar inmediatamente;
2. eliminarlo de la rama y evaluar reescritura de historial;
3. documentar alcance;
4. agregar test o control preventivo;
5. no limitarse a borrar el archivo del commit más reciente.
