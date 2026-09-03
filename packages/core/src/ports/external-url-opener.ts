/**
 * External URL Opener Port
 * Contract for securely opening external URLs from application use cases.
 */
export interface ExternalUrlOpenerPort {
  open(url: string, signal?: AbortSignal): Promise<void>;
}
