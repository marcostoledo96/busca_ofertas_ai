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
