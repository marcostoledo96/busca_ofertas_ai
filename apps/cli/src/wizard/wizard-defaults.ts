import type {
  EvaluationConfigurationV1,
  AiConfigurationV1,
  RetentionConfigurationV1,
  ReportConfigurationV1,
} from '@busca-ofertas-ai/configuration';

/**
 * Explicit default policy values for Wizard v1.
 * Only mandatory blocks (evaluation, ai, retention) and enabled=true receive defaults.
 * Specific business options (such as currency, product models, conditions, and AI provider)
 * are never hardcoded here.
 */

export const WIZARD_DEFAULT_ENABLED = true;

export const WIZARD_DEFAULT_EVALUATION: Readonly<EvaluationConfigurationV1> = Object.freeze({
  matchThreshold: 80,
  reviewThreshold: 40,
  precisionProfile: 'MIXED',
});

export const WIZARD_DEFAULT_AI: Readonly<AiConfigurationV1> = Object.freeze({
  enabled: false,
  evaluateOnlyReview: true,
  requireConfirmation: true,
  maxEvaluationsPerRun: 5,
});

export const WIZARD_DEFAULT_RETENTION: Readonly<RetentionConfigurationV1> = Object.freeze({
  rawArtifacts: 'ERRORS_AND_REVIEW',
  rawDataDays: 30,
});

export const WIZARD_DEFAULT_REPORT: Readonly<ReportConfigurationV1> = Object.freeze({
  openAutomatically: true,
  includeRejected: 'COLLAPSED' as const,
  exports: ['HTML', 'JSON', 'CSV'] as const,
});
