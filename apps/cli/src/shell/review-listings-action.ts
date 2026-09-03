import {
  type ReviewItem,
  type FeedbackDecision,
  type ExternalUrlOpenerPort,
  ReviewQueueService,
  RecordReviewFeedbackUseCase,
  detectRuleSuggestions,
} from '@busca-ofertas-ai/core';
import type { MenuAction, ActionExecutionContext, ActionResult } from './menu-actions.js';
import { WizardPrompter } from '../wizard/wizard-prompter.js';
import { ReviewPresenter, stripAnsi } from '../presentation/review-presenter.js';
import { NodeExternalUrlOpener } from '../platform/node-external-url-opener.js';

export interface ReviewListingsActionHandlerParams {
  readonly reviewQueueService: ReviewQueueService;
  readonly recordFeedbackUseCase: RecordReviewFeedbackUseCase;
  readonly externalUrlOpener?: ExternalUrlOpenerPort;
  readonly presenter?: ReviewPresenter;
}

export class ReviewListingsActionHandler implements MenuAction {
  public readonly id = 'review-listings';
  public readonly optionNumber = 5;
  public readonly title = 'Revisar publicaciones dudosas';

  private readonly reviewQueueService: ReviewQueueService;
  private readonly recordFeedbackUseCase: RecordReviewFeedbackUseCase;
  private readonly externalUrlOpener: ExternalUrlOpenerPort;
  private readonly presenter: ReviewPresenter;

  constructor(params: ReviewListingsActionHandlerParams) {
    this.reviewQueueService = params.reviewQueueService;
    this.recordFeedbackUseCase = params.recordFeedbackUseCase;
    this.externalUrlOpener = params.externalUrlOpener ?? new NodeExternalUrlOpener();
    this.presenter = params.presenter ?? new ReviewPresenter();
  }

  public async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const prompter = new WizardPrompter(context.terminal, context.signal);
    context.diagnostics.info('User entered review-listings submenu.');

    try {
      while (!context.signal.aborted) {
        context.terminal.writeLine('\n═══ Revisión de Publicaciones Dudosas (REVIEW) ═══');
        context.terminal.writeLine('  [1] Pendientes por ejecución');
        context.terminal.writeLine('  [2] Pendientes por búsqueda');
        context.terminal.writeLine('  [3] Ver historial reciente');
        context.terminal.writeLine('  [0] Volver al menú principal');

        const option = await prompter.promptText('Seleccioná una opción [0-3]: ', {
          allowEmpty: true,
        });
        if (context.signal.aborted || option === '0' || !option) {
          break;
        }

        if (option === '1') {
          await this.handlePendingByRun(prompter, context);
        } else if (option === '2') {
          await this.handlePendingBySearch(prompter, context);
        } else if (option === '3') {
          await this.handleRecentHistory(prompter, context);
        } else {
          context.terminal.writeLine('  [!] Opción no válida.');
        }
      }
    } catch (err: unknown) {
      if (context.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        context.diagnostics.info('Review flow cancelled cooperatively via AbortSignal.');
        return { kind: 'continue' };
      }
      throw err;
    }

    return { kind: 'continue' };
  }

  private async handlePendingByRun(
    prompter: WizardPrompter,
    context: ActionExecutionContext,
  ): Promise<void> {
    const runId = await prompter.promptText(
      'Ingresá el ID de la ejecución (o Enter para cancelar): ',
      {
        allowEmpty: true,
      },
    );
    if (!runId.trim() || context.signal.aborted) {
      return;
    }

    context.diagnostics.info(`Loading pending review queue for run: ${runId}`);
    const items = await this.reviewQueueService.getPendingReviewQueueByRunId(
      runId.trim(),
      context.signal,
    );

    if (items.length === 0) {
      context.terminal.writeLine(
        '\nNo hay publicaciones pendientes de revisión para esta ejecución.',
      );
      return;
    }

    await this.runReviewQueueLoop(items, prompter, context);
  }

  private async handlePendingBySearch(
    prompter: WizardPrompter,
    context: ActionExecutionContext,
  ): Promise<void> {
    const searchId = await prompter.promptText(
      'Ingresá el ID de la búsqueda guardada (o Enter para cancelar): ',
      { allowEmpty: true },
    );
    if (!searchId.trim() || context.signal.aborted) {
      return;
    }

    context.diagnostics.info(`Loading pending review queue for saved search: ${searchId}`);
    const items = await this.reviewQueueService.getPendingReviewQueueBySavedSearchId(
      searchId.trim(),
      context.signal,
    );

    if (items.length === 0) {
      context.terminal.writeLine(
        '\nNo hay publicaciones pendientes de revisión para esta búsqueda.',
      );
      return;
    }

    await this.runReviewQueueLoop(items, prompter, context);
  }

  private async runReviewQueueLoop(
    items: readonly ReviewItem[],
    prompter: WizardPrompter,
    context: ActionExecutionContext,
  ): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      if (context.signal.aborted) {
        break;
      }

      const item = items[i]!;
      let advanceToNext = false;

      while (!advanceToNext && !context.signal.aborted) {
        context.terminal.writeLine(this.presenter.formatCard(item, i, items.length));
        context.terminal.writeLine(this.presenter.formatCardMenu());

        const action = await prompter.promptText('Seleccioná una acción [0-6]: ', {
          allowEmpty: true,
        });
        if (context.signal.aborted || action === '0') {
          context.terminal.writeLine(
            '\nRevisión interrumpida. Los items no decididos permanecen pendientes.',
          );
          return;
        }

        if (action === '1' || action === '2' || action === '3') {
          const decisionMap: Record<string, FeedbackDecision> = {
            '1': 'CONFIRMED_MATCH',
            '2': 'NOT_INTERESTED',
            '3': 'FALSE_POSITIVE',
          };
          const decision = decisionMap[action]!;

          const notesInput = await prompter.promptText(
            'Motivo opcional (máx 2000 caracteres, Enter para omitir): ',
            { allowEmpty: true },
          );

          const notes = notesInput.trim().length > 0 ? notesInput.trim().slice(0, 2000) : undefined;

          await this.recordFeedbackUseCase.execute({
            opportunityId: item.opportunity.id,
            previousEvaluationId: item.evaluation.id,
            decision,
            ...(notes !== undefined ? { notes } : {}),
          });

          context.diagnostics.info(
            `Recorded feedback for opportunity ${item.opportunity.id}: decision=${decision}`,
          );
          context.terminal.writeLine('\n✔ Decisión registrada exitosamente.');
          advanceToNext = true;
        } else if (action === '4') {
          context.terminal.writeLine(`\nAbriendo: ${item.listing.canonicalUrl}...`);
          try {
            await this.externalUrlOpener.open(item.listing.canonicalUrl, context.signal);
            context.terminal.writeLine('Publicación enviada al navegador.');
          } catch (e) {
            context.terminal.writeLine(
              `  [!] Error al abrir URL: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else if (action === '5') {
          context.terminal.writeLine('\nPublicación omitida (permanece en estado pendiente).');
          advanceToNext = true;
        } else if (action === '6') {
          context.terminal.writeLine(this.presenter.formatHistoryDetails(item.feedbackHistory));
        } else {
          context.terminal.writeLine('  [!] Opción no válida.');
        }
      }
    }

    if (!context.signal.aborted) {
      context.terminal.writeLine('\n═══ Fin de la cola de revisión ═══');
    }
  }

  private async handleRecentHistory(
    prompter: WizardPrompter,
    context: ActionExecutionContext,
  ): Promise<void> {
    const searchId = await prompter.promptText(
      'Ingresá el ID de la búsqueda guardada para ver historial: ',
      { allowEmpty: true },
    );
    if (!searchId.trim() || context.signal.aborted) {
      return;
    }

    context.diagnostics.info(`Loading review history for search: ${searchId}`);
    const historyItems = await this.reviewQueueService.getRecentHistoryBySavedSearchId(
      searchId.trim(),
      50,
      context.signal,
    );

    if (historyItems.length === 0) {
      context.terminal.writeLine('\nNo hay publicaciones con feedback previo para esta búsqueda.');
      return;
    }

    // Check conservative rule suggestions
    const suggestions = detectRuleSuggestions(historyItems);
    if (suggestions.length > 0) {
      context.terminal.writeLine('\n[Sugerencias de reglas detectadas]');
      for (const s of suggestions) {
        context.terminal.writeLine(`  • ${s.message}`);
      }
    }

    while (!context.signal.aborted) {
      context.terminal.writeLine(
        `\nHistorial de publicaciones revisadas (${historyItems.length}):`,
      );
      for (let i = 0; i < historyItems.length; i++) {
        const h = historyItems[i]!;
        const lastFeedback = h.feedbackHistory[h.feedbackHistory.length - 1]!;
        context.terminal.writeLine(
          `  [${i + 1}] ${h.opportunity.id} — ${stripAnsi(h.observation.title)} (Última: ${lastFeedback.decision})`,
        );
      }
      context.terminal.writeLine('  [0] Volver');

      const selection = await prompter.promptText(
        'Seleccioná un item para ver detalle / registrar nueva decisión [0 para volver]: ',
        { allowEmpty: true },
      );

      if (!selection.trim() || selection.trim() === '0' || context.signal.aborted) {
        break;
      }

      const num = Number(selection.trim());
      if (!Number.isInteger(num) || num < 1 || num > historyItems.length) {
        context.terminal.writeLine('  [!] Selección no válida.');
        continue;
      }

      let currentItem = historyItems[num - 1]!;
      let backToHistoryList = false;

      while (!backToHistoryList && !context.signal.aborted) {
        context.terminal.writeLine(
          this.presenter.formatCard(currentItem, num - 1, historyItems.length),
        );
        context.terminal.writeLine(
          this.presenter.formatHistoryDetails(currentItem.feedbackHistory),
        );
        context.terminal.writeLine(this.presenter.formatHistoryMenu());

        const act = await prompter.promptText('Acción [0-2]: ', { allowEmpty: true });
        if (act === '0' || !act || context.signal.aborted) {
          backToHistoryList = true;
        } else if (act === '1') {
          // Re-review: Append a new contradictory/updated feedback
          context.terminal.writeLine('\nRegistrar nueva decisión para esta oportunidad:');
          context.terminal.writeLine('  [1] Relevante (CONFIRMED_MATCH)');
          context.terminal.writeLine('  [2] Descartar (NOT_INTERESTED)');
          context.terminal.writeLine('  [3] Falso positivo (FALSE_POSITIVE)');
          context.terminal.writeLine('  [0] Cancelar');

          const decChoice = await prompter.promptText('Nueva decisión [0-3]: ', {
            allowEmpty: true,
          });
          if (decChoice === '1' || decChoice === '2' || decChoice === '3') {
            const decisionMap: Record<string, FeedbackDecision> = {
              '1': 'CONFIRMED_MATCH',
              '2': 'NOT_INTERESTED',
              '3': 'FALSE_POSITIVE',
            };
            const newDecision = decisionMap[decChoice]!;

            const notesInput = await prompter.promptText(
              'Motivo del cambio de criterio (máx 2000 caracteres, Enter para omitir): ',
              { allowEmpty: true },
            );
            const notes =
              notesInput.trim().length > 0 ? notesInput.trim().slice(0, 2000) : undefined;

            await this.recordFeedbackUseCase.execute({
              opportunityId: currentItem.opportunity.id,
              previousEvaluationId: currentItem.evaluation.id,
              decision: newDecision,
              ...(notes !== undefined ? { notes } : {}),
            });

            context.diagnostics.info(
              `Recorded re-review feedback for opportunity ${currentItem.opportunity.id}: decision=${newDecision}`,
            );
            context.terminal.writeLine(
              '\n✔ Nueva decisión registrada en el historial (append-only).',
            );

            // Refresh the current item's history
            const reloaded = await this.reviewQueueService.getReviewItemByOpportunityId(
              currentItem.opportunity.id,
              context.signal,
            );
            if (reloaded) {
              currentItem = reloaded;
            }
          }
        } else if (act === '2') {
          context.terminal.writeLine(`\nAbriendo: ${currentItem.listing.canonicalUrl}...`);
          try {
            await this.externalUrlOpener.open(currentItem.listing.canonicalUrl, context.signal);
            context.terminal.writeLine('Publicación enviada al navegador.');
          } catch (e) {
            context.terminal.writeLine(
              `  [!] Error al abrir URL: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          context.terminal.writeLine('  [!] Opción no válida.');
        }
      }
    }
  }
}
