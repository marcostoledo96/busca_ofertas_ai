import type { FeedbackDecision } from '../domain/opportunity/feedback.js';
import type { ReviewItem } from './review-item.js';

export interface FeedbackPattern {
  readonly savedSearchId: string;
  readonly feedbackDecision: FeedbackDecision;
  readonly reasonCode: string;
  readonly occurrences: number;
  readonly opportunityIds: readonly string[];
}

export interface RuleSuggestion {
  readonly pattern: FeedbackPattern;
  readonly message: string;
  readonly applicable: boolean;
}

export const RULE_SUGGESTION_THRESHOLD = 3;

/**
 * Conservatively detects repeated patterns in historical review feedback.
 * Analyzes only stable facts (SavedSearch, FeedbackDecision, EvaluationReason code).
 * Strictly avoids NLP, AI, or invented rule expressions.
 * In BOAI-015, all suggestions are advisory with applicable = false (zero config mutation).
 */
export function detectRuleSuggestions(
  items: readonly ReviewItem[],
  threshold = RULE_SUGGESTION_THRESHOLD,
): readonly RuleSuggestion[] {
  const patternMap = new Map<
    string,
    {
      savedSearchId: string;
      decision: FeedbackDecision;
      reasonCode: string;
      opportunityIds: Set<string>;
    }
  >();

  for (const item of items) {
    if (item.feedbackHistory.length === 0) {
      continue;
    }

    // Effective decision is the most recent feedback
    const latestFeedback = item.feedbackHistory[item.feedbackHistory.length - 1]!;
    const savedSearchId = item.opportunity.savedSearchId;

    for (const reason of item.evaluation.reasons) {
      const key = `${savedSearchId}::${latestFeedback.decision}::${reason.code}`;
      const existing = patternMap.get(key);
      if (existing) {
        existing.opportunityIds.add(item.opportunity.id);
      } else {
        patternMap.set(key, {
          savedSearchId,
          decision: latestFeedback.decision,
          reasonCode: reason.code,
          opportunityIds: new Set([item.opportunity.id]),
        });
      }
    }
  }

  const suggestions: RuleSuggestion[] = [];

  for (const entry of patternMap.values()) {
    if (entry.opportunityIds.size >= threshold) {
      const pattern: FeedbackPattern = {
        savedSearchId: entry.savedSearchId,
        feedbackDecision: entry.decision,
        reasonCode: entry.reasonCode,
        occurrences: entry.opportunityIds.size,
        opportunityIds: Array.from(entry.opportunityIds).sort(),
      };

      suggestions.push({
        pattern,
        message: `Sugerencia detectada: Se registraron ${pattern.occurrences} decisiones de tipo '${pattern.feedbackDecision}' asociadas al código de evaluación '${pattern.reasonCode}'. No existe todavía una regla aplicable automáticamente para este patrón.`,
        applicable: false,
      });
    }
  }

  return suggestions.sort((a, b) => b.pattern.occurrences - a.pattern.occurrences);
}
