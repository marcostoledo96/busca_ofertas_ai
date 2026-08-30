# Profundizar módulos

## Categorías de dependencia

### 1. In-process

Cálculo puro o estado en memoria. Probar directamente a través de la interfaz pública; no crear un adapter artificial.

### 2. Local sustituible

Dependencia local con reemplazo seguro de test. En este proyecto: SQLite temporal, filesystem temporal, reloj y generador de IDs. Mantener el seam interno salvo que callers reales necesiten variación.

### 3. Remoto propio

Servicio controlado por el mismo producto a través de red. No existe en el MVP local-first; si aparece, requiere revisar la arquitectura y probablemente una ADR.

### 4. Externo real

Facebook, Mercado Libre, tiendas, DeepSeek y cualquier servicio no controlado. El módulo recibe un port pequeño; producción usa el adapter real y tests usan un fake determinista.

## Disciplina de seams

- Un adapter real más un fake de contrato justifican un seam comprobable.
- Los seams internos no deben filtrarse a la interfaz pública.
- El Adapter SDK separa capacidades comunes de detalles del collector.
- Los errores externos se traducen a códigos propios antes de salir del adapter.

## Tests

- Probar resultados observables a través de entrypoints públicos.
- Los contract tests pueden reutilizarse entre adapters.
- No importar internals para evitar escribir un test incómodo.
- El test debe sobrevivir a un refactor interno que preserve el contrato.
