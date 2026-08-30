import { InvariantViolationError } from '../common/index.js';
import { PriceCurrency } from '../price/resolved-price.js';
import { ListingCondition } from '../listing/types.js';

export type SearchCategory = 'PRODUCT' | 'REAL_ESTATE' | 'VEHICLE';

export interface SourceSearchConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly queries: readonly string[];
  readonly options?: Readonly<Record<string, unknown>>;
  readonly sessionRef?: string;
}

export interface QueryPolicy {
  readonly terms: readonly string[];
  readonly excludedTerms?: readonly string[];
}

export interface PricePolicy {
  readonly targetCurrency: PriceCurrency;
  readonly maximum?: number | null;
  readonly minimumPlausible?: number | null;
  readonly foreignCurrency?: {
    readonly mode: 'MANUAL_RATE' | 'IGNORE' | 'STRICT';
    readonly onUnknown: 'REVIEW' | 'REJECT';
  };
}

export interface LocationPolicy {
  readonly mode: 'REGION' | 'RADIUS' | 'CUSTOM';
  readonly region?: string;
  readonly radiusKm?: number;
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
}

export interface ConditionPolicy {
  readonly accepted: readonly ListingCondition[];
}

export interface RuleExpression {
  readonly id: string;
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface EvaluationPolicy {
  readonly matchThreshold: number;
  readonly reviewThreshold: number;
  readonly precisionProfile?: 'STRICT' | 'BALANCED' | 'PERMISSIVE' | 'MIXED';
}

export interface AiPolicy {
  readonly enabled: boolean;
  readonly evaluateOnlyReview: boolean;
  readonly provider?: string;
  readonly requireConfirmation: boolean;
  readonly maxEvaluationsPerRun: number;
}

export interface RetentionPolicy {
  readonly rawArtifacts: 'ERRORS_AND_REVIEW' | 'ALL' | 'NONE';
  readonly rawDataDays: number;
}

export interface SavedSearch {
  readonly id: string;
  readonly schemaVersion: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly category: SearchCategory;
  readonly sourceConfigs: readonly SourceSearchConfig[];
  readonly query: QueryPolicy;
  readonly price: PricePolicy | null;
  readonly location: LocationPolicy | null;
  readonly condition: ConditionPolicy | null;
  readonly rules: readonly RuleExpression[];
  readonly evaluation: EvaluationPolicy;
  readonly ai: AiPolicy;
  readonly retention: RetentionPolicy;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSavedSearchParams {
  readonly id: string;
  readonly schemaVersion: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly category: SearchCategory;
  readonly sourceConfigs: readonly SourceSearchConfig[];
  readonly query: QueryPolicy;
  readonly price?: PricePolicy | null;
  readonly location?: LocationPolicy | null;
  readonly condition?: ConditionPolicy | null;
  readonly rules?: readonly RuleExpression[];
  readonly evaluation: EvaluationPolicy;
  readonly ai: AiPolicy;
  readonly retention: RetentionPolicy;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const createSavedSearch = (params: CreateSavedSearchParams): SavedSearch => {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvariantViolationError('SavedSearch id cannot be empty');
  }
  if (
    typeof params.schemaVersion !== 'number' ||
    !Number.isInteger(params.schemaVersion) ||
    params.schemaVersion < 1
  ) {
    throw new InvariantViolationError('SavedSearch schemaVersion must be an integer >= 1');
  }
  if (typeof params.name !== 'string' || params.name.trim().length === 0) {
    throw new InvariantViolationError('SavedSearch name cannot be empty');
  }
  if (!['PRODUCT', 'REAL_ESTATE', 'VEHICLE'].includes(params.category)) {
    throw new InvariantViolationError(`Invalid SearchCategory: ${String(params.category)}`);
  }
  if (!Array.isArray(params.sourceConfigs) || params.sourceConfigs.length === 0) {
    throw new InvariantViolationError('SavedSearch must configure at least one source');
  }
  if (
    typeof params.evaluation.matchThreshold !== 'number' ||
    !Number.isFinite(params.evaluation.matchThreshold) ||
    params.evaluation.matchThreshold < 0 ||
    params.evaluation.matchThreshold > 100
  ) {
    throw new InvariantViolationError(
      'SavedSearch evaluation.matchThreshold must be between 0 and 100',
    );
  }
  if (
    typeof params.evaluation.reviewThreshold !== 'number' ||
    !Number.isFinite(params.evaluation.reviewThreshold) ||
    params.evaluation.reviewThreshold < 0 ||
    params.evaluation.reviewThreshold > 100
  ) {
    throw new InvariantViolationError(
      'SavedSearch evaluation.reviewThreshold must be between 0 and 100',
    );
  }
  if (params.evaluation.matchThreshold <= params.evaluation.reviewThreshold) {
    throw new InvariantViolationError(
      'SavedSearch evaluation.matchThreshold must be greater than reviewThreshold',
    );
  }

  if (params.price?.maximum !== undefined && params.price.maximum !== null) {
    if (params.price.minimumPlausible !== undefined && params.price.minimumPlausible !== null) {
      if (params.price.maximum < params.price.minimumPlausible) {
        throw new InvariantViolationError(
          'SavedSearch price.maximum cannot be less than minimumPlausible',
        );
      }
    }
  }

  if (!(params.createdAt instanceof Date) || Number.isNaN(params.createdAt.getTime())) {
    throw new InvariantViolationError('SavedSearch createdAt must be a valid Date');
  }
  if (!(params.updatedAt instanceof Date) || Number.isNaN(params.updatedAt.getTime())) {
    throw new InvariantViolationError('SavedSearch updatedAt must be a valid Date');
  }

  const mappedSourceConfigs: SourceSearchConfig[] = params.sourceConfigs.map(
    (cfg: SourceSearchConfig): SourceSearchConfig => ({
      id: cfg.id,
      enabled: cfg.enabled,
      queries: [...cfg.queries],
      ...(cfg.options !== undefined ? { options: cfg.options } : {}),
      ...(cfg.sessionRef !== undefined ? { sessionRef: cfg.sessionRef } : {}),
    }),
  );

  return {
    id: params.id.trim(),
    schemaVersion: params.schemaVersion,
    name: params.name.trim(),
    enabled: params.enabled,
    category: params.category,
    sourceConfigs: mappedSourceConfigs,
    query: {
      terms: [...params.query.terms],
      ...(params.query.excludedTerms !== undefined
        ? { excludedTerms: [...params.query.excludedTerms] }
        : {}),
    },
    price: params.price ?? null,
    location: params.location ?? null,
    condition: params.condition ? { accepted: [...params.condition.accepted] } : null,
    rules: params.rules ? [...params.rules] : [],
    evaluation: { ...params.evaluation },
    ai: { ...params.ai },
    retention: { ...params.retention },
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
};
