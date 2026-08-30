# Contribuir a Busca Ofertas AI

## Antes de comenzar

1. Leé `AGENTS.md` y el `AGENTS.md` más cercano al módulo que vas a modificar.
2. Leé la issue contractual completa.
3. Consultá las ADR y documentos normativos relacionados.
4. Verificá si la tarea incorpora código externo y actualizá la trazabilidad correspondiente.

## Flujo de trabajo

- Una rama por issue: `feat/issue-<n>-descripcion`, `fix/issue-<n>-descripcion` o `docs/issue-<n>-descripcion`.
- Una PR debe resolver una issue principal y declarar explícitamente cualquier trabajo fuera de alcance.
- No hacer commits directos a `main` una vez finalizado el bootstrap.
- No mezclar refactors generales con una feature salvo necesidad contractual documentada.
- Los mensajes de commit no deben incluir atribuciones automáticas a herramientas de IA.

## Definition of Done

Una issue no está terminada hasta que:

- cumple todos los criterios de aceptación;
- agrega o actualiza tests relevantes;
- no rompe contratos ni tests existentes;
- actualiza documentación y ADR cuando corresponde;
- no introduce secretos ni datos personales reales;
- registra procedencia y licencia del código reutilizado;
- mantiene errores tipados y comportamiento observable;
- deja el árbol de trabajo limpio.

## Calidad

Las futuras herramientas mínimas serán:

- TypeScript estricto;
- formatter y linter;
- tests unitarios, de contrato e integración;
- CI con instalación reproducible;
- auditoría de dependencias;
- fixtures sintéticos o sanitizados.

No se permiten tests unitarios que dependan de Facebook o de Internet en vivo.

## Seguridad y ética de automatización

No incorporar:

- bypass de CAPTCHA o checkpoints;
- rotación de cuentas o proxies para evadir límites;
- mecanismos cuyo objetivo sea ocultar deliberadamente la automatización;
- contacto automático con vendedores;
- compras automáticas;
- almacenamiento de credenciales en el repositorio.

Cuando una fuente requiera intervención humana, el adaptador debe detenerse y devolver un error tipado.
