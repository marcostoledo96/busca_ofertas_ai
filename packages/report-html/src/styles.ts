/**
 * Autocontained inline CSS for Busca Ofertas AI local HTML report.
 *
 * Accessibility & Design properties:
 * - High-contrast palette compliant with WCAG AA.
 * - System font stack without external font downloads.
 * - Clear visual hierarchy and focus-visible indicators.
 * - Responsive layout adapted to desktop (1280px+) and mobile (360px+).
 * - Information never conveyed by color alone.
 */

export const REPORT_CSS = `
*, *::before, *::after {
  box-sizing: border-box;
}

:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
  --color-bg: #f8f9fa;
  --color-surface: #ffffff;
  --color-text: #212529;
  --color-text-muted: #595959;
  --color-border: #d0d7de;
  --color-border-subtle: #eaeef2;

  --color-match-bg: #e6f4ea;
  --color-match-border: #2e7d32;
  --color-match-text: #1b5e20;

  --color-review-bg: #fff8e1;
  --color-review-border: #f57f17;
  --color-review-text: #e65100;

  --color-reject-bg: #fbe9e7;
  --color-reject-border: #d32f2f;
  --color-reject-text: #b71c1c;

  --color-info-bg: #e3f2fd;
  --color-info-border: #0288d1;
  --color-info-text: #01579b;

  --color-focus: #0969da;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.5;
  color: var(--color-text);
  background-color: var(--color-bg);
}

a {
  color: var(--color-focus);
  text-decoration: underline;
}

a:hover {
  text-decoration: none;
}

:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}

.report-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}

@media (max-width: 600px) {
  .report-container {
    padding: 0.75rem;
  }
}

/* Header */
.report-header {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.header-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

h1 {
  font-size: 1.75rem;
  margin: 0;
  font-weight: 700;
  line-height: 1.25;
}

h2 {
  font-size: 1.35rem;
  margin-top: 2rem;
  margin-bottom: 1rem;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

h3 {
  font-size: 1.1rem;
  margin: 0 0 0.5rem 0;
  font-weight: 600;
}

/* Badges */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.6rem;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid transparent;
  line-height: 1.2;
}

.badge-status-SUCCESS {
  background: var(--color-match-bg);
  border-color: var(--color-match-border);
  color: var(--color-match-text);
}

.badge-status-PARTIAL_SUCCESS {
  background: var(--color-review-bg);
  border-color: var(--color-review-border);
  color: var(--color-review-text);
}

.badge-status-FAILED {
  background: var(--color-reject-bg);
  border-color: var(--color-reject-border);
  color: var(--color-reject-text);
}

.badge-status-CANCELLED {
  background: #eeeeee;
  border-color: #757575;
  color: #424242;
}

.badge-decision-MATCH {
  background: var(--color-match-bg);
  border-color: var(--color-match-border);
  color: var(--color-match-text);
}

.badge-decision-REVIEW {
  background: var(--color-review-bg);
  border-color: var(--color-review-border);
  color: var(--color-review-text);
}

.badge-decision-REJECT {
  background: var(--color-reject-bg);
  border-color: var(--color-reject-border);
  color: var(--color-reject-text);
}

.badge-severity-HARD {
  background: var(--color-reject-bg);
  border-color: var(--color-reject-border);
  color: var(--color-reject-text);
}

.badge-severity-SOFT {
  background: var(--color-review-bg);
  border-color: var(--color-review-border);
  color: var(--color-review-text);
}

.badge-severity-INFO {
  background: var(--color-info-bg);
  border-color: var(--color-info-border);
  color: var(--color-info-text);
}

.badge-novelty {
  background: #ede7f6;
  border-color: #7e57c2;
  color: #4527a0;
}

/* Metadata grid */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  font-size: 0.95rem;
}

.meta-item strong {
  display: block;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted);
}

/* Metrics summary */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.75rem;
  background: var(--color-bg);
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
}

.metric-card {
  text-align: center;
}

.metric-value {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.2;
}

.metric-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  font-weight: 600;
}

/* Banners and notices */
.banner {
  padding: 1rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-size: 0.95rem;
  border: 1px solid transparent;
}

.banner-warnings {
  background: var(--color-review-bg);
  border-color: var(--color-review-border);
  color: var(--color-review-text);
}

.banner-warnings ul {
  margin: 0.5rem 0 0 1.25rem;
  padding: 0;
}

.banner-zero-results {
  background: var(--color-info-bg);
  border-color: var(--color-info-border);
  color: var(--color-info-text);
}

/* Empty states */
.empty-state {
  padding: 1.25rem;
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  text-align: center;
  font-style: italic;
  margin: 1rem 0;
}

/* Tables */
.table-responsive {
  overflow-x: auto;
  margin: 1rem 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
}

table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.95rem;
}

caption {
  padding: 0.75rem;
  font-weight: 600;
  text-align: left;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

th, td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-subtle);
  vertical-align: top;
}

th {
  background: #f1f3f5;
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

tr:last-child td {
  border-bottom: none;
}

/* Cards grid */
.cards-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1rem 0;
}

.item-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem;
  border-left-width: 6px;
}

.card-MATCH {
  border-left-color: var(--color-match-border);
}

.card-REVIEW {
  border-left-color: var(--color-review-border);
}

.card-REJECT {
  border-left-color: var(--color-reject-border);
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.card-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  flex: 1 1 300px;
}

.card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.card-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.5rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  background: var(--color-bg);
  padding: 0.75rem;
  border-radius: 6px;
}

.card-detail-item strong {
  color: var(--color-text-muted);
}

/* Reasons */
.reasons-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border-subtle);
}

.reasons-title {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.reason-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
}

.reason-code {
  font-family: monospace;
  font-weight: 600;
  background: #eaeef2;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.85rem;
}

.reason-evidence {
  width: 100%;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin-left: 1.5rem;
  font-style: italic;
}

/* Details/Summary for REJECT */
.reject-details {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin: 1.5rem 0;
  overflow: hidden;
}

.reject-summary {
  padding: 1rem 1.25rem;
  cursor: pointer;
  background: #fdf7f7;
  border-bottom: 1px solid transparent;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
}

.reject-details[open] .reject-summary {
  border-bottom-color: var(--color-border);
}

.reject-summary-title {
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.reject-summary-hint {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-weight: normal;
}

.reject-content {
  padding: 1rem;
}

/* Source Errors */
.error-card {
  background: var(--color-surface);
  border: 1px solid var(--color-reject-border);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.error-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.error-action {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #fff8e1;
  border-left: 4px solid #ffb300;
  border-radius: 4px;
  font-size: 0.9rem;
}

/* Footer */
.report-footer {
  margin-top: 3rem;
  padding: 1.5rem 0;
  border-top: 1px solid var(--color-border);
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.url-disabled {
  color: var(--color-text-muted);
  font-style: italic;
}
`;
