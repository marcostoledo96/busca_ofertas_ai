import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts/ci/validate-workflow.mjs');

function runWorkflowValidation(dir?: string) {
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
    errors: stderr
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

describe('validate-workflow', () => {
  it('passes on current .github/workflows/ci.yml', () => {
    const res = runWorkflowValidation();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK: CI workflow policy validated successfully.');
  });

  describe('isolated workflow policy tests', () => {
    let testRepoDir: string;

    beforeEach(() => {
      testRepoDir = mkdtempSync(join(tmpdir(), 'boai-ci-wf-test-'));
      mkdirSync(join(testRepoDir, '.github/workflows'), { recursive: true });
      cpSync(
        join(process.cwd(), '.github/workflows/ci.yml'),
        join(testRepoDir, '.github/workflows/ci.yml'),
      );
    });

    afterEach(() => {
      try {
        rmSync(testRepoDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('passes on valid workflow fixture', () => {
      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('OK: CI workflow policy validated successfully.');
    });

    it('fails when pull_request_target trigger is used', () => {
      const forbiddenTrigger = [
        'name: CI',
        'on:',
        '  push:',
        '  pull_request_target:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-24.04',
        '    steps: []',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.github/workflows/ci.yml'), forbiddenTrigger);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_TRIGGER'))).toBe(true);
    });

    it('fails when write permissions are requested', () => {
      const writePermissions = [
        'name: CI',
        'on:',
        '  push:',
        '  pull_request:',
        'permissions:',
        '  contents: write',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-24.04',
        '    steps: []',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.github/workflows/ci.yml'), writePermissions);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.errors.some(
          (e) => e.includes('FORBIDDEN_PERMISSIONS') || e.includes('INVALID_PERMISSIONS'),
        ),
      ).toBe(true);
    });

    it('fails when an action uses a mutable tag (@v7) instead of a 40-char SHA', () => {
      const wfPath = join(testRepoDir, '.github/workflows/ci.yml');
      const wfContent = readFileSync(wfPath, 'utf-8');
      const mutated = wfContent.replace(
        /actions\/checkout@[0-9a-f]{40}/,
        'actions/checkout@v7.0.1',
      );
      writeFileSync(wfPath, mutated);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('MUTABLE_ACTION_REF'))).toBe(true);
    });

    it('fails when actions/checkout allows persist-credentials: true', () => {
      const wfPath = join(testRepoDir, '.github/workflows/ci.yml');
      const wfContent = readFileSync(wfPath, 'utf-8');
      const mutated = wfContent.replace('persist-credentials: false', 'persist-credentials: true');
      writeFileSync(wfPath, mutated);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('CHECKOUT_PERSIST_CREDENTIALS'))).toBe(true);
    });

    it('fails when secrets context is referenced', () => {
      const wfPath = join(testRepoDir, '.github/workflows/ci.yml');
      const wfContent = readFileSync(wfPath, 'utf-8');
      const mutated = wfContent + '\n      - run: echo ${{ secrets.MY_TOKEN }}\n';
      writeFileSync(wfPath, mutated);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_SECRET_REFERENCE'))).toBe(true);
    });

    it('fails when a mandatory quality gate command is missing', () => {
      const wfPath = join(testRepoDir, '.github/workflows/ci.yml');
      const wfContent = readFileSync(wfPath, 'utf-8');
      const mutated = wfContent.replace('pnpm typecheck', 'echo skipped');
      writeFileSync(wfPath, mutated);

      const res = runWorkflowValidation(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.errors.some((e) => e.includes("Required command 'pnpm typecheck' not found")),
      ).toBe(true);
    });
  });
});
