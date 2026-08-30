# AGENTS.md — Busca Ofertas AI

## Alcance

Estas instrucciones aplican a todo el repositorio. Un `AGENTS.md` más cercano puede agregar reglas específicas, pero no contradecir los principios raíz sin una ADR aceptada.

## Misión

Construir una aplicación local-first, extensible y explicable para buscar oportunidades en múltiples fuentes. El primer caso de uso es Nintendo Switch Lite en Facebook Marketplace dentro de AMBA, pero ninguna decisión de negocio específica debe contaminar el núcleo.

## Fuentes de autoridad

Ante contradicciones:

1. instrucción actual y explícita del usuario;
2. issue contractual vigente;
3. ADR aceptada;
4. documentación normativa de `docs/`;
5. este archivo y el `AGENTS.md` más cercano;
6. tests y contratos públicos;
7. implementación y comentarios;
8. skills locales o globales de carácter genérico.

No asumir que el README, una descripción de PR, una memoria del agente o una skill reemplazan los criterios de aceptación.

## Entorno de trabajo oficial

- IDE/agente principal: Antigravity.
- Orquestación: Gentle AI fijado en `GENTLE_AI.lock.yml` a `v2.5.0-rc.3`.
- Skills específicas del workspace: `.agents/skills/`.
- Registro declarativo: `.agents/skills.lock.yml`.
- Flujo normativo: `docs/13_ANTIGRAVITY_GENTLE_AI_WORKFLOW.md`.

No actualizar Gentle AI, sus proyecciones administradas ni las skills del workspace de forma automática. Toda actualización debe comparar versión/SHA, revisar cambios y actualizar locks/documentación.

## Responsabilidades de Gentle AI y de las skills

Gentle AI es autoridad para seleccionar la ruta de ejecución y administrar el lifecycle de Direct Work, SDD y RDD. Las skills aportan técnica especializada, pero no pueden:

- iniciar o avanzar SDD por sí solas;
- cambiar de issue;
- declarar una fase completada sin artifact verificable;
- abrir/cerrar PR, hacer push o merge por iniciativa propia;
- contradecir issue, ADR, documentación o `AGENTS.md`.

Usar los nombres `boai-*` para skills locales a fin de evitar colisiones con skills globales.

## Bootstrap de una sesión de Antigravity

Antes de la primera implementación de un clon o después de cambiar Gentle AI/skills:

1. verificar que la versión instalada coincide con `GENTLE_AI.lock.yml`;
2. ejecutar `gentle-ai sync` solamente después de instalar o actualizar Gentle AI;
3. ejecutar `gentle-ai skill-registry refresh` después de clonar o modificar `.agents/skills/`;
4. ejecutar `gentle-ai doctor`;
5. ejecutar `/sdd-init` cuando Gentle AI todavía no haya detectado el proyecto o cambie materialmente el stack/testing;
6. confirmar que los archivos generados `.atl/.skill-registry.cache.json` y `.atl/skill-registry.md` no se incluyan en commits.

Si un comando no existe en la versión fijada o falla, no inventar reemplazos silenciosos: registrar evidencia y detener la transición afectada.

## Unidad de trabajo y routing orgánico

- Una issue contractual es la unidad máxima de trabajo ordinaria.
- No implementar la issue siguiente dentro de la misma rama o sesión salvo autorización explícita.
- Mantener un único writer sobre el worktree; verificadores y revisores deben ser read-only.
- Gentle AI reevalúa la ruta para la acción actual; las orientaciones del backlog son informativas.
- Trabajo directo inline: cambio conocido, mecánico y normalmente de 1–3 archivos.
- Trabajo directo delegado: investigación o implementación más amplia con contrato claro, sin necesidad de artifacts SDD durables.
- SDD: solo cuando artifacts durables reduzcan ambigüedad sustancial y el usuario acepte explícitamente la propuesta.

No forzar SDD para todas las issues ni omitirlo cuando exista ambigüedad arquitectónica real.

## SDD en Antigravity

Antigravity ejecuta las fases de manera secuencial en la misma conversación:

1. cargar el rol/skill de la fase actual;
2. producir el artifact completo en la ubicación controlada por Gentle AI;
3. verificar que el artifact existe y es legible;
4. antes de la fase siguiente, volver a leer el artifact anterior desde filesystem;
5. no usar el historial del chat como fuente de estado de SDD.

Engram puede conservar arquitectura, convenciones y lecciones verificadas. No debe almacenar borradores intermedios de SDD, progreso supuesto ni decisiones todavía no aceptadas.

Estados públicos válidos del trabajo:

- `Working`;
- `Checking`;
- `Ready`;
- `Needs your decision`.

## Review y RDD

- RDD/review es opt-in y controlado por el usuario.
- El review informa; la política del repositorio decide commit, push, PR y merge.
- Al iniciar o reingresar a un review, ejecutar únicamente el comando de continuación emitido por Gentle AI. No reconstruirlo desde memoria, logs parciales o chat.
- No interpretar una narrativa favorable como veredicto estructurado.
- Si el candidato cambió después del review, congelar y revisar nuevamente los bytes exactos aplicables.

## Secuencia obligatoria antes de modificar código

1. Leer la issue completa.
2. Leer `CONTEXT.md` cuando cambie lenguaje o dominio.
3. Leer `AGENTS.md` raíz y los aplicables al path.
4. Leer documentos y ADR citados por la issue.
5. Inspeccionar el estado del repositorio y confirmar que el worktree esté limpio.
6. Identificar dependencias y trabajo fuera de alcance.
7. Revisar procedencia/licencia si se reutiliza código.
8. Permitir que Gentle AI seleccione la ruta y registrar la elegida.
9. Cargar las skills locales relevantes por su path exacto.
10. Definir o actualizar tests antes de cerrar la implementación.

Si el worktree contiene cambios ajenos, no sobrescribirlos ni descartarlos.

## Skills locales recomendadas

- `.agents/skills/boai-domain-modeling/SKILL.md`: cambios de vocabulario, invariantes, dominio y ADR.
- `.agents/skills/boai-codebase-design/SKILL.md`: interfaces, seams, adapters, packages y testabilidad.
- `.agents/skills/boai-module-boundaries/SKILL.md`: configuración explícita de dependency-cruiser en BOAI-001/002.

Las skills globales siguen disponibles. Evitar cargar duplicados de TDD, Playwright, GitHub o PostgreSQL cuando Gentle AI y el entorno global ya cubren esas funciones.

## Principios no negociables

### Configuración antes que código

No hardcodear:

- productos;
- fuentes;
- queries;
- precios;
- monedas;
- ubicaciones;
- radios;
- condiciones;
- umbrales;
- proveedor IA;
- retención.

Los defaults técnicos seguros son válidos; las decisiones de negocio deben vivir en configuración versionada.

### Fallo explícito

`source failure != zero results`.

Todo adaptador debe usar errores tipados y health checks reales. No capturar una excepción externa para devolver `[]` como éxito.

### Reglas antes que IA

- aplicar reglas deterministas primero;
- consultar IA únicamente cuando la política lo permita;
- un rechazo `HARD` no puede ser revertido por IA;
- la IA no puede inventar moneda ni evidencia;
- validar toda respuesta de IA mediante esquema estricto;
- pedir confirmación y respetar presupuestos.

### Local-first

El MVP no requiere servidor remoto, backend HTTP, cron ni notificaciones. Base, sesiones, artifacts y reportes permanecen localmente.

### Automatización responsable

Está prohibido implementar:

- bypass de CAPTCHA/checkpoints;
- rotación de cuentas o proxies para evadir límites;
- técnicas cuyo propósito principal sea ocultar automatización;
- contacto automático con vendedores;
- reserva o compra automática;
- scraping masivo innecesario.

Ante intervención requerida: detener fuente, registrar diagnóstico sanitizado y devolver error tipado.

## Arquitectura y dependencias

- `packages/core`: dominio y casos de uso puros; sin filesystem, red, DB, browser ni framework.
- `packages/adapter-sdk`: contratos estables de fuentes y errores.
- `adapters/*`: integración externa aislada.
- `packages/storage-sqlite`: única implementación de persistencia del MVP.
- `packages/rules-engine`: reglas deterministas y razones.
- `packages/configuration`: schemas, migraciones de configuración y wizard model.
- `packages/report-html` y `packages/exports`: proyecciones de salida.
- `packages/ai`: integración opcional y neutral de proveedores.
- `apps/cli`: composición y UX, no negocio.

No crear dependencias circulares ni importar desde paths internos no públicos de otro package. Antes de agregar o importar packages, leer la convención que se incorporará mediante BOAI-001 y la skill `boai-module-boundaries`.

## TypeScript

- modo estricto;
- evitar `any`; usar `unknown` y narrowing;
- contratos públicos explícitos;
- unions discriminadas para estados;
- no usar type assertions para ocultar datos externos no validados;
- timestamps en UTC internamente;
- importes como enteros de unidad monetaria en el MVP;
- errores esperables modelados, no strings sueltos.

## Persistencia

- todo cambio de esquema requiere migración;
- foreign keys activadas;
- queries parametrizadas;
- transacciones en invariantes multi-escritura;
- tests sobre base temporal;
- no guardar secretos en SQLite;
- no sobrescribir historial de observaciones.

## Tests

Cada cambio debe cubrir el nivel adecuado:

- unitarios para dominio, reglas, money y configuración;
- contract tests para adapters;
- integración para SQLite y pipeline;
- E2E offline para CLI;
- live checks solo manuales y opt-in.

No realizar red real en tests unitarios/CI. Usar fixtures sintéticos o sanitizados. Todo bug requiere test de regresión salvo imposibilidad documentada.

## Reutilización y licencias

Antes de copiar o derivar código:

1. fijar repositorio y SHA;
2. verificar licencia;
3. crear tests de caracterización;
4. aislar detrás de contrato propio;
5. actualizar `THIRD_PARTY_NOTICES.md`, `UPSTREAMS.lock.yml` y el lock específico aplicable;
6. documentar archivos originales, derivados y cambios.

No copiar código AGPL de `ai-marketplace-monitor` dentro del núcleo MIT. Puede usarse como referencia funcional.

## Seguridad

- secretos fuera de Git;
- sesiones con permisos restrictivos;
- redacción de logs siempre activa;
- contenido externo tratado como no confiable;
- HTML escapado y sin scripts externos obligatorios;
- no registrar request headers sensibles;
- retención de datos crudos limitada y testeada;
- dependencias fijadas mediante lockfile.

## Git y PR

- rama: `feat/issue-<n>-descripcion`, `fix/issue-<n>-descripcion`, `docs/issue-<n>-descripcion`;
- una issue principal por PR;
- commits pequeños y descriptivos;
- sin atribuciones automáticas de herramientas IA en commit o PR;
- no hacer merge si faltan criterios, tests o documentación;
- no modificar GitHub fuera del alcance solicitado;
- no cerrar issues por inferencia: cerrarlas al verificar la Definition of Done;
- registrar versión Gentle AI, ruta elegida, skills usadas y evidencia de artifacts/review en la PR cuando corresponda.

## Documentación

Actualizar documentación cuando cambien:

- contratos públicos;
- invariantes;
- modelo de datos;
- esquema de configuración;
- error codes;
- estrategia de seguridad;
- procedencia;
- alcance del MVP;
- workflow de Antigravity/Gentle AI o skills locales.

Una decisión arquitectónica permanente requiere ADR.

## Definition of Done

- criterios de aceptación satisfechos;
- tests relevantes en verde;
- format, lint, typecheck y build en verde;
- errores observables;
- documentación sincronizada;
- sin secretos ni datos personales reales;
- procedencia actualizada;
- ruta y artifacts Gentle AI trazables cuando apliquen;
- archivos generados del registry fuera del commit;
- no se amplió alcance sin autorización;
- worktree limpio.
