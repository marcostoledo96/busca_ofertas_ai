/**
 * Strict HTML escaping primitives.
 *
 * All external text and attributes interpolated into HTML MUST pass through these functions.
 * Escapes characters with syntactic meaning in HTML: &, <, >, ", and '.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escapes a string for safe inclusion in HTML body or attribute contexts.
 */
export function escapeHtml(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  const str = String(value);
  return str.replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char] ?? char);
}
