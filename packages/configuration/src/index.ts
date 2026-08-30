/**
 * @busca-ofertas-ai/configuration
 *
 * Versioned configuration schema, YAML codecs, migrations, and SourceRegistry
 * for Busca Ofertas AI.
 */

// Error Model
export {
  CONFIGURATION_ERROR_CODES,
  type ConfigurationErrorCode,
  isConfigurationErrorCode,
} from './errors/error-codes.js';

export {
  type ConfigurationIssue,
  type ConfigurationErrorParams,
  type SerializedConfigurationError,
  ConfigurationError,
  isConfigurationError,
} from './errors/configuration-error.js';

// Security & Secret Scanning
export { type SecretViolation, detectForbiddenSecrets } from './security/secret-detector.js';

// Schema v1 Types & Validators
export {
  MAX_PAGES_LIMIT,
  MAX_ITEMS_LIMIT,
  savedSearchSchemaV1,
  type SavedSearchSchemaV1Type,
} from './schema/v1/saved-search-schema-v1.js';

export type {
  SearchCategoryV1,
  ListingConditionV1,
  PriceCurrencyV1,
  ForeignCurrencyModeV1,
  ForeignCurrencyOnUnknownV1,
  LocationModeV1,
  PrecisionProfileV1,
  RawArtifactsRetentionV1,
  ReportIncludeRejectedV1,
  ReportExportFormatV1,
  SourceConfigurationV1,
  LocationConfigurationV1,
  ForeignCurrencyPolicyV1,
  PriceConfigurationV1,
  ConditionConfigurationV1,
  ProductConfigurationV1,
  RulesConfigurationV1,
  EvaluationConfigurationV1,
  AiConfigurationV1,
  RetentionConfigurationV1,
  ReportConfigurationV1,
  SavedSearchConfigurationV1,
} from './schema/v1/types.js';

// Migrations
export type { MigrationStep, MigrationResult } from './migrations/migration-types.js';
export { MigrationRegistry, defaultMigrationRegistry } from './migrations/migration-registry.js';

// Source Registry
export type {
  SourceDescriptor,
  SourceRegistryStatus,
  SourceRegistryState,
  SourceRegistryEntry,
  RegisterSourceEntryParams,
} from './registry/registry-types.js';
export { SourceRegistry } from './registry/source-registry.js';

// Capability Cross-Validation
export {
  type RequiredCapabilityRequirement,
  deriveRequiredCapabilities,
  validateSearchCapabilities,
} from './capabilities/capability-validator.js';

// Codecs & Codec Parsers
export {
  type ParseSavedSearchYamlOptions,
  validateSavedSearchConfiguration,
  parseSavedSearchYaml,
  serializeSavedSearchYaml,
} from './codecs/yaml-codec.js';

// Domain Projection
export {
  type ToDomainSavedSearchOptions,
  toDomainSavedSearch,
} from './domain/domain-projection.js';

// Package Metadata
export const CONFIGURATION_PACKAGE_NAME = '@busca-ofertas-ai/configuration' as const;

export interface ConfigurationPackageMetadata {
  readonly name: typeof CONFIGURATION_PACKAGE_NAME;
  readonly version: string;
  readonly initialized: boolean;
}

export const getConfigurationPackageMetadata = (): ConfigurationPackageMetadata => ({
  name: CONFIGURATION_PACKAGE_NAME,
  version: '0.1.0',
  initialized: true,
});
