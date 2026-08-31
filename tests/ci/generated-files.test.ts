import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts/ci/check-generated-files.mjs');

function runCheck(dir?: string) {
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

describe('check-generated-files', () => {
  it('passes on clean current repository', () => {
    const res = runCheck();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK: No generated registry files tracked');
  });

  describe('isolated repository tests', () => {
    let testRepoDir: string;

    beforeEach(() => {
      testRepoDir = mkdtempSync(join(tmpdir(), 'boai-ci-gen-test-'));
      execFileSync('git', ['init'], { cwd: testRepoDir });
      execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: testRepoDir });
      execFileSync('git', ['config', 'user.name', 'CI Runner'], { cwd: testRepoDir });

      // Valid default .gitignore
      writeFileSync(
        join(testRepoDir, '.gitignore'),
        ['node_modules/', '.atl/.skill-registry.cache.json', '.atl/skill-registry.md', ''].join(
          '\n',
        ),
      );
    });

    afterEach(() => {
      try {
        rmSync(testRepoDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('passes when valid gitignore is present and no generated files are tracked', () => {
      const res = runCheck(testRepoDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('OK: No generated registry files tracked');
    });

    it('fails when .atl/.skill-registry.cache.json is tracked in git', () => {
      mkdirSync(join(testRepoDir, '.atl'), { recursive: true });
      writeFileSync(join(testRepoDir, '.atl/.skill-registry.cache.json'), '{}');
      execFileSync('git', ['add', '-f', '.atl/.skill-registry.cache.json'], { cwd: testRepoDir });

      const res = runCheck(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors).toContain('GENERATED_FILE_TRACKED .atl/.skill-registry.cache.json');
    });

    it('fails when .atl/skill-registry.md is tracked in git', () => {
      mkdirSync(join(testRepoDir, '.atl'), { recursive: true });
      writeFileSync(join(testRepoDir, '.atl/skill-registry.md'), '# Skill Registry');
      execFileSync('git', ['add', '-f', '.atl/skill-registry.md'], { cwd: testRepoDir });

      const res = runCheck(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors).toContain('GENERATED_FILE_TRACKED .atl/skill-registry.md');
    });

    it('does not fail when an ungenerated legitimate file is inside .atl/', () => {
      mkdirSync(join(testRepoDir, '.atl'), { recursive: true });
      writeFileSync(join(testRepoDir, '.atl/custom-notes.txt'), 'Legitimate note');
      execFileSync('git', ['add', '.atl/custom-notes.txt'], { cwd: testRepoDir });

      const res = runCheck(testRepoDir);
      expect(res.status).toBe(0);
    });

    it.each([
      '.atl/',
      '.atl',
      '/.atl',
      '/.atl/',
      '.atl/*',
      '/.atl/*',
      '.atl/**',
      '/.atl/**',
      '**/.atl/',
      '**/.atl/**',
    ])('fails when .gitignore contains global ignore variant %s', (pattern) => {
      writeFileSync(
        join(testRepoDir, '.gitignore'),
        [
          'node_modules/',
          pattern,
          '.atl/.skill-registry.cache.json',
          '.atl/skill-registry.md',
        ].join('\n'),
      );

      const res = runCheck(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors.some((e) => e.includes('forbidden global ignore'))).toBe(true);
    });

    it('fails when .gitignore is missing explicit entries for generated files', () => {
      writeFileSync(join(testRepoDir, '.gitignore'), ['node_modules/'].join('\n'));

      const res = runCheck(testRepoDir);
      expect(res.status).toBe(1);
      expect(res.errors).toContain(
        "MISSING_GITIGNORE_RULE generated file '.atl/.skill-registry.cache.json' must be explicitly ignored in .gitignore",
      );
      expect(res.errors).toContain(
        "MISSING_GITIGNORE_RULE generated file '.atl/skill-registry.md' must be explicitly ignored in .gitignore",
      );
    });
  });
});
