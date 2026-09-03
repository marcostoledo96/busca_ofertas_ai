import type { ReviewItem, Feedback } from '@busca-ofertas-ai/core';

// Strip ANSI control sequences to prevent terminal injection
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

export class ReviewPresenter {
  public formatCard(item: ReviewItem, index: number, total: number): string {
    const lines: string[] = [
      '',
      `─────────────────────────────────────────────────────────────────`,
      `  REVISIÓN [${index + 1} de ${total}] — Oportunidad: ${item.opportunity.id}`,
      `─────────────────────────────────────────────────────────────────`,
      `  Título:       ${stripAnsi(item.observation.title)}`,
      `  URL:          ${item.listing.canonicalUrl}`,
      `  Precio:       ${item.observation.price ? `${item.observation.price.rawText} (${item.observation.price.amount} ${item.observation.price.currency})` : 'N/A'}`,
      `  Condición:    ${item.observation.condition ?? 'N/A'}`,
      `  Ubicación:    ${item.observation.location ? item.observation.location.rawText : 'N/A'}`,
      `  Novedad:      ${item.opportunity.novelty}`,
      `  Evaluación:   ${item.evaluation.decision} (Score: ${item.evaluation.score.toFixed(1)}/100)`,
    ];

    if (item.evaluation.reasons.length > 0) {
      lines.push(`  Motivos:`);
      for (const r of item.evaluation.reasons) {
        lines.push(`    • [${r.severity}] ${r.code}: ${stripAnsi(r.message)}`);
      }
    }

    if (item.feedbackHistory.length > 0) {
      const latest = item.feedbackHistory[item.feedbackHistory.length - 1]!;
      lines.push(`  Último feedback: ${latest.decision} (${latest.createdAt.toISOString()})`);
    }

    lines.push(`─────────────────────────────────────────────────────────────────`);
    return lines.join('\n');
  }

  public formatCardMenu(): string {
    return [
      `Acciones:`,
      `  [1] Marcar relevante (CONFIRMED_MATCH)`,
      `  [2] Descartar (NOT_INTERESTED)`,
      `  [3] Falso positivo (FALSE_POSITIVE)`,
      `  [4] Abrir publicación en navegador`,
      `  [5] Omitir (dejar pendiente para más tarde)`,
      `  [6] Ver historial de decisiones`,
      `  [0] Volver`,
    ].join('\n');
  }

  public formatHistoryDetails(history: readonly Feedback[]): string {
    if (history.length === 0) {
      return '\n  (Sin decisiones previas registradas para esta oportunidad)\n';
    }

    const lines: string[] = ['', `  Historial de feedback (${history.length} registro/s):`];

    for (let i = 0; i < history.length; i++) {
      const fb = history[i]!;
      const notesPart = fb.notes ? ` — Notas: "${stripAnsi(fb.notes)}"` : '';
      lines.push(
        `    ${i + 1}. [${fb.createdAt.toISOString()}] ${fb.actor} ➔ ${fb.decision}${notesPart}`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  public formatHistoryMenu(): string {
    return [
      `Acciones para este item:`,
      `  [1] Registrar nueva decisión (re-evaluar)`,
      `  [2] Abrir publicación en navegador`,
      `  [0] Volver`,
    ].join('\n');
  }
}
