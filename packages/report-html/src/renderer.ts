import type {
  ReportViewModel,
  ReportItem,
  ReportReason,
  ReportSourceError,
  ReportSourceSummary,
  GlobalRunStatus,
  ItemNovelty,
  ItemDecision,
} from './view-model.js';
import { escapeHtml } from './html-escape.js';
import { validateSafeUrl } from './url-policy.js';
import {
  sortMatchItems,
  sortReviewItems,
  sortRejectItems,
  sortSourceErrors,
  sortSources,
} from './sort.js';
import { REPORT_CSS } from './styles.js';

const STATUS_LABELS: Record<GlobalRunStatus, string> = {
  SUCCESS: 'Éxito (SUCCESS)',
  PARTIAL_SUCCESS: 'Éxito parcial (PARTIAL_SUCCESS)',
  FAILED: 'Fallo (FAILED)',
  CANCELLED: 'Cancelado (CANCELLED)',
};

const NOVELTY_LABELS: Record<ItemNovelty, string> = {
  NEW: 'Nueva',
  PRICE_CHANGED: 'Cambio de precio',
  REAPPEARED: 'Reaparecida',
  UNCHANGED: 'Sin cambios',
};

const DECISION_LABELS: Record<ItemDecision, string> = {
  MATCH: 'MATCH — Coincidencia',
  REVIEW: 'REVIEW — Revisión',
  REJECT: 'REJECT — Rechazada',
};

function renderHeader(
  vm: ReportViewModel,
  derivedMetrics: {
    matchCount: number;
    reviewCount: number;
    rejectCount: number;
    sourceErrorsCount: number;
  },
): string {
  const run = vm.run;
  const statusLabel = STATUS_LABELS[run.globalStatus] ?? run.globalStatus;
  const warningsHtml =
    run.warnings.length > 0
      ? `
    <div class="banner banner-warnings" role="alert">
      <strong>Advertencias de la ejecución:</strong>
      <ul>
        ${run.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('\n        ')}
      </ul>
    </div>`
      : '';

  return `
  <header class="report-header">
    <div class="header-top">
      <h1>Reporte de Oportunidades: ${escapeHtml(run.searchName)}</h1>
      <span class="badge badge-status-${escapeHtml(run.globalStatus)}">${escapeHtml(statusLabel)}</span>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <strong>ID de Ejecución</strong>
        <span>${escapeHtml(run.runId)}</span>
      </div>
      <div class="meta-item">
        <strong>Inicio</strong>
        <span>${escapeHtml(run.startedAt)}</span>
      </div>
      <div class="meta-item">
        <strong>Fin</strong>
        <span>${escapeHtml(run.finishedAt ?? 'No registrado')}</span>
      </div>
      ${
        run.manualExchangeRate !== undefined
          ? `
      <div class="meta-item">
        <strong>Cotización Manual</strong>
        <span>${escapeHtml(run.manualExchangeRate)}</span>
      </div>`
          : ''
      }
      ${
        run.metrics.durationMs !== undefined
          ? `
      <div class="meta-item">
        <strong>Duración</strong>
        <span>${escapeHtml((run.metrics.durationMs / 1000).toFixed(2))} s</span>
      </div>`
          : ''
      }
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(run.metrics.totalCollected)}</div>
        <div class="metric-label">Recolectadas</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(run.metrics.totalNormalized)}</div>
        <div class="metric-label">Normalizadas</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(derivedMetrics.matchCount)}</div>
        <div class="metric-label">MATCH</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(derivedMetrics.reviewCount)}</div>
        <div class="metric-label">REVIEW</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(derivedMetrics.rejectCount)}</div>
        <div class="metric-label">REJECT</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(derivedMetrics.sourceErrorsCount)}</div>
        <div class="metric-label">Errores</div>
      </div>
    </div>

    ${warningsHtml}
  </header>`;
}

function renderSourcesSection(sources: readonly ReportSourceSummary[]): string {
  if (sources.length === 0) {
    return `
    <section aria-labelledby="heading-sources">
      <h2 id="heading-sources">Fuentes y Collectors (0)</h2>
      <p class="empty-state">No se configuraron fuentes para esta ejecución.</p>
    </section>`;
  }

  const rows = sources
    .map(
      (src) => `
        <tr>
          <td><strong>${escapeHtml(src.sourceId)}</strong></td>
          <td>${escapeHtml(src.collector ?? 'N/A')}</td>
          <td><span class="badge badge-status-${escapeHtml(src.sourceStatus === 'SUCCESS' ? 'SUCCESS' : src.sourceStatus === 'ZERO_RESULTS_CONFIRMED' ? 'SUCCESS' : 'FAILED')}">${escapeHtml(src.sourceStatus)}</span></td>
          <td>${escapeHtml(src.itemsCount !== undefined ? src.itemsCount : 'No disponible')}</td>
        </tr>`,
    )
    .join('\n');

  return `
    <section aria-labelledby="heading-sources">
      <h2 id="heading-sources">Fuentes y Collectors (${sources.length})</h2>
      <div class="table-responsive">
        <table>
          <caption>Resumen de fuentes consultadas</caption>
          <thead>
            <tr>
              <th scope="col">Fuente</th>
              <th scope="col">Collector</th>
              <th scope="col">Estado</th>
              <th scope="col">Publicaciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderReasons(reasons: readonly ReportReason[]): string {
  if (reasons.length === 0) {
    return `
      <div class="reasons-section">
        <div class="reasons-title">Razones de evaluación</div>
        <p class="empty-state" style="margin: 0.25rem 0; padding: 0.5rem; font-size: 0.85rem;">Sin razones registradas.</p>
      </div>`;
  }

  const items = reasons
    .map(
      (r) => `
        <div class="reason-item">
          <span class="badge badge-severity-${escapeHtml(r.severity)}">${escapeHtml(r.severity)}</span>
          <span class="reason-code">${escapeHtml(r.code)}</span>
          <span class="reason-message">${escapeHtml(r.message)}</span>
          ${r.impact !== undefined ? `<span class="reason-impact">(Impacto: ${escapeHtml(r.impact)})</span>` : ''}
          ${r.evidence !== undefined ? `<div class="reason-evidence">Evidencia: ${escapeHtml(r.evidence)}</div>` : ''}
        </div>`,
    )
    .join('\n');

  return `
    <div class="reasons-section">
      <div class="reasons-title">Razones de evaluación (${reasons.length})</div>
      ${items}
    </div>`;
}

function renderItemCard(item: ReportItem): string {
  const safeUrl = validateSafeUrl(item.url);
  const safeImageUrl = validateSafeUrl(item.imageUrl);
  const decisionLabel = DECISION_LABELS[item.decision] ?? item.decision;
  const noveltyLabel = NOVELTY_LABELS[item.novelty] ?? item.novelty;

  const urlLink = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Ver publicación</a>`
    : `<span class="url-disabled">Enlace no disponible</span>`;

  const imageLink = safeImageUrl
    ? `<a href="${escapeHtml(safeImageUrl)}" target="_blank" rel="noopener noreferrer" class="image-link">Ver imagen</a>`
    : '';

  const scoreText = item.score !== undefined ? `${item.score}` : 'No disponible';
  const rawPriceText = item.rawPrice !== undefined ? item.rawPrice : 'No disponible';
  const resolvedPriceText = item.resolvedPrice ? item.resolvedPrice.display : 'No disponible';
  const resolvedCurrencyText = item.resolvedPrice ? item.resolvedPrice.currency : 'No disponible';
  const conversionText = item.conversionArs ? item.conversionArs.display : null;

  const cardDetails: string[] = [
    `<div class="card-detail-item"><strong>Fuente:</strong> ${escapeHtml(item.source)}</div>`,
    `<div class="card-detail-item"><strong>Precio crudo:</strong> ${escapeHtml(rawPriceText)}</div>`,
    `<div class="card-detail-item"><strong>Precio resuelto:</strong> ${escapeHtml(resolvedPriceText)}</div>`,
    `<div class="card-detail-item"><strong>Moneda resuelta:</strong> ${escapeHtml(resolvedCurrencyText)}</div>`,
  ];

  if (conversionText !== null) {
    cardDetails.push(
      `<div class="card-detail-item"><strong>Conversión ARS:</strong> ${escapeHtml(conversionText)}</div>`,
    );
  }

  cardDetails.push(
    `<div class="card-detail-item"><strong>Puntaje (score):</strong> ${escapeHtml(scoreText)}</div>`,
    `<div class="card-detail-item"><strong>Ubicación:</strong> ${escapeHtml(item.location ?? 'No disponible')}</div>`,
    `<div class="card-detail-item"><strong>Condición:</strong> ${escapeHtml(item.condition ?? 'No disponible')}</div>`,
    `<div class="card-detail-item"><strong>Publicada:</strong> ${escapeHtml(item.publishedAt ?? 'No disponible')}</div>`,
  );

  if (item.observedAt !== undefined) {
    cardDetails.push(
      `<div class="card-detail-item"><strong>Observada:</strong> ${escapeHtml(item.observedAt)}</div>`,
    );
  }

  cardDetails.push(`<div class="card-detail-item"><strong>Enlace:</strong> ${urlLink}</div>`);

  if (imageLink !== '') {
    cardDetails.push(`<div class="card-detail-item"><strong>Imagen:</strong> ${imageLink}</div>`);
  }

  const detailsHtml = cardDetails.map((detail) => `        ${detail}`).join('\n');

  return `
    <article class="item-card card-${escapeHtml(item.decision)}" id="item-${escapeHtml(item.id)}">
      <div class="card-header">
        <h3 class="card-title">${escapeHtml(item.title)}</h3>
        <div class="card-badges">
          <span class="badge badge-decision-${escapeHtml(item.decision)}">${escapeHtml(decisionLabel)}</span>
          <span class="badge badge-novelty">${escapeHtml(noveltyLabel)}</span>
        </div>
      </div>

      <div class="card-details-grid">
${detailsHtml}
      </div>

      ${renderReasons(item.reasons)}
    </article>`;
}

function renderMatchSection(items: readonly ReportItem[]): string {
  const content =
    items.length === 0
      ? '<p class="empty-state">No hay publicaciones MATCH.</p>'
      : `<div class="cards-list">${items.map(renderItemCard).join('\n')}</div>`;

  return `
    <section aria-labelledby="heading-match">
      <h2 id="heading-match">Coincidencias (MATCH) (${items.length})</h2>
      ${content}
    </section>`;
}

function renderReviewSection(items: readonly ReportItem[]): string {
  const content =
    items.length === 0
      ? '<p class="empty-state">No hay publicaciones en revisión.</p>'
      : `<div class="cards-list">${items.map(renderItemCard).join('\n')}</div>`;

  return `
    <section aria-labelledby="heading-review">
      <h2 id="heading-review">En Revisión (REVIEW) (${items.length})</h2>
      ${content}
    </section>`;
}

function renderRejectSection(items: readonly ReportItem[]): string {
  const content =
    items.length === 0
      ? '<p class="empty-state">No hay publicaciones rechazadas.</p>'
      : `<div class="cards-list">${items.map(renderItemCard).join('\n')}</div>`;

  return `
    <section aria-labelledby="heading-reject">
      <h2 id="heading-reject" class="visually-hidden" style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0;">Rechazadas (REJECT)</h2>
      <details class="reject-details">
        <summary class="reject-summary">
          <span class="reject-summary-title">
            <span class="badge badge-decision-REJECT">REJECT</span>
            Rechazadas (${items.length})
          </span>
          <span class="reject-summary-hint">Hacé clic para desplegar / colapsar</span>
        </summary>
        <div class="reject-content">
          ${content}
        </div>
      </details>
    </section>`;
}

function renderErrorsSection(errors: readonly ReportSourceError[]): string {
  if (errors.length === 0) {
    return `
    <section aria-labelledby="heading-errors">
      <h2 id="heading-errors">Errores de Fuente (0)</h2>
      <p class="empty-state">No se registraron errores de fuente.</p>
    </section>`;
  }

  const items = errors
    .map(
      (err) => `
      <div class="error-card">
        <div class="error-header">
          <div>
            <strong>Fuente: ${escapeHtml(err.sourceId)}</strong>
            ${err.collector ? ` <span>(Collector: ${escapeHtml(err.collector)})</span>` : ''}
          </div>
          <span class="badge badge-status-FAILED">${escapeHtml(err.errorCode)}</span>
        </div>
        <div class="error-status" style="margin-top: 0.25rem; font-size: 0.9rem;">
          <strong>Estado:</strong> ${escapeHtml(err.sourceStatus)}
        </div>
        <div class="error-message">
          <strong>Explicación:</strong> ${escapeHtml(err.message)}
        </div>
        <div class="error-action">
          <strong>Acción sugerida:</strong> ${escapeHtml(err.suggestedAction)}
        </div>
        ${
          err.partialCount !== undefined
            ? `<div style="margin-top: 0.5rem; font-size: 0.85rem;">Items parciales recolectados antes del fallo: ${escapeHtml(err.partialCount)}</div>`
            : ''
        }
      </div>`,
    )
    .join('\n');

  return `
    <section aria-labelledby="heading-errors">
      <h2 id="heading-errors">Errores de Fuente (${errors.length})</h2>
      ${items}
    </section>`;
}

/**
 * Pure, deterministic HTML report renderer.
 *
 * Guaranteed invariants:
 * - Free of Node.js / SQLite dependencies.
 * - Deterministic: renderReport(vm) === renderReport(vm).
 * - Full HTML5 document with lang="es".
 * - Restrictive Content Security Policy.
 * - Semantic hierarchy and keyboard accessible controls.
 */
export function renderReport(viewModel: ReportViewModel): string {
  const matchItems = sortMatchItems(viewModel.items.filter((i) => i.decision === 'MATCH'));
  const reviewItems = sortReviewItems(viewModel.items.filter((i) => i.decision === 'REVIEW'));
  const rejectItems = sortRejectItems(viewModel.items.filter((i) => i.decision === 'REJECT'));
  const sortedErrors = sortSourceErrors(viewModel.sourceErrors);
  const sortedSources = sortSources(viewModel.run.sources);

  const derivedMetrics = {
    matchCount: matchItems.length,
    reviewCount: reviewItems.length,
    rejectCount: rejectItems.length,
    sourceErrorsCount: sortedErrors.length,
  };

  const isLegitimateZeroResults =
    viewModel.run.globalStatus === 'SUCCESS' &&
    viewModel.items.length === 0 &&
    sortedErrors.length === 0 &&
    sortedSources.length > 0 &&
    sortedSources.every((s) => s.sourceStatus === 'ZERO_RESULTS_CONFIRMED');

  const zeroResultsBanner = isLegitimateZeroResults
    ? `
    <div class="banner banner-zero-results" role="status">
      <strong>Búsqueda finalizada con éxito.</strong> Cero resultados confirmados en las fuentes consultadas.
    </div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
  <title>Reporte: ${escapeHtml(viewModel.run.searchName)} - ${escapeHtml(viewModel.run.runId)}</title>
  <style>
${REPORT_CSS}
  </style>
</head>
<body>
  <div class="report-container">
    ${renderHeader(viewModel, derivedMetrics)}

    <main>
      ${zeroResultsBanner}
      ${renderSourcesSection(sortedSources)}
      ${renderMatchSection(matchItems)}
      ${renderReviewSection(reviewItems)}
      ${renderRejectSection(rejectItems)}
      ${renderErrorsSection(sortedErrors)}
    </main>

    <footer class="report-footer">
      <p>Reporte local generado por <strong>Busca Ofertas AI</strong>. Operación local-first sin servidores ni telemetría remota.</p>
    </footer>
  </div>
</body>
</html>
`;
}
