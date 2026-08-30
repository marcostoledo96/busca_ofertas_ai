# AGENTS.md — `packages/core`

## Responsabilidad

Contener lenguaje de dominio, invariantes, casos de uso y puertos. Debe poder testearse sin filesystem, red, SQLite, browser ni variables de entorno.

## Prohibido

- dependencias de frameworks;
- imports desde `apps/*` o implementaciones concretas;
- acceso directo a `process.env`, `Date.now()` o UUID globales sin puertos inyectados;
- DTOs crudos de Facebook/Mercado Libre;
- lógica de rendering;
- strings mágicos para estados.

## Reglas

- usar value objects para precio, identidad y decisiones;
- estados mediante unions discriminadas;
- invariantes verificadas al construir entidades;
- errores de dominio específicos;
- casos de uso reciben dependencias por interfaz;
- timestamps proporcionados por `Clock`;
- IDs proporcionados por `IdGenerator`;
- razones de evaluación estructuradas y estables.

## IA

El core solo conoce un puerto opcional de evaluación. No conoce DeepSeek ni prompts. Un hard rejection determinista es final.

## Tests

- cobertura prioritaria de branches e invariantes;
- property-based tests cuando aporten valor al money model;
- ningún mock de detalles internos: usar fakes por contrato.
