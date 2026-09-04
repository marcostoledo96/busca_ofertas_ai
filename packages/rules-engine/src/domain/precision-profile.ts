import { type EvaluationSeverity, InvariantViolationError } from '@busca-ofertas-ai/core';

export type StandardPrecisionProfile = 'STRICT' | 'BALANCED' | 'PERMISSIVE' | 'MIXED';

export interface PrecisionProfileConfig {
  readonly name: string;
  readonly description?: string;
  readonly matchThresholdModifier: number;
  readonly reviewThresholdModifier: number;
  readonly ambiguousPriceSeverity: EvaluationSeverity;
  readonly missingPriceSeverity: EvaluationSeverity;
  readonly defaultBaseScore: number;
}

export const STANDARD_PROFILES: Readonly<Record<StandardPrecisionProfile, PrecisionProfileConfig>> =
  {
    STRICT: {
      name: 'STRICT',
      description:
        'Prioritizes high precision. Strict thresholds and treats price ambiguities as HARD rejections.',
      matchThresholdModifier: 5,
      reviewThresholdModifier: 5,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    },
    BALANCED: {
      name: 'BALANCED',
      description: 'Standard balance between precision and recall.',
      matchThresholdModifier: 0,
      reviewThresholdModifier: 0,
      ambiguousPriceSeverity: 'SOFT',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    },
    PERMISSIVE: {
      name: 'PERMISSIVE',
      description:
        'High recall tolerance. Relaxed thresholds, treating minor ambiguities as informative.',
      matchThresholdModifier: -5,
      reviewThresholdModifier: -5,
      ambiguousPriceSeverity: 'INFO',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    },
    MIXED: {
      name: 'MIXED',
      description:
        'Default hybrid profile combining soft positive and negative signals with balanced thresholds.',
      matchThresholdModifier: 0,
      reviewThresholdModifier: 0,
      ambiguousPriceSeverity: 'SOFT',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    },
  };

/**
 * Extensible registry for precision profiles.
 * Allows domain/product extensions in future issues without modifying the generic evaluator.
 */
export class PrecisionProfileRegistry {
  private readonly profiles = new Map<string, PrecisionProfileConfig>();

  constructor() {
    // Register standard profiles by default
    for (const profile of Object.values(STANDARD_PROFILES)) {
      this.profiles.set(profile.name.toUpperCase(), profile);
    }
  }

  public register(profile: PrecisionProfileConfig): void {
    if (!profile || typeof profile.name !== 'string' || profile.name.trim().length === 0) {
      throw new InvariantViolationError('Precision profile must declare a non-empty name');
    }
    const key = profile.name.trim().toUpperCase();
    this.profiles.set(key, {
      ...profile,
      name: key,
    });
  }

  public get(name: string): PrecisionProfileConfig {
    const key = name.trim().toUpperCase();
    const found = this.profiles.get(key);
    if (!found) {
      throw new InvariantViolationError(`Unknown precision profile: '${name}'`);
    }
    return found;
  }

  public has(name: string): boolean {
    return this.profiles.has(name.trim().toUpperCase());
  }

  public list(): readonly PrecisionProfileConfig[] {
    return Array.from(this.profiles.values());
  }
}

export const defaultPrecisionProfileRegistry = new PrecisionProfileRegistry();
