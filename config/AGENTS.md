# AGENTS.md — `config`

## Alcance

Solo ejemplos y configuración segura para desarrollo. La configuración personal real vive fuera del repositorio.

## Reglas

- nunca incluir secretos, cookies, tokens o IDs privados;
- nombres y datos de ejemplo sintéticos;
- `schemaVersion` obligatorio;
- ejemplos deben validar contra el schema vigente;
- separar ejemplos (`*.example.yml`) de archivos personales;
- no hardcodear reglas de negocio en TypeScript cuando pueden expresarse aquí;
- cambios de semántica requieren actualizar docs y tests;
- la búsqueda Switch Lite es ejemplo/primer caso, no default universal.
