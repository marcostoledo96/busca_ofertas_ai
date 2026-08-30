# AGENTS.md — `adapters`

## Responsabilidad

Aislar integraciones externas detrás del Adapter SDK.

## Reglas comunes

- un directorio por fuente/estrategia;
- collector y normalizer separados;
- validar payload externo desde `unknown`;
- respetar timeout, deadline y cancelación;
- retry solo para errores retryable;
- límites de páginas e items;
- diagnostics sanitizados;
- no persistir directamente;
- no clasificar oportunidades;
- no incorporar lógica exclusiva de Switch al adapter Facebook;
- fixtures offline obligatorios;
- health check real;
- cero resultados solo con contrato válido;
- no técnicas de evasión ni bypass de CAPTCHA.

## Procedencia

Todo adapter derivado de upstream debe incluir un archivo `PROVENANCE.md` con SHA, licencia, archivos originales y cambios.

## Contract tests

Cada adapter debe ejecutar la suite común y sus casos específicos.
