# AGENTS.md — `packages/rules-engine`

## Responsabilidad

Evaluar reglas deterministas, producir score y razones explicables.

## Reglas

- funciones puras siempre que sea posible;
- cada regla devuelve resultado estructurado, no solo boolean;
- códigos de razón estables y documentados;
- distinguir impacto `INFO`, `SOFT` y `HARD`;
- un `HARD` reject no es compensable;
- orden de reglas no debe cambiar el resultado salvo que el contrato lo declare;
- no llamar APIs ni IA;
- no mutar Listing/Observation;
- perfiles de producto viven en módulos/configuración, no en el evaluador genérico.

## Tests

- tabla de casos positivos, negativos y fronteras;
- falsos positivos conocidos;
- reglas monetarias con fixtures específicos;
- test de estabilidad de reason codes.
