# ADR-006 — Ejecución manual y sin notificaciones en el MVP

- Estado: Accepted
- Fecha: 2026-08-30

## Contexto

El usuario prefiere decidir cuándo ejecutar desde su PC y revisar los resultados inmediatamente. Telegram y cron agregan listeners, estados de entrega y operación que no son necesarios para validar el producto.

## Decisión

El MVP se ejecuta manualmente desde CLI/launcher. No incluye Telegram, email, cron, daemon ni proceso persistente.

Los resultados se presentan en terminal y en reporte HTML local.

## Consecuencias

- experiencia simple y sin servidor;
- no se encuentran ofertas mientras el usuario no ejecuta;
- se evita diseñar outbox y listeners en el MVP;
- notificaciones futuras deben agregarse como puertos/adapters sin alterar evaluación ni persistencia.
