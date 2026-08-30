# 00 — Brief de producto

## Nombre

**Busca Ofertas AI**

## Problema

Revisar manualmente múltiples sitios consume tiempo, produce resultados repetidos y dificulta distinguir una oferta real de un precio engañoso, una publicación irrelevante o una fuente rota.

## Visión

Construir una aplicación local y reutilizable que permita definir búsquedas, consultar distintas fuentes mediante adaptadores, normalizar publicaciones, conservar su historial y presentar oportunidades explicables.

## Usuario inicial

Una única persona técnica que usa Ubuntu y ejecuta el programa manualmente. La arquitectura debe ser comprensible y reutilizable por otros desarrolladores, pero no se implementará multiusuario en el MVP.

## Casos de uso soportados por la visión

- productos usados;
- productos nuevos;
- productos que recuperan stock;
- descuentos y bajas de precio;
- inmuebles;
- vehículos.

El MVP implementa únicamente reglas específicas de productos.

## Primer caso de uso

Buscar Nintendo Switch Lite en Facebook Marketplace dentro de AMBA:

- estado nueva, como nueva o bueno;
- consola funcional obligatoria;
- máximo ARS 250.000;
- precio mínimo plausible todavía no fijado;
- publicaciones explícitas en USD convertibles con una cotización manual;
- moneda ambigua enviada a `REVIEW`;
- desgaste estético permitido inicialmente;
- fallas funcionales rechazadas inicialmente;
- caja y cargador configurables.

## Propuesta de valor

1. Crear o editar una búsqueda sin programar.
2. Ejecutarla manualmente desde una CLI sencilla.
3. Recibir resultados normalizados y clasificados.
4. Entender por qué cada publicación fue aceptada, enviada a revisión o rechazada.
5. Conservar observaciones de precio para detectar cambios posteriores.
6. Diferenciar fallos de fuente de ausencia real de resultados.
7. Agregar nuevas fuentes mediante adaptadores aislados.

## Resultado de evaluación

Cada publicación termina como:

- `MATCH`: cumple los criterios con suficiente evidencia;
- `REVIEW`: existe ambigüedad material;
- `REJECT`: incumple una regla o carece del producto esperado.

Cada decisión incluye puntaje y razones estructuradas.

## Experiencia del MVP

```text
Abrir aplicación
→ elegir o crear búsqueda
→ ejecutar
→ revisar progreso
→ generar HTML + JSON + CSV
→ abrir automáticamente HTML
→ decidir si revisar los casos dudosos
```

## Alcance incluido

- TypeScript;
- ejecución local y manual;
- CLI y launcher de Ubuntu;
- búsquedas guardadas;
- SQLite;
- historial completo de observaciones;
- adaptador sintético;
- adaptador Facebook;
- reglas y evaluación explicable;
- resolución ARS/USD;
- reporte HTML;
- JSON y CSV;
- feedback manual;
- retención de datos crudos configurable;
- tests y CI.

## Fuera del MVP

- Telegram y otras notificaciones;
- cron o daemon;
- servidor remoto;
- backend HTTP;
- frontend hospedado;
- PostgreSQL;
- autenticación multiusuario;
- Mercado Libre;
- watcher de URLs;
- módulos de inmuebles o vehículos;
- análisis de imágenes;
- IA habilitada por defecto;
- contacto o compra automática.

## Métricas de éxito

- se encuentran publicaciones nuevas de forma manual y reproducible;
- no se repiten oportunidades sin motivo;
- no se pierden cambios de precio;
- menos del 10 % de los `MATCH` son falsos positivos en el primer caso de uso;
- un fallo de Facebook nunca se presenta como cero resultados confirmado;
- se puede agregar otro producto sin cambiar código;
- se puede agregar otra fuente implementando el Adapter SDK;
- `$300` sin evidencia nunca se interpreta automáticamente como ARS 300;
- los reportes permiten tomar una decisión sin consultar la base de datos.

## Restricciones

- sin costo fijo de infraestructura;
- datos y sesiones locales;
- ejecución manual;
- licencia MIT;
- no incorporar código AGPL al núcleo MIT;
- no evadir controles de las fuentes.
