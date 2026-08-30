# AGENTS.md — Skills locales

## Alcance

Aplica a `.agents/skills/**`.

## Reglas

- Una skill local complementa el repositorio; no reemplaza issue, ADR, docs, `AGENTS.md` ni Gentle AI.
- Usar prefijo `boai-` para evitar colisiones globales.
- Mantener frontmatter válido con `name` y `description` precisos.
- Skills que instalan dependencias o modifican tooling deben ser `disable-model-invocation: true` y requerir invocación explícita.
- No incluir credenciales, comandos destructivos, bypass de seguridad ni delivery automático.
- No incorporar patrones de subagentes paralelos incompatibles con Antigravity; usar artifacts secuenciales.
- Toda copia/adaptación requiere `UPSTREAM.md`, licencia, SHA y entrada en `.agents/skills.lock.yml`.
- No seguir branches mutables: fijar SHA.
- Después de modificar skills, actualizar locks/notices y ejecutar `gentle-ai skill-registry refresh` más `gentle-ai doctor`.
- No versionar `.atl/.skill-registry.cache.json` ni `.atl/skill-registry.md`.

## Verificación

- paths relativos existentes;
- frontmatter y nombre de carpeta coherentes;
- ausencia de referencias a herramientas no elegidas;
- ausencia de contradicciones con `GENTLE_AI.lock.yml`;
- activación esperada y sin colisión con skills globales;
- diff de procedencia revisable.
