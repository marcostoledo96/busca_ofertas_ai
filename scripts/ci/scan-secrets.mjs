#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// Sensitive path rules
const SENSITIVE_FILENAME_PATTERNS = [
  {
    id: 'SENSITIVE_ENV_FILE',
    test: (filename) => {
      if (filename === '.env.example' || filename === '.env.test.example') {
        return false;
      }
      return filename === '.env' || filename.startsWith('.env.');
    },
  },
  {
    id: 'SENSITIVE_KEY_CERT_FILE',
    test: (filename) => {
      return /\.(pem|key|p12|pfx)$/i.test(filename);
    },
  },
  {
    id: 'SENSITIVE_STORAGE_STATE',
    test: (filename) => {
      return /^storageState.*\.json$/i.test(filename);
    },
  },
];

const SENSITIVE_PATH_PATTERNS = [
  {
    id: 'SENSITIVE_AUTH_SESSION_DIR',
    test: (relPath) => {
      const normalized = relPath.replace(/\\/g, '/');
      return (
        normalized.startsWith('.auth/') ||
        normalized.includes('/.auth/') ||
        normalized.startsWith('playwright/.auth/') ||
        normalized.includes('/playwright/.auth/') ||
        normalized.startsWith('sessions/') ||
        normalized.includes('/sessions/')
      );
    },
  },
];

// Content patterns (high confidence)
const CONTENT_RULES = [
  {
    id: 'PRIVATE_KEY_PEM_HEADER',
    regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/,
  },
  {
    id: 'GITHUB_TOKEN_CLASSIC',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/,
  },
  {
    id: 'GITHUB_TOKEN_FINE_GRAINED',
    regex: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/,
  },
  {
    id: 'AWS_ACCESS_KEY_ID',
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'HIGH_CONFIDENCE_SECRET_ASSIGNMENT',
    // Matches explicit assignment of long high-entropy credential strings, excluding common placeholders
    regex:
      /(?:api[_-]?key|auth[_-]?token|secret[_-]?key|private[_-]?key|password|access[_-]?token)\s*[:=]\s*['"](?!(?:placeholder|dummy|<[^>]+>|example|fake|test|TODO|xxx|changeme|your[_-]|none|null|undefined|false|true)\b)[A-Za-z0-9_\-.~+/=]{20,}['"]/i,
  },
];

function isBinaryBuffer(buffer) {
  const checkLength = Math.min(buffer.length, 8000);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

export function scanSecrets(rootDir = process.cwd()) {
  const findings = [];
  const resolvedRoot = resolve(rootDir);

  let trackedFiles = [];
  try {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
      cwd: resolvedRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackedFiles = stdout.split('\0').filter(Boolean);
  } catch (error) {
    findings.push({
      ruleId: 'GIT_LS_FILES_FAILED',
      path: 'repo',
      line: 1,
      message: `Failed to list tracked git files: ${error.message}`,
    });
    return findings;
  }

  for (const relPath of trackedFiles) {
    const normalizedRelPath = relPath.replace(/\\/g, '/');
    const fullPath = join(resolvedRoot, relPath);
    const fileName = basename(normalizedRelPath);

    // 1. Check path/filename rules
    for (const rule of SENSITIVE_FILENAME_PATTERNS) {
      if (rule.test(fileName)) {
        findings.push({
          ruleId: rule.id,
          path: normalizedRelPath,
          line: 1,
        });
      }
    }

    for (const rule of SENSITIVE_PATH_PATTERNS) {
      if (rule.test(normalizedRelPath)) {
        findings.push({
          ruleId: rule.id,
          path: normalizedRelPath,
          line: 1,
        });
      }
    }

    if (!existsSync(fullPath)) continue;

    try {
      const stats = statSync(fullPath);
      if (stats.isDirectory()) continue;

      const buffer = readFileSync(fullPath);
      if (isBinaryBuffer(buffer)) {
        // Binary files should not be parsed as text
        continue;
      }

      const content = buffer.toString('utf-8');
      const lines = content.split('\n');

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineContent = lines[lineIndex];
        const lineNumber = lineIndex + 1;

        for (const rule of CONTENT_RULES) {
          if (rule.regex.test(lineContent)) {
            findings.push({
              ruleId: rule.id,
              path: normalizedRelPath,
              line: lineNumber,
            });
          }
        }
      }
    } catch {
      // In case of read errors on tracked files, record finding without leaking content
      findings.push({
        ruleId: 'FILE_READ_ERROR',
        path: normalizedRelPath,
        line: 1,
      });
    }
  }

  return findings;
}

// Run CLI
const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1]);
if (isDirectExecution) {
  const targetDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const findings = scanSecrets(targetDir);

  if (findings.length > 0) {
    for (const finding of findings) {
      // STRICT ZERO-LEAK OUTPUT CONTRACT: SECRET_DETECTED <RULE_ID> <relative/path>:<line>
      console.error(`SECRET_DETECTED ${finding.ruleId} ${finding.path}:${finding.line}`);
    }
    process.exit(1);
  } else {
    console.log('OK: Secret scan completed. No tracked secrets detected.');
    process.exit(0);
  }
}
