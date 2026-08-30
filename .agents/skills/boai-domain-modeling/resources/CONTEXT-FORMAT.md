# Formato de `CONTEXT.md`

## Estructura

```md
# Nombre del contexto

Descripción breve del vocabulario cubierto.

## Agrupación natural

**Término (`CodeName`)**:
Definición de una o dos oraciones que explica qué ES.
_Evitar_: sinónimo ambiguo, otro término reservado.
```

## Reglas

- Elegir un término canónico y listar los sinónimos que deben evitarse.
- Definir qué es el concepto, no cómo está implementado.
- Mantener cada definición en una o dos oraciones.
- Incluir únicamente conceptos propios del dominio.
- No incluir frameworks, rutas, tablas, librerías, patrones genéricos ni instrucciones de implementación.
- Agrupar términos cuando existan áreas naturales, sin convertir el archivo en una especificación.
- Validar cada término contra escenarios reales y documentos normativos antes de incorporarlo.

Busca Ofertas AI usa un único `CONTEXT.md` raíz mientras no exista una ADR que divida el dominio en contextos separados.
