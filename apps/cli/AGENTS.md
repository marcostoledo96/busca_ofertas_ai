# AGENTS.md — `apps/cli`

## Responsabilidad

Componer casos de uso y ofrecer interacción local. La CLI es una capa de entrada/presentación, no contiene reglas de negocio ni integración directa con fuentes.

## Reglas

- invocar puertos/casos de uso de `core`;
- resolver dependencias en un composition root explícito;
- no importar Playwright, drivers SQLite ni clientes HTTP;
- no parsear precios ni decidir `MATCH/REVIEW/REJECT`;
- mensajes humanos separados de códigos estables;
- toda acción destructiva requiere confirmación;
- cancelación limpia mediante `AbortController`;
- errores esperables se presentan con próximo paso accionable;
- funcionamiento completo por teclado;
- no imprimir secretos, paths de sesión ni payloads crudos.

## UX contractual

- menú principal definido en `docs/12_CLI_AND_REPORT_UX.md`;
- abrir HTML automáticamente al terminar, con fallback a mostrar ruta;
- preguntar si se revisan casos `REVIEW`;
- solicitar cotización manual solo cuando sea necesaria;
- no iniciar daemon, cron ni listener en el MVP.

## Tests

- comandos con adapters y repositorios fake;
- snapshots textuales solo para estructuras estables;
- E2E offline mediante directorios temporales;
- no abrir navegador real durante tests.
