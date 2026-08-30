# ADR-002 — Arquitectura por adaptadores internos

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

Facebook es la primera fuente, pero el producto debe incorporar Mercado Libre, tiendas y watchers de URL. Diseñar plugins dinámicos completos desde el primer día agregaría complejidad sin validar contratos.

## Decisión

Definir un Adapter SDK estable y mantener adaptadores como paquetes internos registrados explícitamente durante el MVP.

La carga de plugins externos se posterga hasta que al menos dos adaptadores productivos validen el contrato.

## Consecuencias

- el núcleo permanece neutral;
- cada fuente puede tener autenticación y tecnología distinta;
- los contract tests son obligatorios;
- agregar un adapter requiere modificar el composition root, pero no el dominio;
- se evita diseñar prematuramente instalación, sandboxing y compatibilidad de plugins.
