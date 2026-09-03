import { describe, it, expect } from 'vitest';
import { UnsafeExternalUrlError } from '@busca-ofertas-ai/core';
import { NodeExternalUrlOpener } from '../apps/cli/src/platform/node-external-url-opener.js';

describe('NodeExternalUrlOpener (BOAI-015)', () => {
  it('rejects URLs containing control characters with UnsafeExternalUrlError prior to URL parsing', async () => {
    const opener = new NodeExternalUrlOpener();

    const badUrls = [
      'https://example.com/item\r/test',
      'https://example.com/item\n/test',
      'https://example.com/item\t/test',
      'https://example.com/item\x00/test',
      'https://example.com/item\x1f/test',
      'https://example.com/item\x7f/test',
    ];

    for (const url of badUrls) {
      await expect(opener.open(url)).rejects.toThrow(UnsafeExternalUrlError);
    }
  });

  it('rejects non-https protocols fail-closed', async () => {
    const opener = new NodeExternalUrlOpener();

    const nonHttpsUrls = [
      'http://example.com/item',
      'ftp://example.com/file',
      'mailto:test@example.com',
      'javascript:alert(1)',
      'data:text/html,<h1>test</h1>',
      'file:///etc/passwd',
    ];

    for (const url of nonHttpsUrls) {
      await expect(opener.open(url)).rejects.toThrow(UnsafeExternalUrlError);
    }
  });

  it('rejects URLs containing username or password credentials', async () => {
    const opener = new NodeExternalUrlOpener();

    const credentialUrls = ['https://user:pass@example.com/item', 'https://admin@example.com/item'];

    for (const url of credentialUrls) {
      await expect(opener.open(url)).rejects.toThrow(UnsafeExternalUrlError);
    }
  });

  it('spawns browser with shell: false and platform-specific command on valid HTTPS URL', async () => {
    let capturedCommand = '';
    let capturedArgs: readonly string[] = [];
    let capturedOptions: { shell?: boolean } | undefined;

    const mockSpawn = (command: string, args: readonly string[], options?: unknown) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedOptions = options as { shell?: boolean } | undefined;
      return {
        unref: () => {},
        on: () => {},
      };
    };

    const opener = new NodeExternalUrlOpener({ spawn: mockSpawn });

    await opener.open('https://www.facebook.com/marketplace/item/123456789/');

    expect(capturedCommand).toBeTruthy();
    expect(capturedOptions?.shell).toBe(false);
    expect(capturedArgs).toContain('https://www.facebook.com/marketplace/item/123456789/');
  });

  it('aborts cooperatively when signal is already aborted', async () => {
    const opener = new NodeExternalUrlOpener();
    const controller = new AbortController();
    controller.abort();

    await expect(opener.open('https://www.example.com', controller.signal)).rejects.toThrow(
      /aborted/i,
    );
  });
});
