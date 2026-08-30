# ADR-007 — Estrategia de collectors para Facebook

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

El collector GraphQL es liviano y reutilizable desde un upstream MIT, pero depende de contratos internos. Playwright puede usar sesión manual y observar la aplicación real, pero es más pesado y frágil.

## Decisión

1. Construir primero un spike `facebook-graphql` basado en el mínimo código MIT de `secondhand-mcp`.
2. Productivizarlo solo si supera gates de Argentina, paginación, radio, orden y health.
3. Implementar `facebook-playwright` únicamente como fallback si la evidencia lo requiere.
4. Todo fallback será explícito y visible; nunca ocultará un error de contrato.

## Consecuencias

- menor costo operativo inicial;
- se necesita canary para `doc_id` y payloads;
- Playwright queda disponible para sesión/manual intervention;
- se requieren dos juegos de fixtures si ambos collectors existen;
- el núcleo no cambia al reemplazar estrategia.
