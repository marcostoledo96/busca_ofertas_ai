---
name: boai-codebase-design
description: Diseña interfaces pequeñas y módulos profundos para el monorepo de Busca Ofertas AI. Usar al definir seams, puertos, Adapter SDK, límites entre packages, reemplazabilidad, testabilidad o al revisar acoplamiento arquitectónico.
---

# Diseño de módulos de Busca Ofertas AI

El objetivo es concentrar comportamiento detrás de interfaces pequeñas, estables y comprobables. El núcleo debe recibir alto leverage sin conocer detalles de fuentes, SQLite, terminal o IA.

## Vocabulario

- **Módulo**: unidad con interfaz e implementación.
- **Interfaz**: todo lo que un caller debe conocer, incluidos invariantes, errores, orden, límites y configuración.
- **Seam**: lugar donde puede cambiar una implementación sin modificar al caller.
- **Adapter**: implementación concreta que satisface una interfaz en un seam.
- **Profundidad**: capacidad que obtiene el caller por unidad de interfaz que debe aprender.
- **Localidad**: grado en que cambios y fallos quedan concentrados en un módulo.

## Fuentes de autoridad

Leer la issue, `docs/01_ARCHITECTURE.md`, `docs/03_ADAPTER_SDK.md`, ADR aplicables, `AGENTS.md` raíz y local. Esta skill no puede contradecir esos contratos ni seleccionar la ruta de Gentle AI.

## Principios

1. Interfaces pequeñas; esconder parseo, retries, caches y detalles de librerías.
2. Aceptar dependencias; no crear infraestructura dentro del dominio.
3. Devolver resultados observables; no depender de side effects invisibles.
4. La interfaz pública es también la superficie de test.
5. No exponer seams internos solo para facilitar mocks.
6. Evitar pass-through modules que trasladan complejidad a todos los callers.
7. No agregar un port por anticipación: debe existir variación real, típicamente producción y fake/test o dos collectors.
8. Toda fuente externa se adapta al contrato común; el core no agrega ramas por marketplace.

## Preguntas obligatorias

- ¿Qué complejidad desaparece para el caller gracias a este módulo?
- ¿Qué invariantes y errores forman parte de su interfaz real?
- ¿Puede probarse el comportamiento atravesando solo el entrypoint público?
- ¿La abstracción existe porque algo varía o solo por especulación futura?
- ¿Un cambio de Facebook, SQLite o CLI queda localizado?
- ¿Se está filtrando un tipo de Playwright, driver SQLite o SDK externo?

## Dependencias

Clasificar dependencias con `resources/DEEPENING.md`:

- in-process;
- local sustituible;
- remoto propio;
- externo real.

Seleccionar fake, implementación temporal o adapter según esa categoría, no por costumbre.

## Diseñar alternativas en Antigravity

No usar subagentes paralelos. Cuando una interfaz sea realmente difícil de revertir:

1. escribir las restricciones compartidas;
2. diseñar una alternativa mínima;
3. persistirla en el artifact actual si SDD está activo;
4. releer restricciones y diseñar una alternativa flexible;
5. diseñar una tercera optimizada para el caller común;
6. comparar profundidad, localidad, seam, migración y testabilidad;
7. recomendar una sola opción o híbrido.

Usar `resources/DESIGN-ALTERNATIVES-SEQUENTIALLY.md`.

## Prueba de eliminación

Imaginar que el módulo desaparece. Si la complejidad se distribuye por varios callers, el módulo aporta profundidad. Si desaparece junto con él, probablemente era un wrapper superficial.

## Finalización

- documentar interfaz e invariantes públicas;
- agregar contract/architecture tests cuando aplique;
- comprobar ausencia de deep imports y ciclos;
- no introducir tooling ni dependencias fuera de la issue;
- registrar ADR solo para una decisión permanente y no obvia;
- respetar un writer y una issue por unidad de trabajo.
