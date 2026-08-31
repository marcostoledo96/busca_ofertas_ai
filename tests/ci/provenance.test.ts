import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts/ci/validate-provenance.mjs');

function runValidate(dir?: string) {
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

describe('validate-provenance', () => {
  it('passes on the current repository locks and notices', () => {
    const res = runValidate();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK: Provenance and action locks validated successfully.');
  });

  describe('negative proofs and schema edge cases', () => {
    let testRepoDir: string;

    beforeEach(() => {
      testRepoDir = mkdtempSync(join(tmpdir(), 'boai-ci-prov-test-'));

      const root = process.cwd();
      cpSync(join(root, 'UPSTREAMS.lock.yml'), join(testRepoDir, 'UPSTREAMS.lock.yml'));
      cpSync(join(root, 'GENTLE_AI.lock.yml'), join(testRepoDir, 'GENTLE_AI.lock.yml'));
      cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(testRepoDir, 'THIRD_PARTY_NOTICES.md'));

      mkdirSync(join(testRepoDir, '.agents'), { recursive: true });
      cpSync(join(root, '.agents'), join(testRepoDir, '.agents'), { recursive: true });

      mkdirSync(join(testRepoDir, '.github/workflows'), { recursive: true });
      cpSync(join(root, '.github/workflows'), join(testRepoDir, '.github/workflows'), {
        recursive: true,
      });
    });

    afterEach(() => {
      try {
        rmSync(testRepoDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('passes on valid isolated fixture', () => {
      const res = runValidate(testRepoDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('OK: Provenance and action locks validated successfully.');
    });

    it('fails when UPSTREAMS.lock.yml has unsupported version (e.g. version: 999)', () => {
      const content = readFileSync(join(testRepoDir, 'UPSTREAMS.lock.yml'), 'utf-8').replace(
        'version: 2',
        'version: 999',
      );
      writeFileSync(join(testRepoDir, 'UPSTREAMS.lock.yml'), content);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('UPSTREAMS_UNSUPPORTED_VERSION'))).toBe(true);
    });

    it('fails on invalid YAML and NEVER leaks source excerpts or secrets in error output', () => {
      const syntheticSecret = ['my_secret_', '1234567890abcdefghijklmnopqrstuvwxyz'].join('');
      writeFileSync(
        join(testRepoDir, 'UPSTREAMS.lock.yml'),
        `invalid: yaml: [unclosed: "${syntheticSecret}"`,
      );

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('YAML_PARSE_ERROR'))).toBe(true);
      expect(res.output).not.toContain(syntheticSecret);
    });

    it('fails when UPSTREAMS.lock.yml has duplicate upstream IDs', () => {
      const invalidUpstreams = [
        'version: 2',
        'upstreams:',
        '  - id: test-dup',
        '    repository: https://github.com/test/dup',
        '    sha: 1111111111111111111111111111111111111111',
        '    license: MIT',
        '    role: test',
        '    status: active',
        '  - id: test-dup',
        '    repository: https://github.com/test/dup2',
        '    sha: 2222222222222222222222222222222222222222',
        '    license: MIT',
        '    role: test',
        '    status: active',
      ].join('\n');
      writeFileSync(join(testRepoDir, 'UPSTREAMS.lock.yml'), invalidUpstreams);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes("duplicate upstream id 'test-dup'"))).toBe(true);
    });

    it('fails when an upstream SHA is not 40 hex characters', () => {
      const content = [
        'version: 2',
        'upstreams:',
        '  - id: test-sha',
        '    repository: https://github.com/test/sha',
        '    sha: not-a-40-hex-sha',
        '    license: MIT',
        '    role: test',
        '    status: active',
      ].join('\n');
      writeFileSync(join(testRepoDir, 'UPSTREAMS.lock.yml'), content);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('UPSTREAMS_INVALID_SHA'))).toBe(true);
    });

    it('fails when Gentle AI commit SHA in UPSTREAMS does not match GENTLE_AI.lock.yml', () => {
      const gentleLock = [
        'schemaVersion: 1',
        'tool:',
        '  name: gentle-ai',
        '  repository: https://github.com/Gentleman-Programming/gentle-ai',
        '  release: v2.5.0-rc.3',
        '  commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '  runtime: antigravity',
        '  vendoredBinary: false',
        'policy:',
        '  automaticUpgrade: false',
      ].join('\n');
      writeFileSync(join(testRepoDir, 'GENTLE_AI.lock.yml'), gentleLock);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('gentle-ai commit SHA mismatch'))).toBe(true);
    });

    it('fails when skills source SHA in UPSTREAMS does not match .agents/skills.lock.yml', () => {
      const skillsLock = [
        'schemaVersion: 1',
        'installRoot: .agents/skills',
        'source:',
        '  repository: https://github.com/mattpocock/skills',
        '  sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '  license: MIT',
        'skills: []',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.agents/skills.lock.yml'), skillsLock);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('mattpocock-skills commit SHA mismatch'))).toBe(
        true,
      );
    });

    it('fails when skills license in UPSTREAMS does not match .agents/skills.lock.yml', () => {
      const skillsLock = [
        'schemaVersion: 1',
        'installRoot: .agents/skills',
        'source:',
        '  repository: https://github.com/mattpocock/skills',
        '  sha: 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76',
        '  license: GPL-3.0',
        'skills: []',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.agents/skills.lock.yml'), skillsLock);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('mattpocock-skills license mismatch'))).toBe(true);
    });

    it('fails when an active skill SKILL.md file is missing', () => {
      const skillsLock = [
        'schemaVersion: 1',
        'installRoot: .agents/skills',
        'source:',
        '  repository: https://github.com/mattpocock/skills',
        '  sha: 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76',
        '  license: MIT',
        'skills:',
        '  - id: boai-domain-modeling',
        '    localPath: .agents/skills/boai-domain-modeling',
        '    status: active',
        '  - id: boai-codebase-design',
        '    localPath: .agents/skills/boai-codebase-design',
        '    status: active',
        '  - id: boai-module-boundaries',
        '    localPath: .agents/skills/boai-module-boundaries',
        '    status: active',
        '  - id: missing-skill',
        '    localPath: .agents/skills/non-existent-skill',
        '    status: active',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.agents/skills.lock.yml'), skillsLock);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(
        res.errors.some((e) => e.includes("SKILL.md for active skill 'missing-skill' not found")),
      ).toBe(true);
    });

    it('fails when THIRD_PARTY_NOTICES.md has a stale or missing SHA for an upstream', () => {
      const notices = readFileSync(join(testRepoDir, 'THIRD_PARTY_NOTICES.md'), 'utf-8');
      const staleNotices = notices.replace(
        '3d3c42e5aac5ba805825da76410c181273ba90b1',
        'stale00000000000000000000000000000000000',
      );
      writeFileSync(join(testRepoDir, 'THIRD_PARTY_NOTICES.md'), staleNotices);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('NOTICES_MISSING_SHA'))).toBe(true);
    });

    it('fails when a remote reusable workflow uses a mutable tag (@main) instead of 40-char SHA', () => {
      const workflowWithReusableWorkflow = [
        'name: CI',
        'on: [push]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  reuse:',
        '    uses: evil/example/.github/workflows/test.yml@main',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.github/workflows/ci.yml'), workflowWithReusableWorkflow);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('MUTABLE_ACTION_REF'))).toBe(true);
    });

    it('fails when a remote reusable workflow uses a 40-char SHA not registered in UPSTREAMS.lock.yml', () => {
      const workflowWithReusableWorkflow = [
        'name: CI',
        'on: [push]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  reuse:',
        '    uses: evil/example/.github/workflows/test.yml@1111111111111111111111111111111111111111',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.github/workflows/ci.yml'), workflowWithReusableWorkflow);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('ACTION_NOT_IN_UPSTREAMS'))).toBe(true);
    });

    it('fails when a remote reusable workflow SHA differs from UPSTREAMS.lock.yml', () => {
      const workflowWithReusableWorkflow = [
        'name: CI',
        'on: [push]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  reuse:',
        '    uses: actions/checkout/.github/workflows/check.yml@2222222222222222222222222222222222222222',
      ].join('\n');
      writeFileSync(join(testRepoDir, '.github/workflows/ci.yml'), workflowWithReusableWorkflow);

      const res = runValidate(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('ACTION_SHA_MISMATCH'))).toBe(true);
    });
  });
});
