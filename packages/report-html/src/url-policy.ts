/**
 * Strict URL validation policy for Busca Ofertas AI local HTML reports.
 *
 * Requirements:
 * - HTTPS only.
 * - Rejects javascript:, data:, file:, http:, ftp:, mailto:, and any non-https schemes.
 * - Rejects URLs containing embedded userinfo / credentials (username or password).
 * - Rejects control characters and malformed URLs.
 * - Returns sanitized URL string or null.
 */

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export function validateSafeUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Reject raw control characters or unexpected newlines
  if (hasControlCharacters(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);

    // Enforce HTTPS-only protocol
    if (parsed.protocol !== 'https:') {
      return null;
    }

    // Reject embedded credentials (e.g. https://user:pass@example.com)
    if (parsed.username || parsed.password) {
      return null;
    }

    // Ensure host is present
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}
