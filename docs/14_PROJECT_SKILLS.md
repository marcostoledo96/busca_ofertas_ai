# 14 — Skills locales del proyecto

## Objetivo

Registrar qué skills del catálogo `skills.sh` se incorporan al workspace de Antigravity, cuáles se posponen y por qué. La meta no es acumular prompts: es cubrir huecos reales sin duplicar Gentle AI ni las skills globales del usuario.

## Ruta de instalación

Antigravity descubre skills del workspace en:

```text
.agents/skills/<skill>/SKILL.md
```

Las skills se versionan directamente en el repositorio. Esto evita depender de una descarga mutable durante cada clon y permite revisar diffs, licencia y adaptaciones.

## Fuente fijada

```text
Catálogo: https://skills.sh/mattpocock/skills
Repositorio: https://github.com/mattpocock/skills
SHA: 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76
Licencia: MIT
```

La licencia se conserva en `.agents/skills/_licenses/mattpocock-skills-MIT.txt`.

## Skills activas

### `boai-domain-modeling`

**Origen:** `domain-modeling`.

**Por qué sirve:** el proyecto depende de distinguir con precisión `Listing`, `Observation`, `Opportunity`, `Run`, `SourceRun`, precio resuelto y moneda ambigua. También necesita mantener `CONTEXT.md` y ADR sin mezclar implementación.

**Adaptaciones:**

- prefijo `boai-` para evitar colisión global;
- español y ejemplos del dominio;
- ADR en `docs/decisions/`;
- autoridad de issue/ADR/docs;
- integración con SDD secuencial;
- sin autoridad de routing o delivery.

### `boai-codebase-design`

**Origen:** `codebase-design`.

**Por qué sirve:** el núcleo depende de módulos profundos, seams pequeños y adapters que oculten Facebook, SQLite y proveedores IA.

**Adaptaciones:**

- topología real del monorepo;
- relación con Adapter SDK;
- proceso de alternativas secuencial;
- eliminación del patrón upstream de 3+ subagentes paralelos, incompatible con el modelo de Antigravity usado por Gentle AI;
- sin creación automática de ADR/PR.

### `boai-module-boundaries`

**Origen:** `setup-ts-deep-modules`.

**Por qué sirve:** BOAI-001 exige impedir deep imports y ciclos mediante gates comprobables.

**Riesgo:** la skill upstream está en `skills/in-progress`; por eso no se usa sin adaptación ni se permite auto-invocación.

**Adaptaciones:**

- explicit-only;
- `PACKAGES_ROOT = "packages"`;
- topología BOAI;
- sin package de ejemplo artificial;
- prueba pass → fail → pass obligatoria;
- cambios limitados a issues que autoricen tooling de arquitectura.

## Skills revisadas y pospuestas

| Candidata | Decisión | Motivo |
|---|---|---|
| `antfu/skills/vitest` | Posponer | La versión publicada está orientada a Vitest 5 beta; BOAI-001 todavía debe seleccionar y fijar versión real |
| pnpm | No incorporar ahora | El bootstrap es acotado y no necesita otra capa de instrucciones; una entrada revisada presentó advertencia de seguridad |
| Zod | Posponer | La librería de schema runtime todavía no está elegida por BOAI-001/004 |
| scraper-builder | No incorporar | Se superpone con el adapter Playwright condicional y puede contaminar el contrato genérico |
| Turborepo/Nx/tsdown | No incorporar | Imponen tooling que la arquitectura aún no decidió y no es necesario para el MVP |

## Duplicados evitados deliberadamente

No se descargan skills locales adicionales para:

- TDD;
- code review;
- planificación/to-spec/to-issues;
- GitHub;
- Playwright;
- PostgreSQL.

Gentle AI, Antigravity y las skills globales ya cubren esos roles. Duplicarlos aumenta conflictos de routing y contexto sin mejorar el resultado.

## Precedencia

1. instrucción actual del usuario;
2. issue contractual;
3. ADR y docs normativas;
4. `AGENTS.md` raíz/local;
5. Gentle AI para routing/lifecycle;
6. skill local `boai-*`;
7. skill global.

Una skill local especializada prevalece sobre una global equivalente solo en su técnica, nunca sobre el contrato de producto ni sobre Gentle AI.

## Verificación después de clonar

```bash
gentle-ai skill-registry refresh
gentle-ai doctor
```

Comprobar que aparecen exactamente:

```text
boai-domain-modeling
boai-codebase-design
boai-module-boundaries
```

No versionar el registry generado en `.atl/`.

## Actualización segura

- no seguir `main` de forma automática;
- fijar un SHA nuevo;
- revisar changelog/diff/licencia;
- comparar los archivos base;
- reaplicar adaptaciones;
- verificar frontmatter y referencias relativas;
- actualizar `.agents/skills.lock.yml`, `UPSTREAMS.lock.yml` y notices;
- refrescar el registry;
- probar activación y ausencia de colisiones.

## Criterio para sumar una skill futura

Solo incorporar una skill si:

1. existe un hueco técnico repetido;
2. no lo cubren Gentle AI, una skill global o los documentos del repo;
3. su licencia permite versionarla;
4. su contenido fue revisado manualmente;
5. puede fijarse a SHA;
6. no altera routing, delivery o seguridad;
7. reduce más contexto/errores del que agrega.
