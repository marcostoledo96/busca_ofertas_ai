export type SearchCategoryV1 = 'PRODUCT' | 'REAL_ESTATE' | 'VEHICLE';

export type ListingConditionV1 = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS' | 'UNKNOWN';

export type PriceCurrencyV1 = 'ARS' | 'USD' | 'UNKNOWN';

export type ForeignCurrencyModeV1 = 'MANUAL_RATE' | 'IGNORE' | 'STRICT';

export type ForeignCurrencyOnUnknownV1 = 'REVIEW' | 'REJECT';

export type LocationModeV1 = 'REGION' | 'RADIUS' | 'CUSTOM';

export type PrecisionProfileV1 = 'STRICT' | 'BALANCED' | 'PERMISSIVE' | 'MIXED';

export type RawArtifactsRetentionV1 = 'ERRORS_AND_REVIEW' | 'ALL' | 'NONE';

export type ReportIncludeRejectedV1 = 'COLLAPSED' | 'EXPANDED' | 'OMITTED';

export type ReportExportFormatV1 = 'HTML' | 'JSON' | 'CSV';

export interface SourceConfigurationV1 {
  readonly id: string;
  readonly enabled: boolean;
  readonly queries: readonly string[];
  readonly options?: Readonly<Record<string, unknown>> | undefined;
  readonly sessionRef?: string | undefined;
}

export interface LocationConfigurationV1 {
  readonly mode: LocationModeV1;
  readonly region?: string | undefined;
  readonly radiusKm?: number | undefined;
  readonly coordinates?:
    | {
        readonly latitude: number;
        readonly longitude: number;
      }
    | undefined;
}

export interface ForeignCurrencyPolicyV1 {
  readonly mode: ForeignCurrencyModeV1;
  readonly onUnknown: ForeignCurrencyOnUnknownV1;
}

export interface PriceConfigurationV1 {
  readonly targetCurrency: PriceCurrencyV1;
  readonly maximum?: number | null | undefined;
  readonly minimumPlausible?: number | null | undefined;
  readonly foreignCurrency?: ForeignCurrencyPolicyV1 | undefined;
}

export interface ConditionConfigurationV1 {
  readonly accepted: readonly ListingConditionV1[];
}

export interface ProductConfigurationV1 {
  readonly expectedModels?: readonly string[] | undefined;
  readonly requireFunctional?: boolean | undefined;
  readonly chargerRequired?: boolean | undefined;
  readonly boxRequired?: boolean | undefined;
}

export interface RulesConfigurationV1 {
  readonly profile?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface EvaluationConfigurationV1 {
  readonly matchThreshold: number;
  readonly reviewThreshold: number;
  readonly precisionProfile?: PrecisionProfileV1 | undefined;
}

export interface AiConfigurationV1 {
  readonly enabled: boolean;
  readonly evaluateOnlyReview: boolean;
  readonly provider?: string | undefined;
  readonly requireConfirmation: boolean;
  readonly maxEvaluationsPerRun: number;
}

export interface RetentionConfigurationV1 {
  readonly rawArtifacts: RawArtifactsRetentionV1;
  readonly rawDataDays: number;
}

export interface ReportConfigurationV1 {
  readonly openAutomatically?: boolean | undefined;
  readonly includeRejected?: ReportIncludeRejectedV1 | undefined;
  readonly exports?: readonly ReportExportFormatV1[] | undefined;
}

export interface SavedSearchConfigurationV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly category: SearchCategoryV1;
  readonly sources: readonly SourceConfigurationV1[];
  readonly location?: LocationConfigurationV1 | null | undefined;
  readonly price?: PriceConfigurationV1 | null | undefined;
  readonly condition?: ConditionConfigurationV1 | null | undefined;
  readonly product?: ProductConfigurationV1 | undefined;
  readonly rules?: RulesConfigurationV1 | undefined;
  readonly evaluation: EvaluationConfigurationV1;
  readonly ai: AiConfigurationV1;
  readonly retention: RetentionConfigurationV1;
  readonly report?: ReportConfigurationV1 | undefined;
}
