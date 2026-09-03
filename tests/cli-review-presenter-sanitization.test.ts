import { describe, it, expect } from 'vitest';
import { ReviewPresenter, sanitizeTerminalText } from '@busca-ofertas-ai/cli';
import {
  createOpportunity,
  createEvaluation,
  createEvaluationReason,
  createFeedback,
  createObservation,
  createResolvedPrice,
  type ReviewItem,
} from '@busca-ofertas-ai/core';

describe('ReviewPresenter Terminal Sanitization (MEDIUM-01)', () => {
  it('sanitizes ANSI escape sequences and control characters across all raw/untrusted fields', () => {
    const presenter = new ReviewPresenter();

    const ansiTitle = '\x1B[31mNintendo\x1B[0m \x1B[1mSwitch\x1B[22m Lite\rInjected';
    const ansiUrl = 'https://example.com/item\x1B[2J/malicious';
    const ansiPriceRaw = '\x1B[32m$150.000\x1B[0m\r\x1B[K';
    const ansiLocationRaw = '\x1B[34mPalermo\x1B[0m, \x1B[33mCABA\x1B[0m\x07';
    const ansiReasonMsg = 'Precio sospechosamente \x1B[31mbajo\x1B[0m\x1B[1A';
    const ansiNotes = 'El vendedor parece \x1B[41mlegitimo\x1B[0m pero pide seña\r';

    const item: ReviewItem = {
      opportunity: createOpportunity({
        id: 'opp-1',
        savedSearchId: 'search-1',
        observationId: 'obs-1',
        evaluationId: 'eval-1',
        novelty: 'NEW',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      }),
      observation: createObservation({
        id: 'obs-1',
        listingId: 'list-1',
        sourceRunId: 'sr-1',
        observedAt: new Date('2026-09-03T12:00:00.000Z'),
        title: ansiTitle,
        price: createResolvedPrice({
          amount: 150000,
          currency: 'ARS',
          rawText: ansiPriceRaw,
          resolution: 'EXPLICIT',
          confidence: 1.0,
          evidence: ['150000'],
        }),
        location: {
          rawText: ansiLocationRaw,
        },
        condition: 'GOOD',
        availability: 'AVAILABLE',
        imageUrls: [],
        rawFingerprint: 'fp-1',
      }),
      listing: {
        id: 'list-1',
        sourceId: 'synth-source',
        externalId: 'ext-1',
        canonicalUrl: ansiUrl,
        firstSeenAt: new Date('2026-09-03T12:00:00.000Z'),
        lastSeenAt: new Date('2026-09-03T12:00:00.000Z'),
      },
      evaluation: createEvaluation({
        id: 'eval-1',
        decision: 'REVIEW',
        score: 65,
        reasons: [
          createEvaluationReason({
            code: 'PRICE_SUSPICIOUS',
            message: ansiReasonMsg,
            severity: 'SOFT',
            impact: -35,
          }),
        ],
        evaluatedBy: ['RULES'],
        policyVersion: 'v1',
        createdAt: new Date('2026-09-03T12:00:00.000Z'),
      }),
      feedbackHistory: [
        createFeedback({
          id: 'fb-1',
          opportunityId: 'opp-1',
          previousEvaluationId: 'eval-1',
          actor: 'LOCAL_USER',
          decision: 'FALSE_POSITIVE',
          notes: ansiNotes,
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      ],
    };

    const card = presenter.formatCard(item, 0, 1);
    const history = presenter.formatHistoryDetails(item.feedbackHistory);

    // Assert that card contains zero ESC (\x1B) characters
    expect(card.includes('\x1B')).toBe(false);
    expect(card.includes('\x07')).toBe(false); // Bell char stripped
    expect(card).toContain('Nintendo Switch Lite Injected');
    expect(card).toContain('https://example.com/item/malicious');
    expect(card).toContain('$150.000 (150000 ARS)');
    expect(card).toContain('Palermo, CABA');
    expect(card).toContain('GOOD');
    expect(card).toContain('Precio sospechosamente bajo');

    // Assert that history contains zero ESC (\x1B) characters
    expect(history.includes('\x1B')).toBe(false);
    expect(history).toContain('El vendedor parece legitimo pero pide seña');
  });

  it('sanitizeTerminalText handles clean text and text with diverse escape codes identically', () => {
    expect(sanitizeTerminalText('Simple Clean Text')).toBe('Simple Clean Text');
    expect(sanitizeTerminalText('\x1B[31mRed\x1B[0m')).toBe('Red');
    expect(sanitizeTerminalText('Line1\rLine2')).toBe('Line1 Line2');
  });
});
