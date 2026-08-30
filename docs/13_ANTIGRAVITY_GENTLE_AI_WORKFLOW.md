# 13 — Workflow de Antigravity + Gentle AI

## Objetivo

Definir un proceso reproducible para implementar las issues de Busca Ofertas AI con Antigravity sin confundir conversación, memoria, artifacts, review y delivery.

## Versión fijada

El proyecto usa:

```text
Gentle AI v2.5.0-rc.3
commit 8e5c79b08c14b5ecded4a449e7d21cd526f52e94
```

Es una prerelease fijada deliberadamente. `GENTLE_AI.lock.yml` es la fuente de verdad. No actualizar automáticamente ni asumir compatibilidad con una release posterior.

Gentle AI no se vendorea en el repositorio. El usuario lo instala en su entorno; el proyecto versiona únicamente el contrato esperado y las skills locales.

## Bootstrap inicial

En un clon nuevo o después de cambiar la versión:

```bash
gentle-ai sync
gentle-ai skill-registry refresh
gentle-ai doctor
```

Luego, dentro de Antigravity, ejecutar `/sdd-init` cuando el proyecto todavía no esté detectado o cuando cambien materialmente stack y testing.

### Cuándo repetir cada comando

| Acción | Cuándo |
|---|---|
| `gentle-ai sync` | Después de instalar/actualizar Gentle AI o cuando sus proyecciones administradas estén desactualizadas |
| `gentle-ai skill-registry refresh` | Primer clon, alta/baja/cambio de skills locales o globales |
| `gentle-ai doctor` | Primer bootstrap, después de cambios de tooling o ante comportamiento anómalo |
| `/sdd-init` | Detección inicial del proyecto o cambio material del stack/testing |

No ejecutar `sync` como mutación rutinaria dentro de cada issue.

## Archivos generados

Estos archivos del registry son locales y no forman parte del producto:

```text
.atl/.skill-registry.cache.json
.atl/skill-registry.md
```

Deben permanecer fuera de commits, PR, formatting y revisiones de producto. Las skills contractuales sí se versionan en `.agents/skills/`.

## Unidad de trabajo

Una issue contractual es la unidad máxima de una sesión ordinaria:

```text
leer issue
→ recuperar contexto
→ seleccionar ruta
→ implementar
→ verificar
→ revisar si está habilitado
→ preparar PR
→ detenerse
```

No avanzar a la siguiente issue ni mezclar backlog futuro. Las excepciones necesitan autorización explícita y deben conservar trazabilidad separada.

## Routing orgánico

Gentle AI selecciona la ruta para la acción actual.

### Trabajo directo inline

Usar normalmente cuando:

- el cambio está completamente identificado;
- afecta aproximadamente 1–3 archivos;
- es mecánico o editorial;
- no necesita investigación antes de escribir.

### Trabajo directo delegado

Usar normalmente cuando:

- el contrato ya es claro;
- hay investigación o cambios en varios archivos;
- se necesita separar writer y verificación;
- artifacts SDD durables no agregarían valor proporcional.

### SDD opcional

Considerar cuando:

- existe ambigüedad sustancial de producto o arquitectura;
- se comparan alternativas difíciles de revertir;
- hay múltiples contratos o migraciones coordinadas;
- persistir propuesta/especificación/diseño reduce riesgo real.

SDD requiere propuesta y aceptación explícita del usuario. El hecho de que una issue sea grande no lo vuelve automático.

Las orientaciones del backlog son señales iniciales, no rutas preasignadas.

## Modelo secuencial de Antigravity para SDD

Antigravity no debe simular ejecución paralela de fases. El flujo es una máquina de estados basada en artifacts:

1. cargar el rol y skill de la fase actual;
2. leer issue, documentos y artifact anterior;
3. producir un artifact completo;
4. guardarlo físicamente antes de declarar la fase lista;
5. verificar que sea legible y consistente;
6. iniciar la siguiente fase releyendo el artifact desde filesystem;
7. no depender de memoria de chat.

### Estado y Engram

Engram puede guardar:

- decisiones arquitectónicas aceptadas;
- convenciones del repositorio;
- patrones y bugfixes verificados;
- hechos durables útiles entre sesiones.

No debe guardar:

- borradores de propuesta/especificación/diseño;
- estado intermedio de una fase;
- checklist supuestamente completado sin evidencia;
- comandos de continuación temporales;
- veredictos no estructurados.

## Un writer y verificación separada

- Un único writer modifica el worktree.
- Exploración, tests, revisión y auditoría pueden delegarse, pero son read-only respecto del mismo árbol.
- El writer integra cambios; los verificadores reportan evidencia.
- No permitir que dos agentes editen los mismos archivos en paralelo.

## Estados públicos

Gentle AI comunica únicamente estados verificables:

- `Working`: ejecutando trabajo;
- `Checking`: verificando artifacts, código o tests;
- `Ready`: unidad lista para la siguiente decisión humana/repositorio;
- `Needs your decision`: existe una bifurcación o autorización pendiente.

No usar “completado” cuando falta commit, PR, review o un gate contractual.

## Review y RDD

RDD es opcional y propiedad del usuario. Cuando está activo:

1. congelar los bytes candidatos y su identidad;
2. iniciar review mediante Gentle AI;
3. conservar el contrato estructurado del proveedor;
4. al reingresar, ejecutar solo el comando de continuación publicado por Gentle AI;
5. no reconstruir comandos ni estados desde narrativa;
6. si cambian los bytes, invalidar/repetir review según corresponda.

Un review favorable es evidencia, no permiso de delivery. `AGENTS.md`, la issue y la política de GitHub siguen controlando commit, push, PR, cierre y merge.

## Skills del proyecto

| Trabajo | Skill local |
|---|---|
| Dominio, vocabulario, invariantes, ADR | `.agents/skills/boai-domain-modeling/SKILL.md` |
| Interfaces, seams, adapters, packages | `.agents/skills/boai-codebase-design/SKILL.md` |
| Dependency-cruiser y límites de import | `.agents/skills/boai-module-boundaries/SKILL.md` |

Cargar paths exactos. No asumir que una skill global de igual nombre contiene las adaptaciones de Busca Ofertas AI.

## Evidencia mínima por PR

Toda PR implementativa debe registrar:

- issue e ID `BOAI-NNN`;
- versión Gentle AI efectiva;
- ruta elegida y motivo breve;
- skills locales usadas;
- artifacts SDD, si existieron;
- estado de RDD/review, si estuvo habilitado;
- comandos de verificación y resultados;
- procedencia de código reutilizado;
- riesgos y rollback;
- confirmación de que registry generado y secretos quedaron fuera.

## Flujo recomendado para iniciar BOAI-001

1. Clonar y verificar `main` limpio.
2. Instalar/verificar Gentle AI `v2.5.0-rc.3`.
3. Ejecutar sync, refresh y doctor según bootstrap.
4. Leer issue #2, `AGENTS.md`, ADR-001/002, arquitectura y skills locales.
5. Dejar que Gentle AI elija ruta; se espera trabajo delegado directo salvo ambigüedad nueva.
6. Usar `boai-codebase-design` y, de forma explícita, `boai-module-boundaries`.
7. Implementar workspace y demostrar límites pass → fail → pass.
8. Ejecutar gates.
9. Crear PR vinculada a #2 sin cerrar la issue hasta cumplir todos sus criterios.

## Actualización del workflow

Cambiar la versión fijada, el modelo secuencial, la autoridad de routing o la política de skills requiere revisar ADR-009/010 y crear una ADR superseding si cambia la decisión.
