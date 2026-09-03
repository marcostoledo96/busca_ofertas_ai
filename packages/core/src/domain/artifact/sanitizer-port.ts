/**
 * Port representing the secret sanitization and detection capabilities required by the core domain.
 * Decouples core artifact services from concrete infrastructure or storage sanitizers.
 */
export interface ArtifactSanitizerPort {
  /**
   * Redacts known sensitive patterns (e.g. Bearer tokens, passwords, cookies) from strings.
   */
  sanitizeText(text: string): string;

  /**
   * Recursively sanitizes objects and arrays, replacing sensitive keys and values with redaction placeholders.
   */
  sanitizeData<T>(data: T): T;

  /**
   * Fail-closed validator: throws if any forbidden sensitive key or credential pattern is detected.
   * If a secret survives sanitization, this must throw to prevent persistence.
   */
  validateNoSensitiveData(data: unknown): void;
}
