# ADR-001 — Aplicación local-first y monorepo TypeScript

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

El usuario ejecutará el sistema desde Ubuntu, no quiere pagar infraestructura y necesita reutilizar patrones de un proyecto Node.js existente. El producto debe admitir múltiples fuentes sin convertirse en microservicios.

## Decisión

Construir una aplicación local-first en TypeScript, organizada como monorepo modular con una única distribución ejecutable.

No habrá backend remoto, frontend hospedado ni microservicios en el MVP.

## Consecuencias

### Positivas

- costo fijo de infraestructura igual a cero;
- reutilización directa de patrones TypeScript/Node;
- contratos y paquetes aislados;
- instalación y backup locales;
- menor superficie de seguridad.

### Negativas

- la computadora debe estar disponible para ejecutar;
- no hay acceso remoto ni notificaciones automáticas;
- la portabilidad fuera de Linux requiere trabajo adicional.

## Alternativas rechazadas

- fork Python de una aplicación centrada en Facebook;
- backend hospedado con PostgreSQL;
- Electron desde el inicio;
- microservicios por fuente.
