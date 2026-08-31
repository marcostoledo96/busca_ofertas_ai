#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const GENERATED_FILES = ['.atl/.skill-registry.cache.json', '.atl/skill-registry.md'];

const FORBIDDEN_GLOBAL_IGNORE_PATTERNS = [/^\/?\.atl\/?$/, /^\/?\.atl\/\*$/];

export function checkGeneratedFiles(rootDir = process.cwd()) {
  const errors = [];
  const resolvedRoot = resolve(rootDir);

  // 1. Check if generated files are tracked by Git
  try {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
      cwd: resolvedRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const trackedFiles = stdout.split('\0').filter(Boolean);
    for (const file of trackedFiles) {
      const normalizedPath = file.replace(/\\/g, '/');
      if (GENERATED_FILES.includes(normalizedPath)) {
        errors.push(`GENERATED_FILE_TRACKED ${normalizedPath}`);
      }
    }
  } catch (error) {
    errors.push(`GIT_LS_FILES_FAILED: ${error.message}`);
  }

  // 2. Validate .gitignore
  const gitignorePath = join(resolvedRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    errors.push('GITIGNORE_MISSING: .gitignore file not found');
  } else {
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    const lines = gitignoreContent.split('\n').map((l) => l.trim());

    // Check for forbidden global .atl/ ignores
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      for (const pattern of FORBIDDEN_GLOBAL_IGNORE_PATTERNS) {
        if (pattern.test(line)) {
          errors.push(
            `INVALID_GITIGNORE_RULE forbidden global ignore '${line}' detected; use specific file entries instead`,
          );
        }
      }
    }

    // Check that exact generated files are ignored
    for (const genFile of GENERATED_FILES) {
      const hasExactIgnore = lines.some((line) => line === genFile || line === `/${genFile}`);
      if (!hasExactIgnore) {
        errors.push(
          `MISSING_GITIGNORE_RULE generated file '${genFile}' must be explicitly ignored in .gitignore`,
        );
      }
    }
  }

  return errors;
}

// Run CLI if executed directly
const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1]);
if (isDirectExecution) {
  const targetDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const errors = checkGeneratedFiles(targetDir);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  } else {
    console.log('OK: No generated registry files tracked and .gitignore rules are valid.');
    process.exit(0);
  }
}
