import type { Clock, SavedSearch } from '@busca-ofertas-ai/core';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { toDomainSavedSearch } from '../domain/domain-projection.js';
import { ConfigurationError, type ConfigurationIssue } from '../errors/configuration-error.js';
import { isConfigurationErrorCode, type ConfigurationErrorCode } from '../errors/error-codes.js';
import { defaultMigrationRegistry, MigrationRegistry } from '../migrations/migration-registry.js';
import { savedSearchSchemaV1 } from '../schema/v1/saved-search-schema-v1.js';
import type { SavedSearchConfigurationV1 } from '../schema/v1/types.js';
import { detectForbiddenSecrets } from '../security/secret-detector.js';

export interface ParseSavedSearchYamlOptions {
  readonly migrationRegistry?: MigrationRegistry | undefined;
  readonly targetVersion?: number | undefined;
}

export interface ImportedSavedSearchConfiguration {
  readonly configuration: SavedSearchConfigurationV1;
  readonly savedSearch: SavedSearch;
}

export interface ImportSavedSearchYamlOptions extends ParseSavedSearchYamlOptions {
  readonly clock?: Clock | undefined;
  readonly createdAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

const formatZodPath = (path: Array<string | number>): string => {
  if (path.length === 0) return '';
  let result = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      result += `[${segment}]`;
    } else if (result.length > 0) {
      result += `.${segment}`;
    } else {
      result = segment;
    }
  }
  return result;
};

const mapZodIssuesToConfigurationIssues = (error: ZodError): ConfigurationIssue[] => {
  return error.issues.map((issue) => {
    const formattedPath = formatZodPath(issue.path);
    const params =
      'params' in issue && typeof issue.params === 'object' && issue.params !== null
        ? (issue.params as Record<string, unknown>)
        : undefined;
    const explicitCode =
      typeof params?.['code'] === 'string' && isConfigurationErrorCode(params['code'])
        ? params['code']
        : undefined;
    const suggestion =
      typeof params?.['suggestion'] === 'string' ? params['suggestion'] : undefined;

    let code: ConfigurationErrorCode = explicitCode ?? 'CONFIG_SCHEMA_VALIDATION_ERROR';

    if (!explicitCode) {
      if (formattedPath === 'schemaVersion') {
        code = 'CONFIG_SCHEMA_VERSION_REQUIRED';
      }
    }

    return {
      code,
      path: formattedPath,
      message: issue.message,
      ...(suggestion !== undefined ? { suggestion } : {}),
    };
  });
};

export const validateSavedSearchConfiguration = (doc: unknown): SavedSearchConfigurationV1 => {
  // 1. Recursive forbidden secret and depth scan on raw input document
  const secretViolations = detectForbiddenSecrets(doc);
  if (secretViolations.length > 0) {
    const issues: ConfigurationIssue[] = secretViolations.map((violation) => {
      if (violation.code === 'CONFIG_MAX_DEPTH_EXCEEDED') {
        return {
          code: 'CONFIG_MAX_DEPTH_EXCEEDED' as const,
          path: violation.path,
          message: 'Configuration nesting exceeds supported maximum depth.',
          suggestion: 'Flatten source.options or reduce object nesting.',
        };
      }
      return {
        code: 'CONFIG_SECRET_FORBIDDEN' as const,
        path: violation.path,
        message: `Inline secret is forbidden at ${violation.path}. Use sessionRef or SecretProvider.`,
        suggestion: `Remove inline secret key "${violation.key}" and reference credentials via sessionRef or SecretProvider.`,
      };
    });
    const primary = issues[0]!;
    throw new ConfigurationError({
      code: primary.code,
      path: primary.path,
      message: primary.message,
      ...(primary.suggestion !== undefined ? { suggestion: primary.suggestion } : {}),
      issues,
    });
  }

  // 2. Schema validation
  const result = savedSearchSchemaV1.safeParse(doc);
  if (!result.success) {
    const issues = mapZodIssuesToConfigurationIssues(result.error);
    const primaryIssue = issues[0] ?? {
      code: 'CONFIG_SCHEMA_VALIDATION_ERROR' as const,
      path: '',
      message: 'Invalid SavedSearch configuration.',
    };

    throw new ConfigurationError({
      code: primaryIssue.code,
      path: primaryIssue.path,
      message: primaryIssue.message,
      ...(primaryIssue.suggestion !== undefined ? { suggestion: primaryIssue.suggestion } : {}),
      issues,
    });
  }

  return result.data;
};

export const parseSavedSearchYaml = (
  yamlText: string,
  options?: ParseSavedSearchYamlOptions,
): SavedSearchConfigurationV1 => {
  if (typeof yamlText !== 'string' || yamlText.trim().length === 0) {
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: 'Configuration YAML cannot be empty.',
      suggestion: 'Provide a valid non-empty YAML document with schemaVersion: 1.',
    });
  }

  let parsedDocuments: YAML.Document.Parsed[];
  try {
    parsedDocuments = YAML.parseAllDocuments(yamlText, {
      customTags: [],
      prettyErrors: true,
    });
  } catch (err: unknown) {
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: `YAML syntax error: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Fix syntax errors in the YAML configuration document.',
      cause: err,
    });
  }

  if (parsedDocuments.length === 0) {
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: 'No YAML documents found in input.',
      suggestion: 'Provide a valid YAML configuration document.',
    });
  }

  if (parsedDocuments.length > 1) {
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: `Multiple YAML documents found (${parsedDocuments.length}). Only a single SavedSearch document is supported.`,
      suggestion:
        'Remove multiple document separators (---) and supply a single configuration document.',
    });
  }

  const singleDoc = parsedDocuments[0];
  if (!singleDoc) {
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: 'Unable to parse YAML document.',
      suggestion: 'Provide a valid YAML configuration document.',
    });
  }

  if (singleDoc.errors.length > 0) {
    const primaryError = singleDoc.errors[0];
    throw new ConfigurationError({
      code: 'CONFIG_PARSE_ERROR',
      path: '',
      message: `YAML parse error: ${primaryError?.message ?? 'Unknown error'}`,
      suggestion: 'Ensure the YAML document contains valid syntax without illegal characters.',
    });
  }

  const rawJs: unknown = singleDoc.toJS({ maxAliasCount: 50 });
  if (typeof rawJs !== 'object' || rawJs === null || Array.isArray(rawJs)) {
    throw new ConfigurationError({
      code: 'CONFIG_SCHEMA_VALIDATION_ERROR',
      path: '',
      message: 'Expected YAML configuration to be a top-level mapping/object.',
      suggestion: 'Provide a key-value mapping with schemaVersion, id, sources, etc.',
    });
  }

  const migrationReg = options?.migrationRegistry ?? defaultMigrationRegistry;
  const targetVersion = options?.targetVersion ?? 1;

  const migratedResult = migrationReg.migrate(rawJs, targetVersion);
  return validateSavedSearchConfiguration(migratedResult.document);
};

export const importSavedSearchYaml = (
  yamlText: string,
  options?: ImportSavedSearchYamlOptions,
): ImportedSavedSearchConfiguration => {
  const configuration = parseSavedSearchYaml(yamlText, options);
  const savedSearch = toDomainSavedSearch(configuration, {
    clock: options?.clock,
    createdAt: options?.createdAt,
    updatedAt: options?.updatedAt,
  });
  return {
    configuration,
    savedSearch,
  };
};

export const serializeSavedSearchYaml = (config: SavedSearchConfigurationV1): string => {
  return YAML.stringify(config, {
    indent: 2,
    nullStr: 'null',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
};

export const exportSavedSearchYaml = (
  source: ImportedSavedSearchConfiguration | SavedSearchConfigurationV1,
): string => {
  const config = 'configuration' in source ? source.configuration : source;
  return serializeSavedSearchYaml(config);
};
