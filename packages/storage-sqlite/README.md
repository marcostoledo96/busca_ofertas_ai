# @busca-ofertas-ai/storage-sqlite

Persistencia local e infraestructura de migraciones para Busca Ofertas AI basada en SQLite.

## Responsabilidad

Este paquete provee la capa fundacional de persistencia sobre SQLite para la aplicación local-first:

- Apertura y ciclo de vida de conexiones a archivos SQLite especificados explícitamente.
- Ejecución y verificación obligatoria de `PRAGMA foreign_keys = ON`.
- Framework de migraciones versionadas, deterministas y transaccionales (`schema_migrations`).
- Soporte estricto de rechazo ante esquemas futuros no soportados (_fail-closed_).
- Transaccionalidad atómica y manejo robusto de rollback ante fallos de migración o query.
- API limpia que oculta los detalles y tipos del driver interno hacia el resto del monorepo.

> **Importante**: Conforme al alcance contractual de BOAI-010, este paquete **no contiene tablas de negocio** (`saved_searches`, `runs`, `listings`, `observations`, etc.). Esas tablas se incorporarán en las issues correspondientes (BOAI-011, BOAI-012, etc.).

---

## Decisión del Driver SQLite

Se eligió el módulo nativo **`node:sqlite`** (`DatabaseSync`) integrado en Node.js runtime:

- **0 dependencias de runtime externas**: Sin paquetes nativos (`better-sqlite3`, `sqlite3`), reduciendo la superficie de ataque, riesgos de compilación nativa (`node-gyp`, Python, toolchains C++) y problemas de ABI.
- **Síncrono y atómico**: Elimina problemas de entrelazado asíncrono dentro de transacciones.
- **Preparado para ESM y TypeScript**: Tipado estricto e integración directa en Node.js moderno.
- **Requisito de Node.js**: Node.js **>= 22.5.0** (versión en la que `node:sqlite` fue introducido en el runtime de Node.js).

---

## Ciclo de Vida y Conexión

```ts
import { openSqliteDatabase } from '@busca-ofertas-ai/storage-sqlite';

const db = openSqliteDatabase({
  databasePath: '/ruta/hacia/busca-ofertas.sqlite',
});

// Ejecutar migraciones
const migrationResult = db.migrate();
console.log(`Esquema en versión ${migrationResult.currentVersion}`);

// Uso transaccional
db.transaction((tx) => {
  const stmt = tx.prepare('INSERT INTO ... VALUES (?, ?)');
  stmt.run('val1', 'val2');
});

// Cierre seguro e idempotente
db.close();
```

### Configuración de PRAGMAs

1. **Foreign Keys**: Cada conexión ejecuta y valida `PRAGMA foreign_keys = ON;`. Si el pragma no devuelve `1`, la conexión se rechaza inmediatamente con `PragmaConfigurationError`.
2. **Journal Mode**: Se utiliza el modo por defecto de SQLite (_rollback journal_). No se activa WAL (_Write-Ahead Logging_) para el MVP local monousuario, facilitando respaldos atómicos en un único archivo sin sidecars (`-wal`, `-shm`).

---

## Framework de Migraciones

- **Tabla de control**: `schema_migrations` (`version INTEGER PRIMARY KEY`, `name TEXT NOT NULL`, `applied_at TEXT NOT NULL`).
- **Política append-only**: Las migraciones aplicadas son inmutables. El runner verifica la coincidencia exacta de nombres y versiones previas.
- **Orden determinista**: Las migraciones se ejecutan ordenadas ascendentemente por versión positiva entera.
- **Atomicidad ante fallos**: Cada migración se ejecuta dentro de su propia transacción. Si una sentencia falla, se hace `ROLLBACK` completo del DDL y la migración **no** queda registrada como aplicada.
- **Detección de esquema futuro**: Si la base de datos posee una versión superior a la máxima conocida por el código en ejecución, el runner falla de forma cerrada lanzando `SchemaVersionUnsupportedError` e indicando actualizar la aplicación.

---

## Estrategia de Backup y Restauración Offline

Al utilizar el journal mode estándar de SQLite, la base de datos reside en un único archivo autocontenido (`busca-ofertas.sqlite`).

### Procedimiento de Backup Recomendado

1. **Cerrar la aplicación**: Asegurar que no haya ningún proceso de Busca Ofertas AI en ejecución.
2. **Confirmar que no existen bloqueos**: Verificar que no existan locks activos sobre el archivo.
3. **Copiar el archivo**: Copiar el archivo `busca-ofertas.sqlite` al destino de respaldo.
4. **Conservar permisos**: Mantener permisos restrictivos (por ejemplo `0600` o `0700` en el directorio).

### Procedimiento de Restauración

1. **Asegurar que la aplicación esté cerrada**.
2. **Hacer copia preventiva** del archivo SQLite actual si existe.
3. **Reemplazar el archivo** con el archivo de backup.
4. **Iniciar la aplicación**: El runner de migraciones validará automáticamente que la versión del esquema sea compatible antes de operar.

---

## Testing

Los tests de este paquete y de la suite de integración utilizan bases de datos temporales en `os.tmpdir()` mediante los helpers de `@busca-ofertas-ai/storage-sqlite/testing`:

```ts
import { withTempDatabase } from '@busca-ofertas-ai/storage-sqlite/testing';

withTempDatabase((db) => {
  db.migrate();
  expect(db.getCurrentSchemaVersion()).toBe(1);
});
```
