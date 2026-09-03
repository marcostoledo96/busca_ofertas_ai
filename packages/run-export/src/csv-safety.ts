const DANGEROUS_FORMULA_PREFIX_REGEX = /^[ \t\r]*[=+\-@]/;

/**
 * Neutralizes spreadsheet formula injection in untrusted textual cells.
 * Prepends a single quote (') if the text begins with '=', '+', '-', or '@'
 * (preceded by optional whitespace).
 *
 * NOTE: Must ONLY be applied to textual columns, never to genuine numeric columns
 * (e.g., negative coordinates, amounts, scores).
 */
export function sanitizeSpreadsheetFormula(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }
  if (DANGEROUS_FORMULA_PREFIX_REGEX.test(text)) {
    return `'${text}`;
  }
  return text;
}
