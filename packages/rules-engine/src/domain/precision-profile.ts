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
  Object.freeze({
    STRICT: Object.freeze({
      name: 'STRICT',
      description:
        'Prioritizes high precision. Strict thresholds and treats price ambiguities as HARD rejections.',
      matchThresholdModifier: 5,
      reviewThresholdModifier: 5,
      ambiguousPriceSeverity: 'HARD',
      missingPriceSeverity: 'HARD',
      defaultBaseScore: 0,
    }),
    BALANCED: Object.freeze({
      name: 'BALANCED',
      description: 'Standard balance between precision and recall.',
      matchThresholdModifier: 0,
      reviewThresholdModifier: 0,
      ambiguousPriceSeverity: 'SOFT',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    }),
    PERMISSIVE: Object.freeze({
      name: 'PERMISSIVE',
      description:
        'High recall tolerance. Relaxed thresholds, treating minor ambiguities as informative.',
      matchThresholdModifier: -5,
      reviewThresholdModifier: -5,
      ambiguousPriceSeverity: 'INFO',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    }),
    MIXED: Object.freeze({
      name: 'MIXED',
      description:
        'Default hybrid profile combining soft positive and negative signals with balanced thresholds.',
      matchThresholdModifier: 0,
      reviewThresholdModifier: 0,
      ambiguousPriceSeverity: 'SOFT',
      missingPriceSeverity: 'SOFT',
      defaultBaseScore: 0,
    }),
  });

/**
 * Type guard for standard precision profile names.
 */
export const isStandardPrecisionProfile = (name: string): name is StandardPrecisionProfile => {
  const upper = name.trim().toUpperCase();
  return upper in STANDARD_PROFILES;
};

/**
 * Pure, stateless resolver for standard precision profiles.
 * Never references or mutates any global state.
 */
export const resolveStandardPrecisionProfile = (name: string): PrecisionProfileConfig => {
  const upper = name.trim().toUpperCase() as StandardPrecisionProfile;
  const found = STANDARD_PROFILES[upper];
  if (!found) {
    throw new InvariantViolationError(`Unknown standard precision profile: '${name}'`);
  }
  return found;
};

export interface PrecisionProfileRegistryOptions {
  readonly includeStandardProfiles?: boolean;
}

/**
 * Extensible registry for precision profiles.
 * Custom registries must be instantiated explicitly and never pollute standard evaluation.
 */
export class PrecisionProfileRegistry {
  private readonly profiles = new Map<string, PrecisionProfileConfig>();

  constructor(options?: PrecisionProfileRegistryOptions) {
    const includeStandard = options?.includeStandardProfiles ?? true;
    if (includeStandard) {
      for (const profile of Object.values(STANDARD_PROFILES)) {
        this.profiles.set(profile.name.toUpperCase(), profile);
      }
    }
  }

  public register(profile: PrecisionProfileConfig): void {
    if (!profile || typeof profile.name !== 'string' || profile.name.trim().length === 0) {
      throw new InvariantViolationError('Precision profile must declare a non-empty name');
    }
    const key = profile.name.trim().toUpperCase();
    const defensiveClone: PrecisionProfileConfig = Object.freeze({
      name: key,
      ...(profile.description !== undefined ? { description: profile.description } : {}),
      matchThresholdModifier: profile.matchThresholdModifier,
      reviewThresholdModifier: profile.reviewThresholdModifier,
      ambiguousPriceSeverity: profile.ambiguousPriceSeverity,
      missingPriceSeverity: profile.missingPriceSeverity,
      defaultBaseScore: profile.defaultBaseScore,
    });
    this.profiles.set(key, defensiveClone);
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
    return Object.freeze(Array.from(this.profiles.values()));
  }
}
