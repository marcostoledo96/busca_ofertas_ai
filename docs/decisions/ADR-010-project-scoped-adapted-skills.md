# ADR-010 — Skills locales adaptadas y namespaced

**Estado:** Accepted

## Contexto

El usuario ya dispone de skills globales. Instalar muchas skills genéricas en el proyecto generaría colisiones y duplicaría TDD, review, GitHub y Playwright. Algunas skills útiles de `skills.sh` contienen rutas o patrones incompatibles con este repositorio y con el modelo secuencial de Antigravity.

## Decisión

Versionar en `.agents/skills/` tres skills MIT adaptadas desde `mattpocock/skills` y fijadas por SHA: `boai-domain-modeling`, `boai-codebase-design` y `boai-module-boundaries`. Usar el prefijo `boai-`, conservar licencia/procedencia y mantener `.agents/skills.lock.yml`. Las skills técnicas complementan al entorno global y nunca controlan routing, SDD/RDD ni delivery.

## Alternativas consideradas

- Instalar las skills originales globalmente: rechazado por colisiones y falta de adaptación contractual.
- Usar `npx skills add` en cada clon sin fijar contenido: rechazado por mutabilidad y revisión insuficiente.
- No incorporar ninguna skill local: rechazado porque dominio, seams y límites de imports son riesgos repetidos y específicos.

## Consecuencias

- Antigravity descubre las skills directamente al clonar.
- Toda actualización requiere comparar upstream, reaplicar adaptaciones y refrescar el registry.
- Skills futuras solo se agregan si cubren un hueco real sin duplicar Gentle AI o el entorno global.
