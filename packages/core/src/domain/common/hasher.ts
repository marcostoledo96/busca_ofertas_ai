/**
 * Domain port for deterministic string hashing.
 * Pure and runtime-agnostic; concrete implementations live in infrastructure or adapter layers.
 */
export interface Hasher {
  hash(data: string): string;
}
