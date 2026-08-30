# AGENTS.md — `packages/ai`

## Responsabilidad

Proveer una interfaz opcional para evaluar casos ambiguos.

## Reglas

- proveedor neutral en contratos públicos;
- DeepSeek es una implementación, no parte del dominio;
- solo evaluar casos autorizados por política;
- confirmación manual y límite por run;
- minimizar datos enviados;
- schema estricto de respuesta;
- fail closed: respuesta inválida conserva `REVIEW` o error, nunca promoción automática;
- IA no puede confirmar moneda sin evidencia;
- IA no revierte hard rejects;
- caché incluye hash de contenido, búsqueda, política y modelo;
- prompts versionados y testeados;
- no registrar claves ni respuestas crudas con datos innecesarios.

## Tests

- parser con JSON válido/inválido;
- tipos incorrectos;
- scores fuera de rango;
- intento de revertir hard reject;
- moneda inventada;
- budget agotado;
- cache hit/miss por versión.
