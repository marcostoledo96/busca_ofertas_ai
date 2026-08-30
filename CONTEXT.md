# Busca Ofertas AI — Lenguaje ubicuo

Este archivo fija el vocabulario del dominio. Define qué significa cada término de negocio y evita que la implementación, la documentación y las issues usen palabras distintas para el mismo concepto.

## Búsquedas y fuentes

**Búsqueda guardada (`SavedSearch`)**:
Definición versionada de qué oportunidades buscar, dónde buscarlas y cómo evaluarlas. Existe independientemente de una ejecución concreta.
_Evitar_: bot, tarea, alerta, consulta cuando se habla de la configuración completa.

**Fuente (`Source`)**:
Lugar externo en el que pueden existir publicaciones, como Facebook Marketplace, Mercado Libre o una tienda.
_Evitar_: plataforma cuando solo se quiere nombrar el origen de datos; scraper.

**Adaptador de fuente (`SourceAdapter`)**:
Implementación reemplazable que traduce las capacidades y respuestas de una fuente al contrato común de Busca Ofertas AI.
_Evitar_: scraper como nombre general del módulo; conector cuando se refiere al contrato completo.

**Collector**:
Estrategia interna usada por un adaptador para obtener datos, por ejemplo GraphQL o Playwright. Más de un collector puede servir a la misma fuente.
_Evitar_: usar collector como sinónimo de adaptador.

## Publicaciones y observaciones

**Publicación (`Listing`)**:
Identidad canónica de una oferta publicada en una fuente. Una publicación puede observarse muchas veces sin convertirse en varias publicaciones.
_Evitar_: producto, resultado, oferta cuando se habla del registro externo canónico.

**Observación (`Observation`)**:
Estado de una publicación en un momento concreto, incluyendo precio, moneda, disponibilidad, título y condición detectados.
_Evitar_: snapshot cuando se habla del concepto de dominio; sobrescribir la publicación para representar cambios.

**Oportunidad (`Opportunity`)**:
Una publicación evaluada respecto de una búsqueda guardada. La misma publicación puede ser oportunidad para una búsqueda y no serlo para otra.
_Evitar_: producto; match como nombre del objeto completo.

## Ejecución

**Ejecución (`Run`)**:
Intento manual de procesar una búsqueda guardada desde el inicio hasta la persistencia y generación de resultados.
_Evitar_: cron, job o sesión cuando se habla de este ciclo de negocio.

**Ejecución de fuente (`SourceRun`)**:
Resultado observable de ejecutar un adaptador concreto dentro de una ejecución, incluyendo estado, métricas, collector y error tipado.
_Evitar_: log de fuente; asumir que una lista vacía representa su estado.

**Cero resultados confirmado (`ZERO_RESULTS_CONFIRMED`)**:
Resultado válido en el que la fuente respondió con un contrato reconocido y no entregó publicaciones. No es equivalente a un fallo, timeout, autenticación requerida o cambio de contrato.
_Evitar_: cero resultados sin evidencia de salud y parseo.

## Precio y evaluación

**Precio resuelto (`ResolvedPrice`)**:
Interpretación trazable de un texto o metadato de precio, con importe, moneda, tipo, confianza y evidencia. Puede permanecer ambiguo.
_Evitar_: precio numérico sin conservar evidencia; asumir que `$` siempre significa ARS.

**Precio ambiguo**:
Precio cuyo importe o moneda no puede establecerse con evidencia suficiente. Debe conservar incertidumbre y nunca convertirse de forma automática.
_Evitar_: precio barato; ARS inferido por defecto.

**Evaluación (`Evaluation`)**:
Resultado explicable de aplicar reglas y, opcionalmente, IA a una oportunidad. Contiene decisión, puntaje, razones y evaluadores utilizados.
_Evitar_: score como nombre del resultado completo.

**Coincidencia (`MATCH`)**:
Decisión que indica que la evidencia disponible satisface la política de la búsqueda con confianza suficiente.
_Evitar_: aprobado como sinónimo general.

**Revisión (`REVIEW`)**:
Decisión que preserva una ambigüedad relevante y requiere análisis adicional o decisión humana.
_Evitar_: error; rechazado provisional.

**Rechazo (`REJECT`)**:
Decisión que indica que una publicación no satisface la búsqueda. Un rechazo duro no puede ser compensado por puntaje ni IA.
_Evitar_: oculto o eliminado.

**Razón (`EvaluationReason`)**:
Explicación estructurada y estable que vincula una decisión con evidencia concreta y un impacto.
_Evitar_: mensaje libre como única representación.

## Operación y evidencia

**Feedback**:
Decisión posterior del usuario sobre una oportunidad revisada. No modifica retroactivamente la observación ni la evaluación original.
_Evitar_: entrenamiento automático.

**Artifact crudo (`RawArtifact`)**:
Evidencia externa sanitizada y de retención limitada que ayuda a diagnosticar un error o revisar una ambigüedad.
_Evitar_: guardar indiscriminadamente HTML, cookies o respuestas completas.

**Intervención manual requerida**:
Estado en el que una fuente necesita una acción explícita del usuario, como restaurar una sesión o resolver un checkpoint.
_Evitar_: fallo silencioso; intento de bypass automático.
