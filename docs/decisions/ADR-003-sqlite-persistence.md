# ADR-003 — SQLite como persistencia del MVP

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

La aplicación es local, monousuario y necesita historial, transacciones y consultas. JSON sería simple pero frágil para observaciones y migraciones; PostgreSQL exige más operación de la necesaria.

## Decisión

Usar SQLite con migraciones versionadas, foreign keys y repositorios detrás de puertos del core.

PostgreSQL solo se evaluará ante una versión multiusuario o servidor real.

## Consecuencias

- instalación sin servicio de DB;
- archivo fácil de respaldar;
- historial y consultas transaccionales;
- necesidad de migrations y cuidado con concurrencia;
- portabilidad futura mediante puertos, no mediante SQL idéntico.
