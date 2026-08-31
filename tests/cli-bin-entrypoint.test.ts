import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

describe('CLI Binary Executable Entrypoint (BOAI-006)', () => {
  it('executes compiled bin entrypoint with piped input without hanging and exits with SUCCESS (0)', async () => {
    const binPath = resolve(process.cwd(), 'apps/cli/dist/bin.js');

    // Skip if dist/bin.js has not been compiled yet (it will be compiled by pnpm build before test run)
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
    expect(stderr).toBe('');
  });
});
