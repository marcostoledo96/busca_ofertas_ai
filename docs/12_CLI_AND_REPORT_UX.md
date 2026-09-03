# 12 — UX del CLI y reporte local

## Objetivo

Ofrecer uso diario sencillo sin servidor: iniciar, elegir búsqueda, ejecutar y revisar resultados en un HTML local.

## Entrada

- comando `busca-ofertas`;
- ícono `.desktop` en Ubuntu que abre la aplicación;
- soporte de comandos no interactivos futuro, sin bloquear el wizard.

## Menú principal

```text
BUSCA OFERTAS AI

1. Ejecutar una búsqueda
2. Crear una búsqueda
3. Editar una búsqueda
4. Ver historial
5. Revisar publicaciones dudosas
6. Ver errores de fuentes
7. Configuración
8. Salir
```

La selección debe funcionar con teclado y ofrecer cancelación segura.

## Ejecución

Mostrar etapas, no ruido de bajo nivel:

```text
Nintendo Switch Lite en AMBA

[1/6] Validando configuración
[2/6] Comprobando Facebook Marketplace
[3/6] Recolectando publicaciones
[4/6] Resolviendo precios y aplicando reglas
[5/6] Guardando historial
[6/6] Generando reporte
```

Resumen:

```text
84 recolectadas
63 normalizadas
12 MATCH
9 REVIEW
42 REJECT
1 error de normalización
```

## Cotización manual

Solo se solicita si existe al menos un importe USD explícito y la política lo requiere. Una entrada vacía mantiene esos casos en `REVIEW`.

## Apertura del reporte

El HTML se abre automáticamente al finalizar. Si el sistema no puede abrir navegador, muestra la ruta y no marca el run como fallido.

## Estructura de exports

```text
<directorio-de-datos>/reports/
└── 2026-08-30_19-40-00_switch-lite-amba_<run-id-corto>/
    ├── report.html
    ├── results.json
    └── results.csv
```

## Reporte HTML

### Encabezado

- búsqueda;
- fecha/hora;
- estado global;
- fuentes y collectors;
- cotización manual usada;
- métricas;
- advertencias.

### MATCH

Cards ordenadas por score, novedad y precio efectivo.

### REVIEW

Destacar ambigüedad y acción recomendada.

### REJECT

Todas las rechazadas aparecen en una sección colapsada, con filtros por razón.

### Errores

Mostrar código, explicación y próximo paso. Nunca esconder errores detrás de cero resultados.

## Contenido de una card

- título;
- fuente;
- precio crudo;
- moneda resuelta;
- conversión;
- ubicación;
- condición;
- fecha/publicación;
- novedad;
- score;
- razones;
- imagen opcional;
- enlace externo.

## Seguridad del HTML

- escape estricto;
- sin scripts externos;
- sin HTML crudo de vendedores;
- protocolos permitidos;
- funcional sin Internet salvo imágenes/enlaces remotos;
- no incluir secretos ni paths sensibles innecesarios.

## Revisión manual

Al finalizar:

```text
Hay 9 publicaciones en REVIEW.
¿Querés revisarlas ahora? [Sí / Más tarde / Solo reporte]
```

Acciones:

- marcar relevante;
- descartar;
- marcar falso positivo;
- abrir publicación;
- omitir.

El feedback se persiste y puede producir sugerencias de reglas, nunca cambios automáticos sin confirmación.

## Accesibilidad

- contraste suficiente;
- navegación por teclado;
- labels textuales además de color;
- HTML semántico;
- orden de foco lógico;
- tablas y cards legibles en pantalla angosta;
- mensajes sin depender solo de iconos.

## Sin notificaciones en el MVP

Telegram, email y listeners quedan expresamente fuera. Los resultados se consultan al ejecutar la aplicación.

## Exportaciones JSON y CSV por Run (BOAI-014)

Cada ejecución persistida puede proyectarse a archivos determinísticos e interoperables `results.json` y `results.csv`:

- **Directorio común y privado**: Se guardan en el mismo directorio determinístico de la ejecución (`reports/<timestamp>_<slug>_<sha256>/`) junto a `report.html`, con permisos `0700` para el directorio y `0600` para los archivos.
- **Consistencia de par con falla controlada (Controlled-Failure Pair Consistency)**: Ambos archivos temporales se escriben y validan antes del commit. Si la persistencia falla durante el reemplazo, se restaura la versión anterior intacta o se limpian los archivos parciales. Nunca queda un estado intermedio roto (`results.json` nuevo con `results.csv` viejo).
- **Proyección agnóstica de infraestructura**: El servicio de proyección lee únicamente a través de los ports de repositorios de `@busca-ofertas-ai/core`. Los conceptos aún no persistidos en la base SQLite (como evaluaciones de reglas/IA o novedades) se proyectan honestamente como `null`.
- **Resolución de revisión histórica de búsqueda**: Se selecciona la revisión efectiva de `SavedSearch` cuyo `recordedAt <= run.startedAt`, desempatando por `revisionNumber DESC`. Se valida coherencia estricta (`recordedAt === snapshot.updatedAt`).
- **Paridad semántica JSON / CSV (65 columnas)**: Todas las dimensiones de datos presentes en el JSON tienen su correspondiente columna tipada en el CSV sin pérdida de información factual (incluyendo métricas completas de fuentes, motivos de detención, huella digital cruda, tipo de precio, timestamps de conversión y evaluación).
- **Seguridad contra inyección de fórmulas**: Los textos no confiables con prefijo `=+\-@` (con o sin espacios) se neutralizan anteponiendo `'`. Las columnas numéricas genuinas (como coordenadas negativas de latitud/longitud) se conservan intactas sin comillas.

## Revisión de Casos Dudosos y Feedback Manual (BOAI-015)

Implementación interactiva de la Opción 5 del menú principal (`Revisar publicaciones dudosas`):

### Submenú de revisión
1. **Revisar pendientes por ejecución**: Permite ingresar un `runId` y recorrer secuencialmente las publicaciones en estado `REVIEW` que aún no tienen feedback.
2. **Revisar pendientes por búsqueda guardada**: Permite ingresar un `savedSearchId` y recorrer las publicaciones dudosas pendientes de dicha búsqueda.
3. **Ver historial reciente**: Lista las publicaciones que ya cuentan con decisiones de feedback registradas. Al seleccionar un ítem se despliega el historial cronológico completo de decisiones tomadas y se ofrece la acción **Registrar nueva decisión (re-evaluar)**.
0. **Volver al menú principal**: Salida limpia y cooperativa.

### Presentación de la card y sanitización centralizada
- Formateo claro de datos contextuales: título, precio resuelto, score de reglas/IA, motivos de evaluación y URL canónica.
- **Sanitización terminal integral**: Todo texto no confiable proveniente del scraper o de persistencia (título, `price.rawText`, `location.rawText`, `canonicalUrl`, motivos `EvaluationReason.message` y notas de feedback) se desinfecta mediante `sanitizeTerminalText()`. Esta función elimina tanto secuencias de escape ANSI (`\x1b[...]`) como caracteres de control no imprimibles (ASCII 0-31, 127 y `\r`) para evitar manipulación del cursor, sobreescritura de líneas o inyección de comandos en el emulador de terminal.

### Acciones sobre cada ítem en revisión
- **[1] Marcar relevante (`CONFIRMED_MATCH`)**: Confirma que la publicación coincide con la búsqueda. Solicita notas opcionales (máx. 2000 caracteres) y persiste la decisión.
- **[2] No me interesa (`NOT_INTERESTED`)**: Descarta la oportunidad sin acusar falso positivo de reglas.
- **[3] Marcar falso positivo (`FALSE_POSITIVE`)**: Señala que las reglas o la IA evaluaron incorrectamente el producto.
- **[4] Abrir publicación en navegador**: Invoca el puerto seguro `ExternalUrlOpenerPort`. No altera el estado de revisión y mantiene la card visible.
- **[5] Omitir (siguiente)**: Salta al siguiente ítem dejando la oportunidad pendiente en cola sin escribir registros de feedback.
- **[0] Volver al menú**: Sale de la cola actual de manera limpia.

### Invariante de Dominio: Elegibilidad de Evaluación para Feedback
- `RecordReviewFeedbackUseCase` exige que la evaluación asociada tenga estrictamente `decision === 'REVIEW'`.
- Intentos de registrar feedback sobre evaluaciones `MATCH` o `REJECT` son rechazados con `IneligibleReviewEvaluationError` fail-closed, asegurando exactamente cero escrituras en la base de datos.

### Seguridad en la apertura de URLs externas (`ExternalUrlOpenerPort`)
- Pre-validación contra caracteres de control (`\r`, `\n`, `\t`, `\x00-\x1f`, `\x7f`) antes de la normalización del parser de URL.
- Restricción estricta al protocolo `https:` (rechaza `http:`, `file:`, `javascript:`, `data:`, `ftp:`, etc.).
- Prohibición de credenciales de usuario embebidas (`https://user:pass@host/`).
- Ejecución desacoplada mediante binarios independientes con `shell: false`, `detached: true` y `stdio: 'ignore'`.
- **Protección contra command injection en Windows**: Se utiliza `rundll32.exe url.dll,FileProtocolHandler <url>` pasando la URL como argumento de datos directo. Se descarta terminantemente `cmd.exe /c start` para evitar que caracteres válidos en URLs HTTPS (`&`, `|`, `^`, `<`, `>`, `%`) sean reinterpretados como sintaxis de shell por un procesador de comandos.

### Composición y Persistencia Real en SQLite
- `apps/cli/src/composition-root.ts` es el único punto de composición autorizado dentro de `apps/cli` para importar `@busca-ofertas-ai/storage-sqlite` (reglado por `dependency-cruiser`).
- En el arranque productivo, inicializa la base SQLite en la ruta canónica XDG, ejecuta migraciones automáticas (`db.migrate()`), instancia repositorios reales e inyecta `ReviewQueueService` y `RecordReviewFeedbackUseCase`.
- Se eliminaron todos los repositorios fallback en memoria simulados: la persistencia es real, obligatoria y respaldada en disco con cierre de conexión ordenado (`signalManager.registerCleanup`).

### Estado del Prompt Post-Run ("¿Desea revisar las N publicaciones dudosas ahora?")
- El componente `PostRunReviewCoordinator` se encuentra completamente implementado y testeado en `@busca-ofertas-ai/core` para evaluar ítems y coordinar la decisión de revisión interactiva inmediata.
- **Dependencia de backlog**: El disparador interactivo post-búsqueda requiere la ejecución real del pipeline de búsqueda (Opción 1 del menú, "Ejecutar búsqueda guardada"), la cual se encuentra deliberadamente postergada en el backlog (`NotImplementedActionHandler`, issues futuras BOAI-017 / BOAI-023).
- BOAI-015 no simula una ejecución artificial ni anticipa el pipeline de scraping fuera de alcance. La integración queda lista en el núcleo y documentada para conectarse en cuanto la Opción 1 sea implementada.

### Soporte de decisiones contradictorias (Re-review)
- Si el usuario reconsidera una decisión (ej. marcó inicialmente `CONFIRMED_MATCH` y luego descubre que era un accesorio marcando `FALSE_POSITIVE`), el sistema registra la nueva decisión en la tabla `feedback` sin sobrescribir ni eliminar la anterior.
- Ambas decisiones sobreviven como historial auditable ordenado cronológicamente.
- La oportunidad permanece en el historial y no vuelve a la cola de pendientes.
- La tabla `feedback` está protegida contra modificaciones y eliminaciones accidentales mediante triggers `BEFORE UPDATE` y `BEFORE DELETE` en SQLite.

### Sugerencias conservadoras de reglas (`detectRuleSuggestions`)
- Algoritmo determinista sin IA que detecta patrones a partir de un umbral de 3 decisiones idénticas sobre el mismo motivo de evaluación (`EvaluationReason.code`) dentro de la misma búsqueda.
- En BOAI-015, todas las sugerencias son estrictamente informativas y consultivas (`applicable: false`), garantizando cero mutaciones automáticas sobre la configuración de búsquedas.

### Privacidad y almacenamiento local-first
- Todas las decisiones de feedback se almacenan de manera local y privada en la base de datos SQLite (`storage-sqlite`).
- Queda prohibido transmitir o persistir decisiones o datos de feedback en sistemas de memoria externa de IA o herramientas de agente (Gentle AI / Engram).
