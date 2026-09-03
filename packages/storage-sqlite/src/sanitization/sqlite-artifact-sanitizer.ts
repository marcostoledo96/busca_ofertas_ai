import type { ArtifactSanitizerPort } from '@busca-ofertas-ai/core';
import { sanitizeString, sanitizeObject } from './sanitizer.js';
import { validateNoSensitiveData } from './secret-detector.js';

/**
 * Concrete implementation of ArtifactSanitizerPort that reuses the proven
 * sanitization and secret-detection primitives of @busca-ofertas-ai/storage-sqlite.
 */
export class SqliteArtifactSanitizer implements ArtifactSanitizerPort {
  sanitizeText(text: string): string {
    return sanitizeString(text);
  }

  sanitizeData<T>(data: T): T {
    return sanitizeObject(data);
  }

  validateNoSensitiveData(data: unknown): void {
    validateNoSensitiveData(data, 'artifact');
  }
}

export function createSqliteArtifactSanitizer(): ArtifactSanitizerPort {
  return new SqliteArtifactSanitizer();
}
