# Skills locales de Busca Ofertas AI

Estas skills están versionadas en el repositorio para que Antigravity las descubra desde `.agents/skills/`. Complementan las skills globales del usuario; no intentan reemplazarlas.

## Skills activas

| Skill | Propósito | Uso principal |
|---|---|---|
| `boai-domain-modeling` | Mantener lenguaje ubicuo, escenarios e invariantes | Dominio, `CONTEXT.md`, ADR y BOAI-002 |
| `boai-codebase-design` | Diseñar módulos profundos e interfaces pequeñas | `core`, Adapter SDK, storage, rules y reportes |
| `boai-module-boundaries` | Configurar y probar límites de importación TypeScript | BOAI-001 y endurecimiento de BOAI-002 |

## Por qué tienen prefijo `boai-`

Evita colisiones con skills globales del mismo nombre y deja claro que son adaptaciones contractuales de este proyecto.

## Autoridad y límites

- La issue, las ADR, la documentación normativa y `AGENTS.md` prevalecen sobre una skill.
- Gentle AI decide la ruta de trabajo y el lifecycle de SDD/RDD.
- Una skill técnica no inicia SDD, no cambia de issue, no crea una PR ni hace merge por sí sola.
- En Antigravity no se debe ejecutar el patrón de subagentes paralelos del upstream. Las alternativas se diseñan secuencialmente y se persisten en artifacts cuando corresponde.

## Instalación

No hace falta ejecutar `npx skills add`: las skills ya forman parte del clon. Después de clonar o modificar estas carpetas, ejecutar:

```bash
gentle-ai skill-registry refresh
gentle-ai doctor
```

`gentle-ai sync` se ejecuta después de instalar o actualizar Gentle AI, no como mutación rutinaria dentro de cada issue.

## Actualización

1. Revisar el upstream y fijar un SHA nuevo.
2. Comparar cada archivo utilizado.
3. Verificar licencia y cambios de seguridad.
4. Reaplicar las adaptaciones del proyecto.
5. Mantener compatibilidad con `GENTLE_AI.lock.yml`.
6. Actualizar este directorio, `.agents/skills.lock.yml`, `UPSTREAMS.lock.yml` y `THIRD_PARTY_NOTICES.md`.
7. Refrescar el registry y comprobar que Antigravity descubre exactamente las skills esperadas.

La licencia upstream se conserva en `_licenses/mattpocock-skills-MIT.txt` y cada skill incluye su trazabilidad en `UPSTREAM.md`.
