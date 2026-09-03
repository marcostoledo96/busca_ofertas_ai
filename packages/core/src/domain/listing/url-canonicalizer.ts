import { InvariantViolationError } from '../common/index.js';
import type { Hasher } from '../common/hasher.js';

export const FALLBACK_EXTERNAL_ID_NAMESPACE = 'urn:boai:fallback:url:' as const;

export function isFallbackExternalId(externalId: string): boolean {
  return typeof externalId === 'string' && externalId.startsWith(FALLBACK_EXTERNAL_ID_NAMESPACE);
}

export function createFallbackExternalId(canonicalUrl: string, hasher: Hasher): string {
  if (typeof canonicalUrl !== 'string' || canonicalUrl.trim().length === 0) {
    throw new InvariantViolationError('Cannot create fallback externalId from empty canonicalUrl');
  }
  if (!hasher || typeof hasher.hash !== 'function') {
    throw new InvariantViolationError(
      'A valid Hasher must be provided to create fallback externalId',
    );
  }
  const hash = hasher.hash(canonicalUrl.trim());
  if (typeof hash !== 'string' || hash.trim().length === 0) {
    throw new InvariantViolationError('Hasher returned an empty hash for canonicalUrl');
  }
  return `${FALLBACK_EXTERNAL_ID_NAMESPACE}${hash.trim()}`;
}

export interface NormalizeGenericUrlOptions {
  readonly dropQueryParams?: readonly string[];
  readonly dropTrackingParams?: boolean;
  readonly sortQueryParams?: boolean;
  readonly stripFragment?: boolean;
  readonly stripTrailingSlash?: boolean;
}

const COMMON_TRACKING_PARAM_PREFIXES = ['utm_'];
const COMMON_TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'ref_src',
  'ref_url',
]);

export function normalizeGenericUrl(
  rawUrl: string,
  options: NormalizeGenericUrlOptions = {},
): string {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new InvariantViolationError('Cannot canonicalize empty URL string');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    throw new InvariantViolationError(
      `Invalid URL string cannot be canonicalized: '${rawUrl}' (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // Scheme and host to lowercase
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip default ports
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Strip fragment
  if (options.stripFragment !== false) {
    parsed.hash = '';
  }

  // Path normalization: strip multiple slashes and trailing slash (except root '/')
  let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  if (options.stripTrailingSlash !== false && pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  // Query parameter normalization
  const dropCustom = new Set((options.dropQueryParams ?? []).map((p) => p.trim().toLowerCase()));
  const dropTracking = options.dropTrackingParams !== false;

  const entries: Array<[string, string]> = [];
  parsed.searchParams.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    if (dropCustom.has(lowerKey)) {
      return;
    }
    if (
      dropTracking &&
      (COMMON_TRACKING_PARAMS.has(lowerKey) ||
        COMMON_TRACKING_PARAM_PREFIXES.some((prefix) => lowerKey.startsWith(prefix)))
    ) {
      return;
    }
    entries.push([key, val]);
  });

  if (options.sortQueryParams !== false) {
    entries.sort((a, b) => {
      const cmpKey = a[0].localeCompare(b[0]);
      return cmpKey !== 0 ? cmpKey : a[1].localeCompare(b[1]);
    });
  }

  // Rebuild search parameters deterministically
  parsed.search = '';
  for (const [k, v] of entries) {
    parsed.searchParams.append(k, v);
  }

  return parsed.toString();
}

/**
 * Strategy interface for source-specific URL canonicalization.
 * Implemented per source (e.g. synthetic, facebook, mercadolibre) outside of core.
 */
export interface SourceUrlCanonicalizer {
  readonly sourceId: string;
  canonicalize(rawUrl: string): string;
}

/**
 * Registry and dispatcher for source-specific canonicalizers.
 * Falls back to deterministic generic normalization if no source-specific strategy is registered.
 */
export class UrlCanonicalizerRegistry {
  private readonly canonicalizers = new Map<string, SourceUrlCanonicalizer>();

  register(canonicalizer: SourceUrlCanonicalizer): void {
    if (
      !canonicalizer ||
      typeof canonicalizer.sourceId !== 'string' ||
      canonicalizer.sourceId.trim().length === 0
    ) {
      throw new InvariantViolationError('Canonicalizer must provide a non-empty sourceId');
    }
    if (typeof canonicalizer.canonicalize !== 'function') {
      throw new InvariantViolationError(
        `Canonicalizer for source '${canonicalizer.sourceId}' must implement canonicalize()`,
      );
    }
    this.canonicalizers.set(canonicalizer.sourceId.trim(), canonicalizer);
  }

  get(sourceId: string): SourceUrlCanonicalizer | undefined {
    return this.canonicalizers.get(sourceId.trim());
  }

  canonicalize(sourceId: string, rawUrl: string): string {
    const canonicalizer = this.get(sourceId);
    if (canonicalizer) {
      return canonicalizer.canonicalize(rawUrl);
    }
    return normalizeGenericUrl(rawUrl);
  }
}
