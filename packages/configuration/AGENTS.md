# AGENTS.md — `packages/configuration`

## Responsabilidad

Validar, migrar, importar/exportar y asistir la creación de búsquedas.

## Reglas

- YAML visible; objetos validados en runtime;
- `schemaVersion` obligatorio;
- no aceptar claves desconocidas silenciosamente salvo política de forward compatibility explícita;
- no almacenar secretos inline;
- preservar semántica al exportar/importar;
- migraciones puras y testeables;
- separar opciones comunes de `source.options`;
- comprobar capabilities antes de ejecutar;
- mensajes de error con path del campo y corrección sugerida.

## Wizard

- generar siempre una configuración válida;
- modo simple primero, avanzado opcional;
- mostrar resumen/diff antes de guardar;
- no sobrescribir archivo existente sin confirmación.
