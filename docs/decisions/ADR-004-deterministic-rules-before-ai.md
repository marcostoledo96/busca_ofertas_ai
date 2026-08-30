# ADR-004 — Reglas deterministas antes que IA

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

Precios, moneda, accesorios y defectos contienen decisiones que deben ser auditables. La IA agrega costo, variabilidad y puede producir respuestas incorrectas.

## Decisión

Aplicar primero reglas deterministas. La IA será opcional, se usará principalmente sobre `REVIEW`, requerirá confirmación y nunca podrá anular razones `HARD`.

## Consecuencias

- decisiones reproducibles y explicables;
- menor costo;
- falsos positivos conocidos se convierten en reglas y tests;
- algunos casos quedan en `REVIEW` en vez de forzar certeza;
- prompts y proveedores permanecen fuera del dominio.
