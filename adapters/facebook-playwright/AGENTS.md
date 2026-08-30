# AGENTS.md — `adapters/facebook-playwright`

## Objetivo

Fallback explícito de Facebook basado en Playwright estándar.

## Reglas específicas

- solo se implementa si la issue contractual demuestra necesidad;
- login manual;
- sesión en directorio local privado y fuera de Git;
- no guardar usuario/contraseña en código;
- detectar login, checkpoint, challenge, CAPTCHA y consentimiento;
- no resolverlos automáticamente;
- no usar Patchright ni plugins stealth;
- esperar todos los handlers/promesas antes de cerrar browser;
- lifecycle seguro de browser/context/page;
- no ejecutar como root;
- limitar scroll, páginas, items y duración;
- artifacts sanitizados;
- fallback nunca es silencioso: el run registra collector y causa.

## Tests

- fixtures DOM/GraphQL capturados y sanitizados;
- lifecycle con browser mock o servidor local;
- expiración de sesión;
- challenge;
- timeout/cancelación;
- cero resultados válido.
