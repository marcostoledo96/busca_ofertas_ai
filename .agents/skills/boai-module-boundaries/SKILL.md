---
name: boai-module-boundaries
description: Configura y demuestra límites de importación del monorepo TypeScript de Busca Ofertas AI mediante dependency-cruiser. Usar de forma explícita en BOAI-001 o cuando una issue contractual cambie la topología de packages.
disable-model-invocation: true
---

# Límites de módulos TypeScript de Busca Ofertas AI

Skill explícita para materializar los límites ya definidos por arquitectura. No debe rediseñar packages ni instalar tooling fuera de BOAI-001/BOAI-002 o una issue que lo autorice.

## Precondiciones

1. Leer issue, `AGENTS.md`, `docs/01_ARCHITECTURE.md`, ADR-001/002 y `boai-codebase-design`.
2. Confirmar `pnpm` y Node 22 según el contrato del proyecto.
3. Comprobar si ya existe configuración de dependency-cruiser; fusionar, nunca sobrescribir a ciegas.
4. Verificar que el worktree esté limpio o que los cambios existentes pertenezcan a la misma unidad.
5. Gentle AI debe haber seleccionado la ruta; esta skill no inicia SDD.

## Topología esperada

```text
apps/
  cli/
packages/
  core/
  adapter-sdk/
  configuration/
  rules-engine/
  storage-sqlite/
  report-html/
  exports/
  ai/
adapters/
  synthetic/
  facebook-graphql/
  facebook-playwright/
tests/
```

Cada package expone uno o varios entrypoints en su raíz. Todo subdirectorio del package es implementación privada. Evitar un barrel gigante que reexporte todo.

## Implementación

1. Instalar `dependency-cruiser` como devDependency usando pnpm y conservar lockfile.
2. Adaptar `resources/dependency-cruiser.template.cjs` al `tsconfig` real, sin cambiar `PACKAGES_ROOT = "packages"`.
3. Agregar `lint:boundaries` y conectarlo al quality gate que también ejecuta typecheck.
4. Prohibir:
   - imports externos a internals de `packages/*`;
   - imports entre internals de packages distintos;
   - imports productivos a carpetas de tests/fixtures;
   - ciclos.
5. Agregar layering únicamente cuando la topología efectiva esté implementada y respaldada por la issue; no inventarla desde comentarios del template.
6. No crear un package de ejemplo genérico. Usar los primeros packages reales y el adapter sintético para demostrar el contrato.

## Prueba obligatoria: pass → fail → pass

1. Ejecutar `lint:boundaries` sobre el árbol válido: debe pasar.
2. Introducir temporalmente un deep import controlado en un fixture/test de arquitectura: debe fallar con la regla esperada.
3. Revertir únicamente esa violación temporal.
4. Ejecutar nuevamente: debe pasar.
5. Registrar los tres resultados en la PR.

Si la violación no falla, la configuración no está terminada.

## Límites

- No agregar aliases para esconder imports incorrectos.
- No relajar una regla solo para hacer pasar el código; corregir el seam o documentar la decisión.
- No importar internals desde tests: probar a través de entrypoints.
- No mezclar esta tarea con lógica de Facebook, SQLite o reglas de producto.
- No ejecutar commits, push o merge por autoridad de la skill.

## Finalización

- devDependency y lockfile reproducibles;
- config revisable;
- script dentro del gate;
- pass-fail-pass demostrado;
- documentación de packages enlazada desde `AGENTS.md`;
- ninguna excepción sin justificación contractual.
