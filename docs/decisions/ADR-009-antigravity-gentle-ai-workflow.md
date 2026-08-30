# ADR-009 — Antigravity con Gentle AI fijado y artifacts secuenciales

**Estado:** Accepted

## Contexto

El proyecto se implementará principalmente con Antigravity. Gentle AI ofrece routing orgánico, SDD y review/RDD, pero la integración de Antigravity trabaja de forma secuencial y una prerelease puede cambiar contratos o proyecciones administradas.

## Decisión

Fijar Gentle AI en `v2.5.0-rc.3`, commit `8e5c79b08c14b5ecded4a449e7d21cd526f52e94`, mediante `GENTLE_AI.lock.yml`. Gentle AI decide routing/lifecycle; la issue y el repositorio deciden alcance y delivery. SDD es opt-in y, en Antigravity, cada fase debe persistir un artifact completo y releer el anterior desde filesystem. El historial del chat no es estado de SDD. RDD es opt-in y sus comandos de continuación no se reconstruyen manualmente.

## Alternativas consideradas

- Seguir la última release automáticamente: rechazado por pérdida de reproducibilidad.
- Forzar SDD en todas las issues: rechazado por costo y artifacts innecesarios.
- Confiar en memoria de chat entre fases: rechazado por fragilidad y falta de trazabilidad.

## Consecuencias

- Las actualizaciones de Gentle AI requieren revisión explícita y una ADR superseding si cambia el modelo operativo.
- Las PR registran versión, ruta y artifacts/review aplicables.
- Los archivos de registry generados en `.atl/` no se versionan.
