import { type SourceUrlCanonicalizer, normalizeGenericUrl } from '@busca-ofertas-ai/core';
import { SYNTHETIC_ADAPTER_ID } from './types.js';

export class SyntheticUrlCanonicalizer implements SourceUrlCanonicalizer {
  readonly sourceId: string = SYNTHETIC_ADAPTER_ID;

  canonicalize(rawUrl: string): string {
    const normalized = normalizeGenericUrl(rawUrl, {
      dropTrackingParams: true,
      stripFragment: true,
      stripTrailingSlash: true,
    });
    const parsed = new URL(normalized);
    parsed.search = '';
    return parsed.toString();
  }
}
