# Contribuir a Busca Ofertas AI

## Antes de comenzar

1. Verificá la versión exacta de Gentle AI en `GENTLE_AI.lock.yml`.
2. Leé la issue contractual completa.
3. Leé `CONTEXT.md` si cambia vocabulario o dominio.
4. Leé `AGENTS.md` raíz y el más cercano al módulo.
5. Consultá ADR y documentos normativos relacionados.
6. Verificá si la tarea incorpora código externo y actualizá la trazabilidad.
7. Permití que Gentle AI seleccione la ruta de trabajo.
8. Cargá únicamente las skills locales/globales relevantes.

El workflow completo está en `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`.

## Bootstrap de Antigravity

Después de instalar o actualizar la versión fijada:

```bash
gentle-ai sync
gentle-ai skill-registry refresh
gentle-ai doctor
```

Usá `/sdd-init` cuando Gentle AI aún no haya detectado el proyecto o cambien materialmente stack/testing. No incluyas en Git los archivos generados:

```text
.atl/.skill-registry.cache.json
.atl/skill-registry.md
```

## Flujo de trabajo

- Una rama por issue: `feat/issue-<n>-descripcion`, `fix/issue-<n>-descripcion` o `docs/issue-<n>-descripcion`.
- Una issue es la unidad máxima de trabajo ordinaria.
- Una PR debe resolver una issue principal y declarar cualquier trabajo fuera de alcance.
- No hacer commits directos a `main` una vez finalizado el bootstrap.
- No mezclar refactors generales con una feature salvo necesidad contractual documentada.
- Mantener un writer; verificadores/revisores trabajan en modo read-only.
- Los mensajes de commit no deben incluir atribuciones automáticas a herramientas de IA.

## Routing Gentle AI

Gentle AI puede seleccionar:

- trabajo directo inline para cambios pequeños y mecánicos;
- trabajo directo delegado para implementaciones amplias con contrato claro;
- SDD cuando artifacts durables reduzcan ambigüedad sustancial y el usuario lo acepte.

La orientación del backlog no reemplaza esa decisión dinámica.

### Cuando se use SDD en Antigravity

- una fase por vez;
- guardar el artifact completo antes de avanzar;
- releer el artifact anterior desde filesystem;
- no usar chat como estado;
- Engram solo para decisiones durables verificadas.

### Cuando se use review/RDD

- es opt-in;
- usar exactamente el comando de continuación emitido por Gentle AI;
- no reconstruir comandos ni estados;
- el review no autoriza commit, push, PR o merge;
- si cambian los bytes candidatos, revisar nuevamente.

## Skills locales

Las skills del workspace están en `.agents/skills/` y se registran en `.agents/skills.lock.yml`:

- `boai-domain-modeling` para lenguaje, invariantes y ADR;
- `boai-codebase-design` para interfaces, seams y packages;
- `boai-module-boundaries` para configurar límites TypeScript de forma explícita.

Una skill nunca prevalece sobre la issue, ADR, documentación o `AGENTS.md`.

## Definition of Done

Una issue no está terminada hasta que:

- cumple todos los criterios de aceptación;
- agrega o actualiza tests relevantes;
- no rompe contratos ni tests existentes;
- actualiza documentación y ADR cuando corresponde;
- no introduce secretos ni datos personales reales;
- registra procedencia y licencia del código reutilizado;
- mantiene errores tipados y comportamiento observable;
- registra ruta, skills y artifacts/review cuando apliquen;
- excluye archivos generados del registry;
- deja el árbol de trabajo limpio.

## Calidad

Las herramientas mínimas serán:

- TypeScript estricto;
- formatter y linter;
- límites de imports comprobables;
- tests unitarios, de contrato e integración;
- CI con instalación reproducible;
- auditoría de dependencias;
- fixtures sintéticos o sanitizados.

No se permiten tests unitarios que dependan de Facebook o de Internet en vivo.

## Seguridad y ética de automatización

No incorporar:

- bypass de CAPTCHA o checkpoints;
- rotación de cuentas o proxies para evadir límites;
- mecanismos cuyo objetivo sea ocultar deliberadamente la automatización;
- contacto automático con vendedores;
- compras automáticas;
- almacenamiento de credenciales en el repositorio.

Cuando una fuente requiera intervención humana, el adaptador debe detenerse y devolver un error tipado.
