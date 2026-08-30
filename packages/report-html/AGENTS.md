# AGENTS.md — `packages/report-html`

## Responsabilidad

Generar un reporte HTML estático, autocontenido, accesible y seguro.

## Reglas

- escapar todo contenido externo;
- no inyectar descripciones como HTML crudo;
- no ejecutar scripts de terceros;
- no depender de CDN;
- protocolos de enlaces e imágenes validados;
- funcionar desde `file://`;
- secciones visibles de MATCH, REVIEW, REJECT y errores;
- REJECT colapsado por defecto;
- color acompañado por texto/iconografía;
- orden estable y testeable;
- no leer SQLite directamente: recibir view model.

## Privacidad

No mostrar cookies, tokens, headers, paths de sesión ni artifacts sensibles.

## Tests

- escaping/XSS;
- caracteres Unicode;
- reporte vacío legítimo;
- errores de fuente;
- accesibilidad semántica básica;
- golden files pequeños y revisables.
