# AGENTS.md — `packages/storage-sqlite`

## Responsabilidad

Implementar puertos de persistencia mediante SQLite.

## Reglas

- migrations append-only; no editar una migración aplicada;
- `PRAGMA foreign_keys = ON`;
- WAL solo si la estrategia y plataforma lo justifican;
- queries parametrizadas;
- transacciones para escrituras relacionadas;
- índices justificados por consultas reales;
- timestamps UTC;
- repositorios no contienen reglas de evaluación;
- no persistir secretos o cookies;
- historial de observaciones inmutable;
- cleanup de raw artifacts no elimina datos normalizados contractuales.

## Concurrencia

Implementar lock local y detectar una segunda ejecución. No asumir que la ejecución manual impide concurrencia.

## Tests

Cada migración se prueba desde base vacía y desde versión anterior. Usar DB temporal por test suite y verificar rollback ante fallos.
