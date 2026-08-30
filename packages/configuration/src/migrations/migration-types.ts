export interface MigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

export interface MigrationResult {
  readonly document: Record<string, unknown>;
  readonly appliedVersions: readonly number[];
}
