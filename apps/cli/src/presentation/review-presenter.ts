import type { ReviewItem, Feedback } from '@busca-ofertas-ai/core';

// Strip ANSI control sequences to prevent terminal injection
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

/**
 * Sanitizes untrusted/external text for safe terminal rendering:
 * 1. Strips ANSI escape sequences.
 * 2. Normalizes ASCII control characters (0-31, 127) including carriage returns to prevent terminal line manipulation.
 */
export function sanitizeTerminalText(text: string): string {
  const withoutAnsi = stripAnsi(text);
  let sanitized = '';
  for (let i = 0; i < withoutAnsi.length; i++) {
    const code = withoutAnsi.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      sanitized += ' ';
    } else {
      sanitized += withoutAnsi[i];
    }
  }
  return sanitized.trim();
}

export class ReviewPresenter {
  public formatCard(item: ReviewItem, index: number, total: number): string {
    const lines: string[] = [
      '',
      `─────────────────────────────────────────────────────────────────`,
      `  REVISIÓN [${index + 1} de ${total}] — Oportunidad: ${item.opportunity.id}`,
      `─────────────────────────────────────────────────────────────────`,
      `  Título:       ${sanitizeTerminalText(item.observation.title)}`,
      `  URL:          ${sanitizeTerminalText(item.listing.canonicalUrl)}`,
      `  Precio:       ${item.observation.price ? `${sanitizeTerminalText(item.observation.price.rawText)} (${item.observation.price.amount} ${item.observation.price.currency})` : 'N/A'}`,
      `  Condición:    ${item.observation.condition ? sanitizeTerminalText(item.observation.condition) : 'N/A'}`,
      `  Ubicación:    ${item.observation.location ? sanitizeTerminalText(item.observation.location.rawText) : 'N/A'}`,
      `  Novedad:      ${item.opportunity.novelty}`,
      `  Evaluación:   ${item.evaluation.decision} (Score: ${item.evaluation.score.toFixed(1)}/100)`,
    ];

    if (item.evaluation.reasons.length > 0) {
      lines.push(`  Motivos:`);
      for (const r of item.evaluation.reasons) {
        lines.push(`    • [${r.severity}] ${r.code}: ${sanitizeTerminalText(r.message)}`);
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
      const notesPart = fb.notes ? ` — Notas: "${sanitizeTerminalText(fb.notes)}"` : '';
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
