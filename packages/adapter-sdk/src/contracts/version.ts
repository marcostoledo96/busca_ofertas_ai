/**
 * Versioning and compatibility contracts for Busca Ofertas AI Adapter SDK.
 */

export const ADAPTER_SDK_VERSION = '0.1.0' as const;

export interface SdkCompatibilityResult {
  readonly compatible: boolean;
  readonly sdkVersion: string;
  readonly adapterSdkVersion: string;
  readonly reason?: string;
}

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSemver(version: string): ParsedSemver | null {
  if (typeof version !== 'string') {
    return null;
  }
  const clean = version.trim().replace(/^v/i, '');
  const parts = clean.split('.');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = parts[2] !== undefined ? Number(parts[2].split('-')[0]) : 0;

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return null;
  }
  if (major < 0 || minor < 0 || patch < 0) {
    return null;
  }
  return { major, minor, patch };
}

/**
 * Checks whether an adapter declaring `adapterSdkVersion` is compatible with `targetSdkVersion`.
 * Follows semantic versioning rules (0.x requires matching minor; >=1.0 requires matching major).
 */
export function checkAdapterCompatibility(
  adapterSdkVersion: string,
  targetSdkVersion: string = ADAPTER_SDK_VERSION,
): SdkCompatibilityResult {
  const parsedAdapter = parseSemver(adapterSdkVersion);
  const parsedTarget = parseSemver(targetSdkVersion);

  if (!parsedAdapter) {
    return {
      compatible: false,
      sdkVersion: targetSdkVersion,
      adapterSdkVersion,
      reason: `Invalid adapter SDK version format: '${adapterSdkVersion}'`,
    };
  }

  if (!parsedTarget) {
    return {
      compatible: false,
      sdkVersion: targetSdkVersion,
      adapterSdkVersion,
      reason: `Invalid target SDK version format: '${targetSdkVersion}'`,
    };
  }

  // Pre-1.0: 0.y.z requires exact minor version match
  if (parsedTarget.major === 0) {
    if (parsedAdapter.major !== 0 || parsedAdapter.minor !== parsedTarget.minor) {
      return {
        compatible: false,
        sdkVersion: targetSdkVersion,
        adapterSdkVersion,
        reason: `Pre-1.0 SDK requires matching minor version. Expected 0.${parsedTarget.minor}.x, got ${adapterSdkVersion}`,
      };
    }
    return {
      compatible: true,
      sdkVersion: targetSdkVersion,
      adapterSdkVersion,
    };
  }

  // 1.0+: requires matching major version, and adapter must be <= target
  if (parsedAdapter.major !== parsedTarget.major) {
    return {
      compatible: false,
      sdkVersion: targetSdkVersion,
      adapterSdkVersion,
      reason: `Incompatible major version. Expected ${parsedTarget.major}.x.x, got ${adapterSdkVersion}`,
    };
  }

  return {
    compatible: true,
    sdkVersion: targetSdkVersion,
    adapterSdkVersion,
  };
}
