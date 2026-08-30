# AGENTS.md — Busca Ofertas AI

## Alcance

Estas instrucciones aplican a todo el repositorio. Un `AGENTS.md` más cercano puede agregar reglas específicas, pero no contradecir los principios raíz sin una ADR aceptada.

## Misión

Construir una aplicación local-first, extensible y explicable para buscar oportunidades en múltiples fuentes. El primer caso de uso es Nintendo Switch Lite en Facebook Marketplace dentro de AMBA, pero ninguna decisión de negocio específica debe contaminar el núcleo.

## Fuentes de autoridad

Ante contradicciones:

1. issue contractual vigente;
2. ADR aceptada;
3. documentación normativa de `docs/`;
4. este archivo y el `AGENTS.md` más cercano;
5. tests y contratos públicos;
6. implementación y comentarios.

No asumir que el README o una descripción de PR reemplazan los criterios de aceptación.

## Secuencia obligatoria antes de modificar código

1. Leer la issue completa.
2. Leer `AGENTS.md` raíz y los aplicables al path.
3. Leer documentos y ADR citados por la issue.
4. Inspeccionar el estado del repositorio y confirmar que el worktree esté limpio.
5. Identificar dependencias y trabajo fuera de alcance.
6. Revisar procedencia/licencia si se reutiliza código.
7. Definir o actualizar tests antes de cerrar la implementación.

Si el worktree contiene cambios ajenos, no sobrescribirlos ni descartarlos.

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

No crear dependencias circulares ni importar desde paths internos no públicos de otro paquete.

## TypeScript

- modo estricto;
- evitar `any`; usar `unknown` y narrowing;
- contratos públicos explícitos;
- enums discriminados o unions para estados;
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

No realizar red real en tests unitarios/CI. Usar fixtures sintéticos o sanitizados.

Todo bug requiere test de regresión salvo imposibilidad documentada.

## Reutilización y licencias

Antes de copiar o derivar código:

1. fijar repositorio y SHA;
2. verificar licencia;
3. crear tests de caracterización;
4. aislar detrás de contrato propio;
5. actualizar `THIRD_PARTY_NOTICES.md` y `UPSTREAMS.lock.yml`;
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
- no cerrar issues por inferencia: cerrarlas al verificar la Definition of Done.

## Documentación

Actualizar documentación cuando cambien:

- contratos públicos;
- invariantes;
- modelo de datos;
- esquema de configuración;
- error codes;
- estrategia de seguridad;
- procedencia;
- alcance del MVP.

Una decisión arquitectónica permanente requiere ADR.

## Definition of Done

- criterios de aceptación satisfechos;
- tests relevantes en verde;
- format, lint, typecheck y build en verde;
- errores observables;
- documentación sincronizada;
- sin secretos ni datos personales reales;
- procedencia actualizada;
- no se amplió alcance sin autorización;
- worktree limpio.
