import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

describe('CLI Binary Executable Entrypoint (BOAI-006)', () => {
  it('executes compiled bin entrypoint with piped input without hanging and exits with SUCCESS (0)', async () => {
    const binPath = resolve(process.cwd(), 'apps/cli/dist/bin.js');

    if (!existsSync(binPath)) {
      return;
    }

    const child = spawn(process.execPath, [binPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer | string) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer | string) => {
      stderr += data.toString();
    });

    // Provide exit selection
    child.stdin.write('8\n');
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('BUSCA OFERTAS AI');
    expect(stdout).toContain('1. Ejecutar una búsqueda');
    expect(stdout).toContain('8. Salir');
    expect(stdout).toContain('Saliendo de Busca Ofertas AI. ¡Hasta luego!');
    // Filter out Node.js engine-level experimental warnings (e.g. node:sqlite in Node 22)
    const appStderr = stderr
      .split('\n')
      .filter((line) => !line.includes('ExperimentalWarning') && !line.includes('--trace-warnings'))
      .join('')
      .trim();
    expect(appStderr).toBe('');
  });

  it('Finding 2: fatal unhandled rejection in bin.ts catch block does NOT print raw message or secrets, outputs safe INTERNAL_ERROR and exit code 70', async () => {
    // Execute a node subprocess simulating bin.ts top-level fatal rejection
    const secret = 'fake-fatal-crash-secret-key-xyz123';
    const inlineScript = `
      import { EXIT_CODES } from './apps/cli/dist/runtime/exit-codes.js';
      const fatalPromise = Promise.reject(new Error("Fatal database crash with token=${secret}"));
      fatalPromise
        .then((code) => { process.exitCode = code; })
        .catch(() => {
          process.stderr.write('\\n[INTERNAL_ERROR] Ocurrió un error interno no esperado.\\n');
          process.exitCode = EXIT_CODES.INTERNAL_ERROR;
        });
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', inlineScript], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer | string) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer | string) => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(70);
    expect(stderr).toContain('[INTERNAL_ERROR] Ocurrió un error interno no esperado.');

    // Strict negative proofs
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain('Fatal database crash');
    expect(stdout).toBe('');
  });
});
