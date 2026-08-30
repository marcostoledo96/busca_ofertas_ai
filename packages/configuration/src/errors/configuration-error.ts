import { ConfigurationErrorCode } from './error-codes.js';

export interface ConfigurationIssue {
  readonly code: ConfigurationErrorCode;
  readonly path: string;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly schemaVersion?: number | undefined;
  readonly sourceId?: string | undefined;
}

export interface ConfigurationErrorParams {
  readonly code: ConfigurationErrorCode;
  readonly path: string;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly schemaVersion?: number | undefined;
  readonly sourceId?: string | undefined;
  readonly issues?: readonly ConfigurationIssue[] | undefined;
  readonly cause?: unknown;
}

export interface SerializedConfigurationError {
  readonly name: string;
  readonly code: ConfigurationErrorCode;
  readonly path: string;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly schemaVersion?: number | undefined;
  readonly sourceId?: string | undefined;
  readonly issues: readonly ConfigurationIssue[];
}

export class ConfigurationError extends Error {
  public readonly code: ConfigurationErrorCode;
  public readonly path: string;
  public readonly suggestion?: string | undefined;
  public readonly schemaVersion?: number | undefined;
  public readonly sourceId?: string | undefined;
  public readonly issues: readonly ConfigurationIssue[];

  constructor(params: ConfigurationErrorParams) {
    super(params.message, { cause: params.cause });
    this.name = 'ConfigurationError';
    this.code = params.code;
    this.path = params.path;
    if (params.suggestion !== undefined) {
      this.suggestion = params.suggestion;
    }
    if (params.schemaVersion !== undefined) {
      this.schemaVersion = params.schemaVersion;
    }
    if (params.sourceId !== undefined) {
      this.sourceId = params.sourceId;
    }
    this.issues = params.issues ? Object.freeze([...params.issues]) : Object.freeze([]);
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }

  public toJSON(): SerializedConfigurationError {
    return {
      name: this.name,
      code: this.code,
      path: this.path,
      message: this.message,
      ...(this.suggestion !== undefined ? { suggestion: this.suggestion } : {}),
      ...(this.schemaVersion !== undefined ? { schemaVersion: this.schemaVersion } : {}),
      ...(this.sourceId !== undefined ? { sourceId: this.sourceId } : {}),
      issues: this.issues,
    };
  }

  public toFormattedString(): string {
    let output = `[${this.code}] ${this.path}: ${this.message}`;
    if (this.suggestion) {
      output += `\nSuggestion: ${this.suggestion}`;
    }
    if (this.issues.length > 0) {
      output += '\nIssues:';
      for (const issue of this.issues) {
        output += `\n  - [${issue.code}] ${issue.path}: ${issue.message}`;
        if (issue.suggestion) {
          output += ` (Suggestion: ${issue.suggestion})`;
        }
      }
    }
    return output;
  }
}

export const isConfigurationError = (error: unknown): error is ConfigurationError =>
  error instanceof ConfigurationError;
