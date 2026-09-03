import { describe, it, expect } from 'vitest';
import {
  renderReport,
  escapeHtml,
  validateSafeUrl,
  type ReportViewModel,
  type ReportItem,
} from '@busca-ofertas-ai/report-html';

function createMinimalViewModel(overrides?: Partial<ReportViewModel>): ReportViewModel {
  return {
    run: {
      runId: 'run-20260903-test1',
      searchName: 'Nintendo Switch Lite en AMBA',
      startedAt: '2026-09-03T12:00:00.000Z',
      finishedAt: '2026-09-03T12:00:05.000Z',
      globalStatus: 'SUCCESS',
      sources: [
        {
          sourceId: 'facebook-marketplace',
          sourceStatus: 'SUCCESS',
          collector: 'GraphQL',
          itemsCount: 1,
        },
      ],
      warnings: [],
      metrics: {
        totalCollected: 1,
        totalNormalized: 1,
        durationMs: 5000,
      },
    },
    items: [],
    sourceErrors: [],
    ...overrides,
  };
}

describe('packages/report-html — Renderer and Security', () => {
  describe('HTML escaping and XSS defense', () => {
    it('escapes essential HTML special characters (&, <, >, ", \')', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"quoted" and \'single\'')).toBe('&quot;quoted&quot; and &#39;single&#39;');
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(1234)).toBe('1234');
    });

    it('neutralizes malicious XSS injection payloads across all item fields', () => {
      const maliciousItem: ReportItem = {
        id: 'item-xss-1',
        title: '<script>alert("xss-title")</script>',
        source: '"><svg onload=alert(1)>',
        location: '</style><script>alert("css-breakout")</script>',
        condition: "' autofocus onfocus='alert(1)",
        rawPrice: '<img src=x onerror=alert("price")>',
        novelty: 'NEW',
        decision: 'MATCH',
        reasons: [
          {
            code: 'REASON_<SCRIPT>',
            message: '<script>alert("reason-msg")</script>',
            severity: 'HARD',
            evidence: '<iframe src="javascript:alert(1)">',
          },
        ],
      };

      const vm = createMinimalViewModel({
        run: {
          ...createMinimalViewModel().run,
          searchName: '<script>alert("search-name")</script>',
          warnings: ['<script>alert("warning")</script>'],
        },
        items: [maliciousItem],
        sourceErrors: [
          {
            sourceId: 'src-<script>',
            sourceStatus: 'NETWORK_ERROR',
            errorCode: 'ERR_<SCRIPT>',
            message: '<img src=x onerror=alert("err-msg")>',
            suggestedAction: '"><script>alert("action")</script>',
          },
        ],
      });

      const html = renderReport(vm);

      // Verify no unescaped tags exist in HTML
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('<img src=x');

      // Verify proper escaped entities appear in the output
      expect(html).toContain('&lt;script&gt;alert(&quot;xss-title&quot;)&lt;/script&gt;');
      expect(html).toContain('&quot;&gt;&lt;svg onload=alert(1)&gt;');
      expect(html).toContain(
        '&lt;/style&gt;&lt;script&gt;alert(&quot;css-breakout&quot;)&lt;/script&gt;',
      );
      expect(html).toContain('&#39; autofocus onfocus=&#39;alert(1)');
      expect(html).toContain('&lt;img src=x onerror=alert(&quot;price&quot;)&gt;');
      expect(html).toContain('&lt;script&gt;alert(&quot;search-name&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;script&gt;alert(&quot;warning&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(&quot;err-msg&quot;)&gt;');
      expect(html).toContain('&quot;&gt;&lt;script&gt;alert(&quot;action&quot;)&lt;/script&gt;');
    });
  });

  describe('URL Policy (validateSafeUrl)', () => {
    it('accepts valid HTTPS URLs and returns normalized href', () => {
      expect(validateSafeUrl('https://example.com/item/123')).toBe('https://example.com/item/123');
      expect(validateSafeUrl('https://facebook.com/marketplace/item/999?ref=search')).toBe(
        'https://facebook.com/marketplace/item/999?ref=search',
      );
    });

    it('rejects javascript:, data:, file:, and ftp: schemes', () => {
      expect(validateSafeUrl('javascript:alert(1)')).toBeNull();
      expect(validateSafeUrl('JAVASCRIPT:alert(document.cookie)')).toBeNull();
      expect(validateSafeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(validateSafeUrl('file:///etc/passwd')).toBeNull();
      expect(validateSafeUrl('ftp://example.com/file.txt')).toBeNull();
      expect(validateSafeUrl('mailto:test@example.com')).toBeNull();
    });

    it('rejects HTTP URLs to uphold strict HTTPS-only policy', () => {
      expect(validateSafeUrl('http://example.com/insecure')).toBeNull();
    });

    it('rejects URLs with embedded credentials (userinfo)', () => {
      expect(validateSafeUrl('https://user:password@example.com/secret')).toBeNull();
      expect(validateSafeUrl('https://admin@example.com/')).toBeNull();
    });

    it('rejects control characters, newlines, and malformed strings', () => {
      expect(validateSafeUrl('https://example.com/\x00evil')).toBeNull();
      expect(validateSafeUrl('https://example.com/\r\nevil')).toBeNull();
      expect(validateSafeUrl('not a url')).toBeNull();
      expect(validateSafeUrl('')).toBeNull();
      expect(validateSafeUrl(undefined)).toBeNull();
      expect(validateSafeUrl(null)).toBeNull();
    });

    it('renders disabled text when an item URL is invalid or unsafe', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-bad-url',
            title: 'Oferta sospechosa',
            source: 'test-source',
            url: 'javascript:alert(1)',
            imageUrl: 'data:image/png;base64,evil',
            novelty: 'NEW',
            decision: 'MATCH',
            reasons: [],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain('Enlace no disponible');
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('data:image/png');
    });

    it('renders rel="noopener noreferrer" and target="_blank" for safe HTTPS URLs', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-good-url',
            title: 'Nintendo Switch Lite Gris',
            source: 'facebook-marketplace',
            url: 'https://facebook.com/marketplace/item/123456',
            imageUrl: 'https://images.example.com/photo.jpg',
            novelty: 'NEW',
            decision: 'MATCH',
            reasons: [],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain(
        '<a href="https://facebook.com/marketplace/item/123456" target="_blank" rel="noopener noreferrer">Ver publicación</a>',
      );
      expect(html).toContain(
        '<a href="https://images.example.com/photo.jpg" target="_blank" rel="noopener noreferrer" class="image-link">Ver imagen</a>',
      );
    });
  });

  describe('Content Security Policy & Remote Assets', () => {
    it('includes strict meta CSP with default-src "none", script-src "none", img-src "none"', () => {
      const vm = createMinimalViewModel();
      const html = renderReport(vm);

      expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'none'");
      expect(html).toContain("img-src 'none'");
      expect(html).toContain("connect-src 'none'");
      expect(html).toContain("font-src 'none'");
    });

    it('contains ZERO <script> tags or CDN references', () => {
      const vm = createMinimalViewModel();
      const html = renderReport(vm);

      expect(html).not.toContain('<script');
      expect(html).not.toContain('cdnjs.cloudflare.com');
      expect(html).not.toContain('cdn.jsdelivr.net');
      expect(html).not.toContain('unpkg.com');
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('fonts.gstatic.com');
    });
  });

  describe('Semantic HTML, Accessibility and Structure', () => {
    it('generates a complete HTML5 document with lang="es" and landmarks', () => {
      const vm = createMinimalViewModel();
      const html = renderReport(vm);

      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toContain('<html lang="es">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      );
      expect(html).toContain('<header class="report-header">');
      expect(html).toContain('<main>');
      expect(html).toContain('<footer class="report-footer">');
      expect(html).toContain('<h1>Reporte de Oportunidades: Nintendo Switch Lite en AMBA</h1>');
    });

    it('renders sources table with caption, thead and th[scope="col"]', () => {
      const vm = createMinimalViewModel({
        run: {
          ...createMinimalViewModel().run,
          sources: [
            {
              sourceId: 'facebook-marketplace',
              collector: 'Playwright',
              sourceStatus: 'SUCCESS',
              itemsCount: 15,
            },
          ],
        },
      });

      const html = renderReport(vm);
      expect(html).toContain('<caption>Resumen de fuentes consultadas</caption>');
      expect(html).toContain('<th scope="col">Fuente</th>');
      expect(html).toContain('<th scope="col">Collector</th>');
      expect(html).toContain('<th scope="col">Estado</th>');
      expect(html).toContain('<th scope="col">Publicaciones</th>');
      expect(html).toContain('<td><strong>facebook-marketplace</strong></td>');
      expect(html).toContain('<td>Playwright</td>');
      expect(html).toContain('<td>15</td>');
    });

    it('renders REJECT section in native accessible <details> / <summary> collapsed by default', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-rej-1',
            title: 'PlayStation 4 Pro',
            source: 'facebook-marketplace',
            novelty: 'NEW',
            decision: 'REJECT',
            reasons: [{ code: 'WRONG_MODEL', message: 'No es Nintendo Switch', severity: 'HARD' }],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain('<details class="reject-details">');
      expect(html).not.toContain('<details class="reject-details" open>');
      expect(html).toContain('<summary class="reject-summary">');
      expect(html).toContain('Rechazadas (1)');
      expect(html).toContain('PlayStation 4 Pro');
      expect(html).toContain('WRONG_MODEL');
    });

    it('accompanies all status, decision, and novelty badges with explicit textual labels', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-match',
            title: 'Nintendo Switch Lite Turquesa',
            source: 'fb',
            decision: 'MATCH',
            novelty: 'PRICE_CHANGED',
            reasons: [{ code: 'PRICE_DROP', message: 'Bajó 10%', severity: 'INFO' }],
          },
          {
            id: 'item-rev',
            title: 'Nintendo Switch v2',
            source: 'fb',
            decision: 'REVIEW',
            novelty: 'REAPPEARED',
            reasons: [{ code: 'MODEL_AMBIGUOUS', message: 'Posible v2', severity: 'SOFT' }],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain('MATCH — Coincidencia');
      expect(html).toContain('REVIEW — Revisión');
      expect(html).toContain('Cambio de precio');
      expect(html).toContain('Reaparecida');
      expect(html).toContain('INFO');
      expect(html).toContain('SOFT');
    });

    it('does not contain positive tabindex attributes or inline onclick handlers', () => {
      const vm = createMinimalViewModel();
      const html = renderReport(vm);

      expect(html).not.toMatch(/tabindex\s*=\s*["'][1-9]/);
      expect(html).not.toContain('onclick=');
      expect(html).not.toContain('onload=');
    });
  });

  describe('Absence representation vs synthetic defaults', () => {
    it('honestly displays "No disponible" when score, rawPrice or resolvedPrice are undefined', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-no-price-no-score',
            title: 'Consola sin precio ni evaluación',
            source: 'synthetic',
            novelty: 'NEW',
            decision: 'MATCH',
            reasons: [],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain('<strong>Precio crudo:</strong> No disponible');
      expect(html).toContain('<strong>Precio resuelto:</strong> No disponible');
      expect(html).toContain('<strong>Puntaje (score):</strong> No disponible');
      expect(html).toContain('Sin razones registradas.');
      // Must not invent 0
      expect(html).not.toContain('<strong>Puntaje (score):</strong> 0');
    });

    it('renders price conversion when present with formatted display', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-with-price',
            title: 'Switch Lite Coral',
            source: 'marketplace',
            rawPrice: 'USD 180',
            resolvedPrice: { amount: 180, currency: 'USD', display: 'USD 180.00' },
            conversionArs: { amount: 234000, display: 'ARS 234.000,00' },
            score: 92,
            novelty: 'NEW',
            decision: 'MATCH',
            reasons: [
              {
                code: 'TITLE_MATCH',
                message: 'Coincide con búsqueda',
                severity: 'INFO',
                impact: 10,
              },
            ],
          },
        ],
      });

      const html = renderReport(vm);
      expect(html).toContain('<strong>Precio crudo:</strong> USD 180');
      expect(html).toContain('<strong>Precio resuelto:</strong> USD 180.00');
      expect(html).toContain('<strong>Conversión ARS:</strong> ARS 234.000,00');
      expect(html).toContain('<strong>Puntaje (score):</strong> 92');
      expect(html).toContain('(Impacto: 10)');
    });
  });

  describe('Zero results confirmed vs Source failure with 0 items', () => {
    it('shows prominent confirmed zero-results banner when run succeeds with ZERO_RESULTS_CONFIRMED and 0 items', () => {
      const vm = createMinimalViewModel({
        run: {
          ...createMinimalViewModel().run,
          globalStatus: 'SUCCESS',
          sources: [
            {
              sourceId: 'facebook-marketplace',
              sourceStatus: 'ZERO_RESULTS_CONFIRMED',
              collector: 'GraphQL',
              itemsCount: 0,
            },
          ],
        },
        items: [],
        sourceErrors: [],
      });

      const html = renderReport(vm);
      expect(html).toContain(
        '<strong>Búsqueda finalizada con éxito.</strong> Cero resultados confirmados en las fuentes consultadas.',
      );
      expect(html).toContain('No hay publicaciones MATCH.');
      expect(html).toContain('No hay publicaciones en revisión.');
      expect(html).toContain('Rechazadas (0)');
    });

    it('NEVER shows zero results confirmed banner when 0 items were returned due to source errors', () => {
      const vm = createMinimalViewModel({
        run: {
          ...createMinimalViewModel().run,
          globalStatus: 'FAILED',
          sources: [
            {
              sourceId: 'facebook-marketplace',
              sourceStatus: 'AUTHENTICATION_REQUIRED',
              collector: 'Playwright',
              itemsCount: 0,
            },
          ],
        },
        items: [],
        sourceErrors: [
          {
            sourceId: 'facebook-marketplace',
            sourceStatus: 'AUTHENTICATION_REQUIRED',
            errorCode: 'CHECKPOINT_REQUIRED',
            message: 'Se requiere iniciar sesión en Facebook para continuar.',
            suggestedAction: 'Iniciá sesión manualmente con el perfil configurado.',
            collector: 'Playwright',
          },
        ],
      });

      const html = renderReport(vm);
      // Zero results banner must NOT be present!
      expect(html).not.toContain('Cero resultados confirmados');
      // Source error must be prominent!
      expect(html).toContain('Errores de Fuente (1)');
      expect(html).toContain('CHECKPOINT_REQUIRED');
      expect(html).toContain('Se requiere iniciar sesión en Facebook para continuar.');
      expect(html).toContain('Iniciá sesión manualmente con el perfil configurado.');
    });
  });

  describe('Deterministic Ordering and Pure Rendering', () => {
    it('strictly orders MATCH items by score desc (undefined last), novelty ranking, price asc, and id', () => {
      const items: ReportItem[] = [
        {
          id: 'item-c',
          title: 'Item C - Score 80, New',
          source: 'src',
          score: 80,
          novelty: 'NEW',
          decision: 'MATCH',
          reasons: [],
        },
        {
          id: 'item-a',
          title: 'Item A - Score 95, Unchanged',
          source: 'src',
          score: 95,
          novelty: 'UNCHANGED',
          decision: 'MATCH',
          reasons: [],
        },
        {
          id: 'item-b',
          title: 'Item B - Score 95, New',
          source: 'src',
          score: 95,
          novelty: 'NEW',
          decision: 'MATCH',
          reasons: [],
        },
        {
          id: 'item-d',
          title: 'Item D - No Score, New',
          source: 'src',
          score: undefined,
          novelty: 'NEW',
          decision: 'MATCH',
          reasons: [],
        },
      ];

      const vm = createMinimalViewModel({ items });
      const html = renderReport(vm);

      // Expected order:
      // 1. item-b (score 95, NEW)
      // 2. item-a (score 95, UNCHANGED)
      // 3. item-c (score 80, NEW)
      // 4. item-d (score undefined, NEW)
      const posB = html.indexOf('id="item-item-b"');
      const posA = html.indexOf('id="item-item-a"');
      const posC = html.indexOf('id="item-item-c"');
      const posD = html.indexOf('id="item-item-d"');

      expect(posB).toBeGreaterThan(0);
      expect(posA).toBeGreaterThan(posB);
      expect(posC).toBeGreaterThan(posA);
      expect(posD).toBeGreaterThan(posC);
    });

    it('guarantees render(vm) === render(vm) (pure and deterministic output)', () => {
      const vm = createMinimalViewModel({
        items: [
          {
            id: 'item-1',
            title: 'Nintendo Switch Lite 🎮 Hurlingham Ñandú “Edición Especial”',
            source: 'fb',
            decision: 'MATCH',
            novelty: 'NEW',
            score: 88,
            reasons: [{ code: 'OK', message: 'Buen estado', severity: 'INFO' }],
          },
        ],
      });

      const html1 = renderReport(vm);
      const html2 = renderReport(vm);

      expect(html1).toBe(html2);
      expect(html1).toContain('Nintendo Switch Lite 🎮 Hurlingham Ñandú “Edición Especial”');
    });
  });
});
