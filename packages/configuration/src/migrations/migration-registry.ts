import { ConfigurationError } from '../errors/configuration-error.js';
import type { MigrationResult, MigrationStep } from './migration-types.js';

export class MigrationRegistry {
  private readonly steps = new Map<number, MigrationStep>();

  public register(step: MigrationStep): this {
    if (
      typeof step.fromVersion !== 'number' ||
      typeof step.toVersion !== 'number' ||
      step.fromVersion < 1 ||
      step.toVersion !== step.fromVersion + 1
    ) {
      throw new ConfigurationError({
        code: 'CONFIG_MIGRATION_ERROR',
        path: 'migrations',
        message: `Invalid migration step: fromVersion (${step.fromVersion}) toVersion (${step.toVersion}) must be sequential (N -> N+1).`,
        suggestion: 'Define migrations sequentially step by step.',
      });
    }

    if (this.steps.has(step.fromVersion)) {
      throw new ConfigurationError({
        code: 'CONFIG_MIGRATION_ERROR',
        path: 'migrations',
        message: `Migration step from version ${step.fromVersion} is already registered.`,
        suggestion: 'Ensure each version transition has a unique migration handler.',
      });
    }

    this.steps.set(step.fromVersion, step);
    return this;
  }

  public hasStep(fromVersion: number): boolean {
    return this.steps.has(fromVersion);
  }

  public getStep(fromVersion: number): MigrationStep | undefined {
    return this.steps.get(fromVersion);
  }

  public migrate(rawDocument: unknown, targetVersion: number): MigrationResult {
    if (typeof rawDocument !== 'object' || rawDocument === null || Array.isArray(rawDocument)) {
      throw new ConfigurationError({
        code: 'CONFIG_SCHEMA_VALIDATION_ERROR',
        path: '',
        message: 'Configuration document must be a non-null object.',
        suggestion: 'Provide a valid YAML configuration mapping.',
      });
    }

    const docObj = rawDocument as Record<string, unknown>;
    const rawVersion = docObj['schemaVersion'];

    if (rawVersion === undefined || rawVersion === null) {
      throw new ConfigurationError({
        code: 'CONFIG_SCHEMA_VERSION_REQUIRED',
        path: 'schemaVersion',
        message: 'Configuration document is missing mandatory "schemaVersion" field.',
        suggestion: `Specify "schemaVersion: ${targetVersion}" at the top level of the configuration.`,
      });
    }

    if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) {
      const versionDisplay =
        typeof rawVersion === 'string' || typeof rawVersion === 'number'
          ? String(rawVersion)
          : typeof rawVersion;
      throw new ConfigurationError({
        code: 'CONFIG_SCHEMA_VERSION_REQUIRED',
        path: 'schemaVersion',
        message: `Invalid schemaVersion: expected positive integer, received ${versionDisplay}.`,
        suggestion: `Set schemaVersion to an integer such as ${targetVersion}.`,
      });
    }

    if (rawVersion === targetVersion) {
      return {
        document: { ...docObj },
        appliedVersions: [],
      };
    }

    if (rawVersion > targetVersion) {
      throw new ConfigurationError({
        code: 'CONFIG_SCHEMA_VERSION_UNSUPPORTED',
        path: 'schemaVersion',
        schemaVersion: rawVersion,
        message: `Configuration schemaVersion ${rawVersion} is higher than supported target version ${targetVersion}.`,
        suggestion: `Downgrade configuration schemaVersion to ${targetVersion} or update Busca Ofertas AI.`,
      });
    }

    let currentDoc: Record<string, unknown> = { ...docObj };
    const appliedVersions: number[] = [];
    let currentVersion = rawVersion;

    while (currentVersion < targetVersion) {
      const step = this.steps.get(currentVersion);
      if (!step) {
        throw new ConfigurationError({
          code: 'CONFIG_MIGRATION_ERROR',
          path: 'schemaVersion',
          schemaVersion: currentVersion,
          message: `No migration path found from version ${currentVersion} to ${targetVersion}.`,
          suggestion: `Ensure all intermediate migration steps from version ${currentVersion} to ${targetVersion} are registered.`,
        });
      }

      try {
        currentDoc = step.migrate(currentDoc);
        currentDoc['schemaVersion'] = step.toVersion;
        currentVersion = step.toVersion;
        appliedVersions.push(currentVersion);
      } catch (err: unknown) {
        throw new ConfigurationError({
          code: 'CONFIG_MIGRATION_ERROR',
          path: 'schemaVersion',
          schemaVersion: currentVersion,
          message: `Migration step ${step.fromVersion} -> ${step.toVersion} failed: ${err instanceof Error ? err.message : String(err)}`,
          suggestion: 'Check migration step implementation and document structure.',
          cause: err,
        });
      }
    }

    return {
      document: currentDoc,
      appliedVersions,
    };
  }
}

export const defaultMigrationRegistry = new MigrationRegistry();
