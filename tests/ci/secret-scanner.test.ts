import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts/ci/scan-secrets.mjs');

function runScan(dir?: string) {
  const args = [SCRIPT_PATH];
  if (dir) args.push(dir);
  const result = spawnSync('node', args, { encoding: 'utf-8' });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = (stdout + '\n' + stderr).trim();
  return {
    status: result.status,
    stdout,
    stderr,
    output,
    findings: stderr
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

describe('scan-secrets', () => {
  it('passes on clean current repository', () => {
    const res = runScan();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK: Secret scan completed. No tracked secrets detected.');
  });

  describe('isolated repository tests', () => {
    let testRepoDir: string;

    beforeEach(() => {
      testRepoDir = mkdtempSync(join(tmpdir(), 'boai-ci-secret-test-'));
      execFileSync('git', ['init'], { cwd: testRepoDir });
      execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: testRepoDir });
      execFileSync('git', ['config', 'user.name', 'CI Runner'], { cwd: testRepoDir });
    });

    afterEach(() => {
      try {
        rmSync(testRepoDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('passes when tracked files are safe (including .env.example)', () => {
      writeFileSync(join(testRepoDir, '.env.example'), 'PORT=3000\nNODE_ENV=development\n');
      writeFileSync(join(testRepoDir, 'README.md'), '# Safe project\nNo secrets here.\n');
      execFileSync('git', ['add', '.env.example', 'README.md'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('OK: Secret scan completed. No tracked secrets detected.');
    });

    it('fails when .env is tracked in git', () => {
      writeFileSync(join(testRepoDir, '.env'), 'DATABASE_URL=sqlite://data.db\n');
      execFileSync('git', ['add', '-f', '.env'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.findings.some((f) => f.includes('SECRET_DETECTED SENSITIVE_ENV_FILE .env:1')),
      ).toBe(true);
    });

    it('fails when a .pem or .key file is tracked in git', () => {
      writeFileSync(join(testRepoDir, 'server.key'), 'dummy key content\n');
      execFileSync('git', ['add', 'server.key'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.findings.some((f) =>
          f.includes('SECRET_DETECTED SENSITIVE_KEY_CERT_FILE server.key:1'),
        ),
      ).toBe(true);
    });

    it('fails when storageState.json is tracked in git', () => {
      writeFileSync(join(testRepoDir, 'storageState.json'), '{"cookies": []}');
      execFileSync('git', ['add', 'storageState.json'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.findings.some((f) =>
          f.includes('SECRET_DETECTED SENSITIVE_STORAGE_STATE storageState.json:1'),
        ),
      ).toBe(true);
    });

    it('fails when a private key PEM header is tracked in file content', () => {
      const pemHeader = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join('');
      writeFileSync(join(testRepoDir, 'cert.txt'), `${pemHeader}\nMIIEowIBAAKCAQEA...\n`);
      execFileSync('git', ['add', 'cert.txt'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.findings.some((f) => f.includes('SECRET_DETECTED PRIVATE_KEY_PEM_HEADER cert.txt:1')),
      ).toBe(true);
    });

    it('fails when a synthetic GitHub token is tracked and REDACTS the secret value from CLI output', () => {
      const syntheticToken = ['ghp_', '1234567890abcdefghijklmnopqrstuvwxyzAB'].join('');
      writeFileSync(join(testRepoDir, 'config.js'), `export const token = "${syntheticToken}";\n`);
      execFileSync('git', ['add', 'config.js'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.output).toContain('SECRET_DETECTED GITHUB_TOKEN_CLASSIC config.js:1');
      expect(res.output).not.toContain(syntheticToken);
    });

    it('fails when a synthetic AWS access key is tracked and redacts the value', () => {
      const syntheticAwsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
      writeFileSync(join(testRepoDir, 'aws.json'), `{"aws_access_key_id": "${syntheticAwsKey}"}`);
      execFileSync('git', ['add', 'aws.json'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.output).toContain('SECRET_DETECTED AWS_ACCESS_KEY_ID aws.json:1');
      expect(res.output).not.toContain(syntheticAwsKey);
    });

    it('does not produce false positives for safe placeholder assignments', () => {
      writeFileSync(
        join(testRepoDir, 'placeholders.ts'),
        [
          "export const apiKey = '<api-key>';",
          "export const token = 'TODO';",
          "export const secret = 'example';",
          "export const auth = 'placeholder';",
          '',
        ].join('\n'),
      );
      execFileSync('git', ['add', 'placeholders.ts'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(0);
    });

    it('safely handles binary files without crashes or leaks', () => {
      const binaryBuffer = Buffer.concat([
        Buffer.from('binary-data-prefix'),
        Buffer.from([0, 1, 2, 3, 0]),
        Buffer.from('data'),
      ]);
      writeFileSync(join(testRepoDir, 'image.png'), binaryBuffer);
      execFileSync('git', ['add', 'image.png'], { cwd: testRepoDir });

      const res = runScan(testRepoDir);
      expect(res.status).toBe(0);
    });
  });
});
