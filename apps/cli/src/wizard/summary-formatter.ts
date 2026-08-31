import type { SavedSearchConfigurationV1 } from '@busca-ofertas-ai/configuration';
import { sanitizeString, sanitizeDiagnosticData } from '../runtime/diagnostics.js';

/**
 * Formats a clean, user-friendly summary of a SavedSearchConfigurationV1.
 * Defense-in-depth: All configurable strings and structured data are sanitized to prevent secret leaks.
 */
export function formatSearchSummary(config: SavedSearchConfigurationV1): string {
  const lines: string[] = [];

  lines.push('------------------------------------------------------------');
  lines.push(`ID:          ${sanitizeString(config.id)}`);
  lines.push(`Nombre:      ${sanitizeString(config.name)}`);
  lines.push(`Categoría:   ${sanitizeString(config.category)}`);
  lines.push(`Estado:      ${config.enabled ? 'Habilitada (true)' : 'Deshabilitada (false)'}`);

  // Fuentes
  lines.push('\nFuentes configuradas:');
  for (const source of config.sources) {
    const statusStr = source.enabled ? 'habilitada' : 'deshabilitada';
    lines.push(`  - [${sanitizeString(source.id)}] (${statusStr})`);
    if (source.queries && source.queries.length > 0) {
      lines.push(
        `    Queries (${source.queries.length}): ${source.queries.map((q) => `"${sanitizeString(q)}"`).join(', ')}`,
      );
    } else {
      lines.push('    Queries: (ninguna / búsqueda no textual)');
    }
    if (source.sessionRef) {
      lines.push(`    Sesión: ${sanitizeString(source.sessionRef)}`);
    }
    if (source.options && Object.keys(source.options).length > 0) {
      const sanitizedOptions = sanitizeDiagnosticData(source.options);
      lines.push(`    Opciones: ${JSON.stringify(sanitizedOptions)}`);
    }
  }

  // Ubicación
  if (config.location) {
    lines.push('\nUbicación:');
    lines.push(`  Modo: ${sanitizeString(config.location.mode)}`);
    if (config.location.region) lines.push(`  Región: ${sanitizeString(config.location.region)}`);
    if (config.location.radiusKm !== undefined)
      lines.push(`  Radio: ${config.location.radiusKm} km`);
    if (config.location.coordinates) {
      lines.push(
        `  Coordenadas: Lat ${config.location.coordinates.latitude}, Lon ${config.location.coordinates.longitude}`,
      );
    }
  }

  // Precios
  if (config.price) {
    lines.push('\nPrecios y monedas:');
    lines.push(`  Moneda objetivo: ${sanitizeString(config.price.targetCurrency)}`);
    if (config.price.maximum !== undefined && config.price.maximum !== null) {
      lines.push(
        `  Precio máximo:   ${config.price.maximum} ${sanitizeString(config.price.targetCurrency)}`,
      );
    }
    if (config.price.minimumPlausible !== undefined && config.price.minimumPlausible !== null) {
      lines.push(
        `  Mínimo verosímil: ${config.price.minimumPlausible} ${sanitizeString(config.price.targetCurrency)}`,
      );
    }
    if (config.price.foreignCurrency) {
      lines.push(
        `  Moneda extranjera: modo=${sanitizeString(config.price.foreignCurrency.mode)}, ante desconocida=${sanitizeString(config.price.foreignCurrency.onUnknown)}`,
      );
    }
  }

  // Condición
  if (config.condition && config.condition.accepted.length > 0) {
    lines.push(
      `\nCondiciones aceptadas: ${config.condition.accepted.map((c) => sanitizeString(c)).join(', ')}`,
    );
  }

  // Producto
  if (config.product) {
    lines.push('\nFiltros de producto:');
    if (config.product.expectedModels && config.product.expectedModels.length > 0) {
      lines.push(
        `  Modelos esperados: ${config.product.expectedModels.map((m) => sanitizeString(m)).join(', ')}`,
      );
    }
    if (config.product.requireFunctional !== undefined) {
      lines.push(`  Requiere funcional: ${config.product.requireFunctional ? 'Sí' : 'No'}`);
    }
    if (config.product.chargerRequired !== undefined) {
      lines.push(`  Requiere cargador:  ${config.product.chargerRequired ? 'Sí' : 'No'}`);
    }
    if (config.product.boxRequired !== undefined) {
      lines.push(`  Requiere caja:      ${config.product.boxRequired ? 'Sí' : 'No'}`);
    }
  }

  // Reglas
  if (config.rules) {
    lines.push('\nReglas deterministas:');
    if (config.rules.profile) lines.push(`  Perfil: ${sanitizeString(config.rules.profile)}`);
    if (config.rules.include && config.rules.include.length > 0) {
      lines.push(
        `  Incluir: ${config.rules.include.map((i) => `"${sanitizeString(i)}"`).join(', ')}`,
      );
    }
    if (config.rules.exclude && config.rules.exclude.length > 0) {
      lines.push(
        `  Excluir: ${config.rules.exclude.map((e) => `"${sanitizeString(e)}"`).join(', ')}`,
      );
    }
  }

  // Evaluación
  lines.push('\nEvaluación y umbrales:');
  lines.push(`  Match threshold:  ${config.evaluation.matchThreshold}`);
  lines.push(`  Review threshold: ${config.evaluation.reviewThreshold}`);
  if (config.evaluation.precisionProfile) {
    lines.push(`  Perfil precisión: ${sanitizeString(config.evaluation.precisionProfile)}`);
  }

  // IA
  lines.push('\nInteligencia Artificial:');
  lines.push(`  Habilitada:           ${config.ai.enabled ? 'Sí' : 'No'}`);
  lines.push(`  Solo evaluar review:  ${config.ai.evaluateOnlyReview ? 'Sí' : 'No'}`);
  lines.push(`  Pedir confirmación:   ${config.ai.requireConfirmation ? 'Sí' : 'No'}`);
  lines.push(`  Máx evaluaciones/run: ${config.ai.maxEvaluationsPerRun}`);
  if (config.ai.provider)
    lines.push(`  Proveedor:            ${sanitizeString(config.ai.provider)}`);

  // Retención
  lines.push('\nRetención de datos:');
  lines.push(`  Artefactos crudos: ${sanitizeString(config.retention.rawArtifacts)}`);
  lines.push(`  Días de datos:     ${config.retention.rawDataDays}`);

  // Reporte
  if (config.report) {
    lines.push('\nReportes:');
    if (config.report.openAutomatically !== undefined) {
      lines.push(`  Abrir automáticamente: ${config.report.openAutomatically ? 'Sí' : 'No'}`);
    }
    if (config.report.includeRejected) {
      lines.push(`  Rechazadas en reporte: ${sanitizeString(config.report.includeRejected)}`);
    }
    if (config.report.exports && config.report.exports.length > 0) {
      lines.push(
        `  Formatos de export:    ${config.report.exports.map((exp) => sanitizeString(exp)).join(', ')}`,
      );
    }
  }
  lines.push('------------------------------------------------------------');

  return lines.join('\n');
}
