import type { SourceAdapter, SourceCapabilities } from '@busca-ofertas-ai/adapter-sdk';

export interface SourceDescriptor {
  readonly id: string;
  readonly version: string;
  readonly sdkVersion: string;
  readonly capabilities: SourceCapabilities;
}

export type SourceRegistryStatus = 'ENABLED' | 'DISABLED';

export type SourceRegistryState =
  | {
      readonly status: 'ENABLED';
      readonly factory: () => SourceAdapter;
    }
  | {
      readonly status: 'DISABLED';
      readonly reason: string;
      readonly factory?: () => SourceAdapter;
    };

export type SourceRegistryEntry = SourceDescriptor & SourceRegistryState;

export interface RegisterSourceEntryParams {
  readonly id: string;
  readonly version: string;
  readonly sdkVersion: string;
  readonly capabilities: SourceCapabilities;
  readonly status: SourceRegistryStatus;
  readonly factory?: () => SourceAdapter;
  readonly reason?: string;
}
