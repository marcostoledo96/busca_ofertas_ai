import {
  ADAPTER_SDK_VERSION,
  checkAdapterCompatibility,
  validateAdapterMethodCoherence,
  type SourceAdapter,
  type SourceCapabilities,
} from '@busca-ofertas-ai/adapter-sdk';
import { ConfigurationError } from '../errors/configuration-error.js';
import type { RegisterSourceEntryParams, SourceRegistryEntry } from './registry-types.js';

const REQUIRED_CAPABILITY_KEYS: readonly (keyof SourceCapabilities)[] = [
  'textSearch',
  'exactUrlWatch',
  'listingDetails',
  'authentication',
  'pagination',
  'geographicSearch',
  'priceAndCurrency',
  'stock',
  'advertisedDiscount',
];

export class SourceRegistry {
  private readonly entries = new Map<string, SourceRegistryEntry>();

  public register(params: RegisterSourceEntryParams): this {
    const id = params.id?.trim();
    if (!id) {
      throw new ConfigurationError({
        code: 'REGISTRY_INVALID_ENTRY',
        path: 'registry.id',
        message: 'Source registry entry requires a non-empty string ID.',
        suggestion: 'Provide a non-empty string identifier for the source adapter.',
      });
    }

    const version = params.version?.trim();
    if (!version) {
      throw new ConfigurationError({
        code: 'REGISTRY_INVALID_ENTRY',
        path: `registry.${id}.version`,
        sourceId: id,
        message: `Source registry entry "${id}" requires a non-empty version string.`,
        suggestion: 'Provide a semver-compatible version string for the adapter.',
      });
    }

    const sdkVersion = params.sdkVersion?.trim();
    if (!sdkVersion) {
      throw new ConfigurationError({
        code: 'REGISTRY_INVALID_ENTRY',
        path: `registry.${id}.sdkVersion`,
        sourceId: id,
        message: `Source registry entry "${id}" requires a non-empty sdkVersion string.`,
        suggestion: `Specify the compatible SDK version (current is "${ADAPTER_SDK_VERSION}").`,
      });
    }

    const compatibility = checkAdapterCompatibility(sdkVersion);
    if (!compatibility.compatible) {
      throw new ConfigurationError({
        code: 'REGISTRY_INCOMPATIBLE_SDK',
        path: `registry.${id}.sdkVersion`,
        sourceId: id,
        message: `Source adapter "${id}" declares SDK version "${sdkVersion}", which is incompatible with runtime SDK version "${ADAPTER_SDK_VERSION}" (${compatibility.reason ?? 'incompatible'}).`,
        suggestion: `Update adapter "${id}" to target SDK version "${ADAPTER_SDK_VERSION}".`,
      });
    }

    const missingCapabilityFields: string[] = [];
    if (!params.capabilities || typeof params.capabilities !== 'object') {
      missingCapabilityFields.push('capabilities object is required');
    } else {
      for (const capKey of REQUIRED_CAPABILITY_KEYS) {
        if (typeof params.capabilities[capKey] !== 'boolean') {
          missingCapabilityFields.push(`${capKey} (expected boolean)`);
        }
      }
    }

    if (missingCapabilityFields.length > 0) {
      throw new ConfigurationError({
        code: 'REGISTRY_INVALID_ENTRY',
        path: `registry.${id}.capabilities`,
        sourceId: id,
        message: `Source adapter "${id}" declared invalid capabilities: ${missingCapabilityFields.join(', ')}`,
        suggestion: 'Ensure all required capability flags are explicit booleans.',
      });
    }

    if (this.entries.has(id)) {
      throw new ConfigurationError({
        code: 'REGISTRY_DUPLICATE_SOURCE',
        path: `registry.${id}`,
        sourceId: id,
        message: `Source "${id}" is already registered. Duplicate source registrations are forbidden.`,
        suggestion: 'Ensure each source adapter is registered only once with a unique source ID.',
      });
    }

    if (params.status === 'ENABLED') {
      if (typeof params.factory !== 'function') {
        throw new ConfigurationError({
          code: 'REGISTRY_INVALID_ENTRY',
          path: `registry.${id}.factory`,
          sourceId: id,
          message: `Enabled source adapter "${id}" must provide a factory function.`,
          suggestion: 'Provide a zero-argument factory function (() => SourceAdapter).',
        });
      }

      const entry: SourceRegistryEntry = {
        id,
        version,
        sdkVersion,
        capabilities: { ...params.capabilities },
        status: 'ENABLED',
        factory: params.factory,
      };
      this.entries.set(id, entry);
    } else if (params.status === 'DISABLED') {
      const reason = params.reason?.trim();
      if (!reason) {
        throw new ConfigurationError({
          code: 'REGISTRY_INVALID_ENTRY',
          path: `registry.${id}.reason`,
          sourceId: id,
          message: `Disabled source adapter "${id}" must provide a non-empty disabled reason.`,
          suggestion:
            'Provide a clear explanation why this source is disabled (e.g. "Requires session re-authentication").',
        });
      }

      const entry: SourceRegistryEntry = {
        id,
        version,
        sdkVersion,
        capabilities: { ...params.capabilities },
        status: 'DISABLED',
        reason,
        ...(params.factory ? { factory: params.factory } : {}),
      };
      this.entries.set(id, entry);
    } else {
      throw new ConfigurationError({
        code: 'REGISTRY_INVALID_ENTRY',
        path: `registry.${id}.status`,
        sourceId: id,
        message: `Invalid registry status: expected "ENABLED" or "DISABLED", received "${String(params.status)}".`,
        suggestion: 'Set status to either "ENABLED" or "DISABLED".',
      });
    }

    return this;
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  public get(id: string): SourceRegistryEntry | undefined {
    return this.entries.get(id);
  }

  public getOrThrow(id: string): SourceRegistryEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new ConfigurationError({
        code: 'CONFIG_SOURCE_NOT_REGISTERED',
        path: `sources.${id}`,
        sourceId: id,
        message: `Source adapter "${id}" is not registered in the SourceRegistry.`,
        suggestion: `Register the "${id}" adapter in SourceRegistry before executing the search.`,
      });
    }
    return entry;
  }

  public list(): readonly SourceRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  public createAdapter(id: string): SourceAdapter {
    const entry = this.getOrThrow(id);

    if (entry.status === 'DISABLED') {
      throw new ConfigurationError({
        code: 'CONFIG_SOURCE_DISABLED',
        path: `sources.${id}`,
        sourceId: id,
        message: `Source adapter "${id}" is disabled in the registry: ${entry.reason}`,
        suggestion: `Resolve the disabled reason ("${entry.reason}") or re-enable the adapter.`,
      });
    }

    const adapter = entry.factory();

    // Verify coherence between registered descriptor and produced instance without calling initialize()
    if (adapter.id !== entry.id) {
      throw new ConfigurationError({
        code: 'REGISTRY_FACTORY_MISMATCH',
        path: `registry.${id}.id`,
        sourceId: id,
        message: `Factory for source "${id}" produced an adapter with mismatched ID "${adapter.id}".`,
        suggestion: `Ensure the adapter instance id property matches registered id "${id}".`,
      });
    }

    if (adapter.version !== entry.version) {
      throw new ConfigurationError({
        code: 'REGISTRY_FACTORY_MISMATCH',
        path: `registry.${id}.version`,
        sourceId: id,
        message: `Factory for source "${id}" produced an adapter with mismatched version "${adapter.version}" (expected "${entry.version}").`,
        suggestion: `Ensure the adapter instance version matches registered version "${entry.version}".`,
      });
    }

    if (adapter.sdkVersion !== entry.sdkVersion) {
      throw new ConfigurationError({
        code: 'REGISTRY_FACTORY_MISMATCH',
        path: `registry.${id}.sdkVersion`,
        sourceId: id,
        message: `Factory for source "${id}" produced an adapter with mismatched sdkVersion "${adapter.sdkVersion}" (expected "${entry.sdkVersion}").`,
        suggestion: `Ensure the adapter instance sdkVersion matches registered sdkVersion "${entry.sdkVersion}".`,
      });
    }

    const sdkCompatibility = checkAdapterCompatibility(adapter.sdkVersion);
    if (!sdkCompatibility.compatible) {
      throw new ConfigurationError({
        code: 'REGISTRY_FACTORY_MISMATCH',
        path: `registry.${id}.sdkVersion`,
        sourceId: id,
        message: `Factory for source "${id}" produced an adapter targeting incompatible SDK version "${adapter.sdkVersion}".`,
        suggestion: `Update adapter instance to target SDK version "${ADAPTER_SDK_VERSION}".`,
      });
    }

    for (const capKey of REQUIRED_CAPABILITY_KEYS) {
      if (adapter.capabilities[capKey] !== entry.capabilities[capKey]) {
        throw new ConfigurationError({
          code: 'REGISTRY_FACTORY_MISMATCH',
          path: `registry.${id}.capabilities.${capKey}`,
          sourceId: id,
          message: `Factory for source "${id}" produced an adapter with mismatched capability "${capKey}" (${String(adapter.capabilities[capKey])} vs expected ${String(entry.capabilities[capKey])}).`,
          suggestion: `Ensure the adapter instance capabilities match the registered capabilities for "${id}".`,
        });
      }
    }

    const coherence = validateAdapterMethodCoherence(adapter);
    if (!coherence.valid) {
      throw new ConfigurationError({
        code: 'REGISTRY_FACTORY_MISMATCH',
        path: `registry.${id}.capabilities`,
        sourceId: id,
        message: `Factory for source "${id}" produced an adapter with method/capability incoherence: ${coherence.errors.join(', ')}`,
        suggestion: 'Ensure adapter methods match declared capabilities.',
      });
    }

    return adapter;
  }
}
