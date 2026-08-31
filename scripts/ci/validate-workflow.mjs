#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import YAML from 'yaml';

const SHA40_REGEX = /^[0-9a-f]{40}$/i;

const REQUIRED_STEPS_COMMANDS = [
  'node scripts/ci/check-generated-files.mjs',
  'node scripts/ci/scan-secrets.mjs',
  'pnpm audit --audit-level=high',
  'pnpm install --frozen-lockfile',
  'pnpm clean',
  'pnpm format:check',
  'pnpm lint',
  'pnpm lint:boundaries',
  'pnpm typecheck',
  'pnpm test',
  'pnpm build',
  'pnpm ci:provenance',
  'pnpm ci:workflow',
  'git diff --exit-code',
];

export function validateWorkflow(rootDir = process.cwd()) {
  const errors = [];
  const root = resolve(rootDir);
  const workflowPath = join(root, '.github/workflows/ci.yml');

  if (!existsSync(workflowPath)) {
    errors.push('WORKFLOW_MISSING: .github/workflows/ci.yml does not exist');
    return errors;
  }

  let workflowContent;
  let doc;
  try {
    workflowContent = readFileSync(workflowPath, 'utf-8');
    doc = YAML.parse(workflowContent);
  } catch (err) {
    errors.push(`WORKFLOW_PARSE_ERROR: Failed to parse .github/workflows/ci.yml: ${err.message}`);
    return errors;
  }

  if (!doc || typeof doc !== 'object') {
    errors.push('WORKFLOW_INVALID: Root must be a valid YAML object');
    return errors;
  }

  // 1. Triggers
  const triggers = doc.on ?? doc.true;
  const onKeys =
    triggers && typeof triggers === 'object'
      ? Array.isArray(triggers)
        ? triggers
        : Object.keys(triggers)
      : typeof triggers === 'string'
        ? [triggers]
        : [];

  if (
    doc.pull_request_target ||
    (triggers && typeof triggers === 'object' && 'pull_request_target' in triggers)
  ) {
    errors.push('FORBIDDEN_TRIGGER: pull_request_target trigger is strictly prohibited');
  }

  const hasPush =
    onKeys.includes('push') || (triggers && typeof triggers === 'object' && 'push' in triggers);
  const hasPR =
    onKeys.includes('pull_request') ||
    (triggers && typeof triggers === 'object' && 'pull_request' in triggers);

  if (!hasPush) {
    errors.push("MISSING_TRIGGER: Workflow must trigger on 'push'");
  }
  if (!hasPR) {
    errors.push("MISSING_TRIGGER: Workflow must trigger on 'pull_request'");
  }

  // 2. Permissions
  const permissions = doc.permissions;
  if (!permissions) {
    errors.push('MISSING_PERMISSIONS: Workflow must explicitly specify top-level permissions');
  } else if (typeof permissions === 'string') {
    if (permissions !== 'read-all') {
      errors.push(
        `INVALID_PERMISSIONS: Unexpected permissions string '${permissions}', expected explicit 'contents: read'`,
      );
    }
  } else if (typeof permissions === 'object') {
    if (permissions.contents !== 'read') {
      errors.push(
        `INVALID_PERMISSIONS: 'contents' permission must be 'read', got '${permissions.contents}'`,
      );
    }
    for (const [permKey, permVal] of Object.entries(permissions)) {
      if (permVal === 'write') {
        errors.push(`FORBIDDEN_PERMISSIONS: 'write' permission on '${permKey}' is prohibited`);
      }
    }
  }

  // 3. Jobs & Steps
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== 'object') {
    errors.push("MISSING_JOBS: Workflow must define 'jobs'");
    return errors;
  }

  const allSteps = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;

    // Check job-level permissions for any write
    if (job.permissions && typeof job.permissions === 'object') {
      for (const [permKey, permVal] of Object.entries(job.permissions)) {
        if (permVal === 'write') {
          errors.push(
            `FORBIDDEN_PERMISSIONS: Job '${jobId}' defines forbidden 'write' permission on '${permKey}'`,
          );
        }
      }
    }

    if (Array.isArray(job.steps)) {
      allSteps.push(...job.steps);
    }
  }

  // 4. Action Pinning & Step Configuration
  let hasCheckout = false;
  let hasSetupNode = false;
  let hasPnpmSetup = false;

  for (const step of allSteps) {
    if (!step) continue;

    if (step.uses) {
      const uses = step.uses.trim();
      if (!uses.startsWith('./')) {
        const atIndex = uses.indexOf('@');
        if (atIndex === -1) {
          errors.push(`UNPINNED_ACTION: Step uses unpinned action '${uses}'`);
        } else {
          const actionTarget = uses.substring(0, atIndex);
          const actionRef = uses.substring(atIndex + 1);

          if (!SHA40_REGEX.test(actionRef)) {
            errors.push(
              `MUTABLE_ACTION_REF: Action '${actionTarget}' is pinned to mutable tag/branch '${actionRef}' instead of 40-char SHA`,
            );
          }

          if (actionTarget === 'actions/checkout') {
            hasCheckout = true;
            if (step.with?.['persist-credentials'] !== false) {
              errors.push(
                "CHECKOUT_PERSIST_CREDENTIALS: actions/checkout must set 'persist-credentials: false'",
              );
            }
          }

          if (actionTarget === 'actions/setup-node') {
            hasSetupNode = true;
            if (step.with?.['node-version-file'] !== '.nvmrc') {
              errors.push(
                "SETUP_NODE_VERSION_FILE: actions/setup-node must set node-version-file to '.nvmrc'",
              );
            }
            if (step.with?.cache !== 'pnpm') {
              errors.push("SETUP_NODE_CACHE: actions/setup-node must set cache to 'pnpm'");
            }
            if (step.with?.['cache-dependency-path'] !== 'pnpm-lock.yaml') {
              errors.push(
                "SETUP_NODE_CACHE_PATH: actions/setup-node must set cache-dependency-path to 'pnpm-lock.yaml'",
              );
            }
          }

          if (actionTarget === 'pnpm/action-setup') {
            hasPnpmSetup = true;
            if (step.with?.run_install !== false) {
              errors.push(
                "PNPM_SETUP_RUN_INSTALL: pnpm/action-setup must set 'run_install: false'",
              );
            }
          }
        }
      }
    }
  }

  if (!hasCheckout) errors.push("MISSING_STEP: 'actions/checkout' step not found");
  if (!hasSetupNode) errors.push("MISSING_STEP: 'actions/setup-node' step not found");
  if (!hasPnpmSetup) errors.push("MISSING_STEP: 'pnpm/action-setup' step not found");

  // 5. Secret references
  const forbiddenSecretPattern = /\$\{\{\s*secrets\./i;
  if (forbiddenSecretPattern.test(workflowContent)) {
    errors.push('FORBIDDEN_SECRET_REFERENCE: Workflow contains reference to secrets context');
  }

  // 6. Quality Gates / Required Commands
  const runCommands = allSteps.filter((s) => s && s.run).map((s) => s.run.trim());

  for (const reqCmd of REQUIRED_STEPS_COMMANDS) {
    const isIncluded = runCommands.some((cmd) => cmd === reqCmd || cmd.includes(reqCmd));
    if (!isIncluded) {
      errors.push(`MISSING_QUALITY_GATE: Required command '${reqCmd}' not found in workflow steps`);
    }
  }

  return errors;
}

// Run CLI
const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1]);
if (isDirectExecution) {
  const targetDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const errors = validateWorkflow(targetDir);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  } else {
    console.log('OK: CI workflow policy validated successfully.');
    process.exit(0);
  }
}
