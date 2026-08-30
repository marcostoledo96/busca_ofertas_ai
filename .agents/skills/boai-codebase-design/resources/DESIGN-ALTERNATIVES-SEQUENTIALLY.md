# Diseñar alternativas secuencialmente en Antigravity

Este proyecto no usa el patrón upstream de subagentes paralelos. Las alternativas se elaboran una por una para preservar contexto y compatibilidad con Gentle AI.

## 1. Fijar el problema

Registrar:

- resultado requerido;
- invariantes;
- dependencias y categoría;
- errores esperables;
- callers principales;
- restricciones de la issue y ADR.

## 2. Alternativa mínima

Diseñar una interfaz de 1 a 3 entrypoints que maximice profundidad y esconda detalles. No elegirla todavía.

## 3. Persistir y releer

Si hay un SDD aceptado, guardar la alternativa en el artifact de diseño controlado por Gentle AI. Antes de continuar, releer ese artifact y la lista de restricciones. En trabajo directo, mantener el análisis acotado en la evidencia de la issue o PR.

## 4. Alternativa flexible

Diseñar una opción que priorice extensibilidad y variaciones reales, sin especular con fuentes o casos aún inexistentes.

## 5. Alternativa para el caller común

Diseñar una opción cuya operación normal sea trivial y cuyos casos avanzados no contaminen el camino principal.

## 6. Comparar

Para cada opción evaluar:

- profundidad;
- localidad;
- tamaño de interfaz;
- seam placement;
- errores visibles;
- testabilidad;
- migración;
- compatibilidad con el Adapter SDK.

## 7. Elegir

Recomendar una opción o híbrido y explicar qué alternativas se descartan. Si la decisión es difícil de revertir y no obvia, registrar ADR dentro del alcance de la issue.
