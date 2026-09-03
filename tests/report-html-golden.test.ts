import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderReport, type ReportViewModel } from '@busca-ofertas-ai/report-html';

export const GOLDEN_ZERO_RESULTS_VM: ReportViewModel = {
  run: {
    runId: 'run-golden-zero-results',
    searchName: 'Nintendo Switch Lite AMBA',
    startedAt: '2026-09-03T10:00:00.000Z',
    finishedAt: '2026-09-03T10:00:02.000Z',
    globalStatus: 'SUCCESS',
    sources: [
      {
        sourceId: 'facebook-marketplace',
        sourceStatus: 'ZERO_RESULTS_CONFIRMED',
        collector: 'GraphQL',
        itemsCount: 0,
      },
    ],
    warnings: [],
    metrics: {
      totalCollected: 0,
      totalNormalized: 0,
      durationMs: 2000,
    },
  },
  items: [],
  sourceErrors: [],
};

export const GOLDEN_STANDARD_VM: ReportViewModel = {
  run: {
    runId: 'run-golden-standard',
    searchName: 'Nintendo Switch Lite en AMBA',
    startedAt: '2026-09-03T12:00:00.000Z',
    finishedAt: '2026-09-03T12:00:04.500Z',
    globalStatus: 'PARTIAL_SUCCESS',
    sources: [
      {
        sourceId: 'facebook-marketplace',
        sourceStatus: 'SUCCESS',
        collector: 'GraphQL',
        itemsCount: 3,
      },
      {
        sourceId: 'mercadolibre',
        sourceStatus: 'NETWORK_ERROR',
        collector: 'Playwright',
        itemsCount: 0,
      },
    ],
    manualExchangeRate: '1 USD = 1300 ARS',
    warnings: ['Cotización manual aplicada a 1 publicación.'],
    metrics: {
      totalCollected: 3,
      totalNormalized: 3,
      durationMs: 4500,
    },
  },
  items: [
    {
      id: 'golden-item-1',
      title: 'Nintendo Switch Lite Turquesa Completa',
      source: 'facebook-marketplace',
      url: 'https://facebook.com/marketplace/item/10001',
      rawPrice: 'USD 180',
      resolvedPrice: {
        amount: 180,
        currency: 'USD',
        display: 'USD 180.00',
      },
      conversionArs: {
        amount: 234000,
        display: 'ARS 234.000,00',
      },
      location: 'Hurlingham, Buenos Aires',
      condition: 'Usado - Como nuevo',
      publishedAt: '2026-09-03T09:30:00.000Z',
      observedAt: '2026-09-03T12:00:01.000Z',
      novelty: 'NEW',
      decision: 'MATCH',
      score: 92,
      reasons: [
        {
          code: 'PRICE_IN_RANGE',
          message: 'Precio dentro del rango esperado',
          severity: 'INFO',
          impact: 15,
        },
      ],
      imageUrl: 'https://images.example.com/switch-lite.jpg',
    },
    {
      id: 'golden-item-2',
      title: 'Nintendo Switch v2 con accesorios',
      source: 'facebook-marketplace',
      url: 'https://facebook.com/marketplace/item/10002',
      rawPrice: '$ 280.000',
      resolvedPrice: {
        amount: 280000,
        currency: 'ARS',
        display: 'ARS 280.000,00',
      },
      location: 'Morón, Buenos Aires',
      condition: 'Usado',
      publishedAt: '2026-09-02T18:00:00.000Z',
      observedAt: '2026-09-03T12:00:01.000Z',
      novelty: 'UNCHANGED',
      decision: 'REVIEW',
      score: 65,
      reasons: [
        {
          code: 'MODEL_AMBIGUOUS',
          message: 'El título indica Switch v2 en vez de Lite',
          severity: 'SOFT',
          impact: -20,
          evidence: 'v2 con accesorios',
        },
      ],
    },
    {
      id: 'golden-item-3',
      title: 'PlayStation 4 Slim 500GB',
      source: 'facebook-marketplace',
      rawPrice: '$ 350.000',
      novelty: 'NEW',
      decision: 'REJECT',
      reasons: [
        {
          code: 'WRONG_PLATFORM',
          message: 'La consola no corresponde a Nintendo Switch',
          severity: 'HARD',
        },
      ],
    },
  ],
  sourceErrors: [
    {
      sourceId: 'mercadolibre',
      sourceStatus: 'NETWORK_ERROR',
      errorCode: 'CONNECTION_TIMEOUT',
      message: 'Tiempo de espera agotado al consultar la API de Mercado Libre.',
      suggestedAction: 'Verificá tu conexión de red o reintentá más tarde.',
      collector: 'Playwright',
      partialCount: 0,
    },
  ],
};

describe('packages/report-html — Golden Report Snapshots', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures/golden-reports');

  it('matches legitimate zero results golden snapshot', async () => {
    const fixturePath = path.join(fixturesDir, 'zero-results.html');
    const generatedHtml = renderReport(GOLDEN_ZERO_RESULTS_VM);

    if (!fs.existsSync(fixturePath)) {
      await fs.promises.mkdir(fixturesDir, { recursive: true });
      await fs.promises.writeFile(fixturePath, generatedHtml, 'utf-8');
    }

    const expectedHtml = await fs.promises.readFile(fixturePath, 'utf-8');
    expect(generatedHtml).toBe(expectedHtml);
  });

  it('matches standard report (MATCH, REVIEW, REJECT, error) golden snapshot', async () => {
    const fixturePath = path.join(fixturesDir, 'standard-report.html');
    const generatedHtml = renderReport(GOLDEN_STANDARD_VM);

    if (!fs.existsSync(fixturePath)) {
      await fs.promises.mkdir(fixturesDir, { recursive: true });
      await fs.promises.writeFile(fixturePath, generatedHtml, 'utf-8');
    }

    const expectedHtml = await fs.promises.readFile(fixturePath, 'utf-8');
    expect(generatedHtml).toBe(expectedHtml);
  });
});
