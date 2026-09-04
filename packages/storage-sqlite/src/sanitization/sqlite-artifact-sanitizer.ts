import type { ArtifactSanitizerPort, SanitizerOptions } from '@busca-ofertas-ai/core';
import { sanitizeString, sanitizeObject } from './sanitizer.js';
import { validateNoSensitiveData } from './secret-detector.js';

/**
 * Concrete implementation of ArtifactSanitizerPort that reuses the proven
 * sanitization and secret-detection primitives of @busca-ofertas-ai/storage-sqlite.
 */
export class SqliteArtifactSanitizer implements ArtifactSanitizerPort {
  private readonly defaultOptions: SanitizerOptions | undefined;

  constructor(defaultOptions?: SanitizerOptions) {
    this.defaultOptions = defaultOptions;
  }

  private mergeOptions(options?: SanitizerOptions): SanitizerOptions | undefined {
    if (!this.defaultOptions && !options) {
      return undefined;
    }
    return {
      additionalSensitiveKeys: [
        ...(this.defaultOptions?.additionalSensitiveKeys ?? []),
        ...(options?.additionalSensitiveKeys ?? []),
      ],
      additionalSensitivePatterns: [
        ...(this.defaultOptions?.additionalSensitivePatterns ?? []),
        ...(options?.additionalSensitivePatterns ?? []),
      ],
    };
  }

  sanitizeText(text: string, options?: SanitizerOptions): string {
    return sanitizeString(text, this.mergeOptions(options));
  }

  sanitizeData<T>(data: T, options?: SanitizerOptions): T {
    return sanitizeObject(data, 0, this.mergeOptions(options));
  }

  validateNoSensitiveData(data: unknown, options?: SanitizerOptions): void {
    validateNoSensitiveData(data, 'artifact', 20, this.mergeOptions(options));
  }
}

export function createSqliteArtifactSanitizer(
  defaultOptions?: SanitizerOptions,
): ArtifactSanitizerPort {
  return new SqliteArtifactSanitizer(defaultOptions);
}
