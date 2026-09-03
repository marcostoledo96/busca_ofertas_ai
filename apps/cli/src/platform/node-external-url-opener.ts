import { spawn } from 'node:child_process';
import type { ExternalUrlOpenerPort } from '@busca-ofertas-ai/core';
import { UnsafeExternalUrlError } from '@busca-ofertas-ai/core';

function hasControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export interface SpawnedProcessHandle {
  unref(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export type UrlOpenerSpawnFunction = (
  command: string,
  args: readonly string[],
  options?: unknown,
) => SpawnedProcessHandle;

export interface NodeExternalUrlOpenerParams {
  readonly spawn?: UrlOpenerSpawnFunction;
}

export class NodeExternalUrlOpener implements ExternalUrlOpenerPort {
  private readonly spawnFn: UrlOpenerSpawnFunction;

  constructor(params?: NodeExternalUrlOpenerParams) {
    this.spawnFn = (params?.spawn ?? spawn) as unknown as UrlOpenerSpawnFunction;
  }

  public async open(url: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
    }

    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new UnsafeExternalUrlError('URL string cannot be empty.');
    }

    // Pre-validation: check for control characters BEFORE new URL() normalizes them
    if (hasControlCharacters(url)) {
      throw new UnsafeExternalUrlError('URL contains invalid control characters.');
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      throw new UnsafeExternalUrlError(
        `Invalid URL format: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Protocol validation: HTTPS only
    if (parsed.protocol !== 'https:') {
      throw new UnsafeExternalUrlError(
        `Unsafe URL protocol '${parsed.protocol}'. Only 'https:' is permitted.`,
      );
    }

    // Credentials validation: no username or password
    if (parsed.username !== '' || parsed.password !== '') {
      throw new UnsafeExternalUrlError('URL contains embedded user credentials.');
    }

    // Choose platform opener executable
    let command: string;
    let args: string[];

    if (process.platform === 'darwin') {
      command = 'open';
      args = [parsed.href];
    } else if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/c', 'start', '', parsed.href];
    } else {
      command = 'xdg-open';
      args = [parsed.href];
    }

    return new Promise((resolve) => {
      try {
        const child = this.spawnFn(command, args, {
          shell: false,
          detached: true,
          stdio: 'ignore',
        });

        child.unref();

        child.on('error', () => {
          // Failure to spawn opener should not crash application or throw unhandled
          resolve();
        });

        resolve();
      } catch {
        resolve();
      }
    });
  }
}
