#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import YAML from 'yaml';

const SHA40_REGEX = /^[0-9a-f]{40}$/i;

function safeParseYaml(filePath, errors) {
  if (!existsSync(filePath)) {
    errors.push(`FILE_MISSING: ${filePath} does not exist`);
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return YAML.parse(content, { prettyErrors: false });
  } catch (err) {
    const errorType = err.code || err.name || 'YAMLParseError';
    const lineInfo = err.linePos?.[0]?.line ? ` at line ${err.linePos[0].line}` : '';
    errors.push(`YAML_PARSE_ERROR: Failed to parse ${filePath}: ${errorType}${lineInfo}`);
    return null;
  }
}

export function validateProvenance(rootDir = process.cwd()) {
  const errors = [];
  const root = resolve(rootDir);

  const upstreamsPath = join(root, 'UPSTREAMS.lock.yml');
  const gentlePath = join(root, 'GENTLE_AI.lock.yml');
  const skillsPath = join(root, '.agents/skills.lock.yml');
  const noticesPath = join(root, 'THIRD_PARTY_NOTICES.md');

  // 1. Validate UPSTREAMS.lock.yml
  const upstreamsData = safeParseYaml(upstreamsPath, errors);
  const upstreamsById = new Map();

  if (upstreamsData) {
    if (upstreamsData.version !== 2) {
      errors.push(
        `UPSTREAMS_UNSUPPORTED_VERSION: Expected version 2, got ${upstreamsData.version}`,
      );
    }
    if (!Array.isArray(upstreamsData.upstreams)) {
      errors.push("UPSTREAMS_INVALID: 'upstreams' must be an array");
    } else {
      for (const item of upstreamsData.upstreams) {
        if (!item || typeof item !== 'object') {
          errors.push('UPSTREAMS_INVALID: upstream entry must be an object');
          continue;
        }
        if (!item.id || typeof item.id !== 'string') {
          errors.push('UPSTREAMS_INVALID: upstream entry missing valid id');
          continue;
        }
        if (upstreamsById.has(item.id)) {
          errors.push(`UPSTREAMS_DUPLICATE_ID: duplicate upstream id '${item.id}'`);
        }
        upstreamsById.set(item.id, item);

        if (!item.repository || typeof item.repository !== 'string') {
          errors.push(`UPSTREAMS_INVALID: upstream '${item.id}' missing repository`);
        }
        if (item.sha) {
          if (!SHA40_REGEX.test(item.sha)) {
            errors.push(
              `UPSTREAMS_INVALID_SHA: upstream '${item.id}' sha must be 40 hex characters, got '${item.sha}'`,
            );
          }
        }
        if (!item.license || typeof item.license !== 'string') {
          errors.push(`UPSTREAMS_INVALID: upstream '${item.id}' missing license`);
        }
        if (!item.role || typeof item.role !== 'string') {
          errors.push(`UPSTREAMS_INVALID: upstream '${item.id}' missing role`);
        }
        if (!item.status || typeof item.status !== 'string') {
          errors.push(`UPSTREAMS_INVALID: upstream '${item.id}' missing status`);
        }

        if (item.lock) {
          if (typeof item.lock !== 'string' || item.lock.includes('..') || isAbsolute(item.lock)) {
            errors.push(
              `UPSTREAMS_INVALID_LOCK_PATH: upstream '${item.id}' has invalid lock path '${item.lock}'`,
            );
          } else {
            const lockFileFullPath = join(root, item.lock);
            if (!existsSync(lockFileFullPath)) {
              errors.push(
                `UPSTREAMS_LOCK_NOT_FOUND: lock file '${item.lock}' for upstream '${item.id}' not found`,
              );
            }
          }
        }
      }
    }
  }

  // 2. Validate GENTLE_AI.lock.yml
  const gentleData = safeParseYaml(gentlePath, errors);
  if (gentleData) {
    if (gentleData.schemaVersion !== 1) {
      errors.push(`GENTLE_AI_INVALID: schemaVersion must be 1, got ${gentleData.schemaVersion}`);
    }
    if (gentleData.tool?.runtime !== 'antigravity') {
      errors.push(
        `GENTLE_AI_INVALID: tool.runtime must be 'antigravity', got ${gentleData.tool?.runtime}`,
      );
    }
    if (gentleData.tool?.vendoredBinary !== false) {
      errors.push(`GENTLE_AI_INVALID: tool.vendoredBinary must be false`);
    }
    if (gentleData.policy?.automaticUpgrade !== false) {
      errors.push(`GENTLE_AI_INVALID: policy.automaticUpgrade must be false`);
    }
    if (!gentleData.tool?.commit || !SHA40_REGEX.test(gentleData.tool.commit)) {
      errors.push(
        `GENTLE_AI_INVALID_SHA: tool.commit must be 40 hex chars, got '${gentleData.tool?.commit}'`,
      );
    }

    // Cross-check with UPSTREAMS.lock.yml
    const gentleUpstream = upstreamsById.get('gentle-ai');
    if (!gentleUpstream) {
      errors.push("PROVENANCE_MISMATCH: 'gentle-ai' upstream entry missing in UPSTREAMS.lock.yml");
    } else {
      if (gentleUpstream.repository !== gentleData.tool?.repository) {
        errors.push(
          `PROVENANCE_MISMATCH: gentle-ai repository mismatch ('${gentleUpstream.repository}' vs '${gentleData.tool?.repository}')`,
        );
      }
      if (gentleUpstream.release !== gentleData.tool?.release) {
        errors.push(
          `PROVENANCE_MISMATCH: gentle-ai release mismatch ('${gentleUpstream.release}' vs '${gentleData.tool?.release}')`,
        );
      }
      if (gentleUpstream.sha !== gentleData.tool?.commit) {
        errors.push(
          `PROVENANCE_MISMATCH: gentle-ai commit SHA mismatch ('${gentleUpstream.sha}' vs '${gentleData.tool?.commit}')`,
        );
      }
      if (gentleData.tool?.license && gentleUpstream.license !== gentleData.tool.license) {
        errors.push(
          `PROVENANCE_MISMATCH: gentle-ai license mismatch ('${gentleUpstream.license}' vs '${gentleData.tool?.license}')`,
        );
      }
      if (gentleUpstream.lock !== 'GENTLE_AI.lock.yml') {
        errors.push(
          `PROVENANCE_MISMATCH: gentle-ai lock path in UPSTREAMS must be 'GENTLE_AI.lock.yml'`,
        );
      }
    }
  }

  // 3. Validate .agents/skills.lock.yml
  const skillsData = safeParseYaml(skillsPath, errors);
  if (skillsData) {
    if (skillsData.schemaVersion !== 1) {
      errors.push(`SKILLS_LOCK_INVALID: schemaVersion must be 1, got ${skillsData.schemaVersion}`);
    }
    if (skillsData.installRoot !== '.agents/skills') {
      errors.push(
        `SKILLS_LOCK_INVALID: installRoot must be '.agents/skills', got ${skillsData.installRoot}`,
      );
    }
    if (!skillsData.source?.sha || !SHA40_REGEX.test(skillsData.source.sha)) {
      errors.push(
        `SKILLS_LOCK_INVALID_SHA: source.sha must be 40 hex chars, got '${skillsData.source?.sha}'`,
      );
    }

    // Cross-check with UPSTREAMS.lock.yml
    const skillsUpstream = upstreamsById.get('mattpocock-skills');
    if (!skillsUpstream) {
      errors.push(
        "PROVENANCE_MISMATCH: 'mattpocock-skills' upstream entry missing in UPSTREAMS.lock.yml",
      );
    } else {
      if (skillsUpstream.repository !== skillsData.source?.repository) {
        errors.push(
          `PROVENANCE_MISMATCH: mattpocock-skills repository mismatch ('${skillsUpstream.repository}' vs '${skillsData.source?.repository}')`,
        );
      }
      if (skillsUpstream.sha !== skillsData.source?.sha) {
        errors.push(
          `PROVENANCE_MISMATCH: mattpocock-skills commit SHA mismatch ('${skillsUpstream.sha}' vs '${skillsData.source?.sha}')`,
        );
      }
      if (skillsData.source?.license && skillsUpstream.license !== skillsData.source.license) {
        errors.push(
          `PROVENANCE_MISMATCH: mattpocock-skills license mismatch ('${skillsUpstream.license}' vs '${skillsData.source?.license}')`,
        );
      }
      if (skillsUpstream.lock !== '.agents/skills.lock.yml') {
        errors.push(
          `PROVENANCE_MISMATCH: mattpocock-skills lock path in UPSTREAMS must be '.agents/skills.lock.yml'`,
        );
      }
    }

    // Check individual skills
    const skillIds = new Set();
    if (Array.isArray(skillsData.skills)) {
      for (const skill of skillsData.skills) {
        if (!skill.id) {
          errors.push('SKILLS_LOCK_INVALID: skill missing id');
          continue;
        }
        if (skillIds.has(skill.id)) {
          errors.push(`SKILLS_LOCK_DUPLICATE: duplicate skill id '${skill.id}'`);
        }
        skillIds.add(skill.id);

        if (
          !skill.localPath ||
          typeof skill.localPath !== 'string' ||
          skill.localPath.includes('..') ||
          !skill.localPath.startsWith('.agents/skills/')
        ) {
          errors.push(
            `SKILLS_LOCK_INVALID_PATH: skill '${skill.id}' has invalid localPath '${skill.localPath}'`,
          );
        } else {
          if (skill.status === 'active') {
            const skillMdPath = join(root, skill.localPath, 'SKILL.md');
            if (!existsSync(skillMdPath)) {
              errors.push(
                `SKILL_FILE_MISSING: SKILL.md for active skill '${skill.id}' not found at '${skill.localPath}/SKILL.md'`,
              );
            }
          }
        }
      }

      // Check required active boai-* skills
      const requiredSkills = [
        'boai-domain-modeling',
        'boai-codebase-design',
        'boai-module-boundaries',
      ];
      for (const reqSkill of requiredSkills) {
        if (!skillIds.has(reqSkill)) {
          errors.push(
            `REQUIRED_SKILL_MISSING: active skill '${reqSkill}' not represented in .agents/skills.lock.yml`,
          );
        }
      }
    } else {
      errors.push("SKILLS_LOCK_INVALID: 'skills' must be an array");
    }

    // Check license file
    const skillLicensePath = join(root, '.agents/skills/_licenses/mattpocock-skills-MIT.txt');
    if (!existsSync(skillLicensePath)) {
      errors.push(
        "SKILL_LICENSE_MISSING: '.agents/skills/_licenses/mattpocock-skills-MIT.txt' not found",
      );
    }
  }

  // 4. Validate THIRD_PARTY_NOTICES.md
  if (!existsSync(noticesPath)) {
    errors.push('NOTICES_MISSING: THIRD_PARTY_NOTICES.md not found');
  } else {
    const noticesContent = readFileSync(noticesPath, 'utf-8');
    // Ensure all upstreams are referenced in notices
    for (const [upstreamId, upstream] of upstreamsById.entries()) {
      const repoUrl = upstream.repository;
      const repoShort = repoUrl.replace(/^https:\/\/github\.com\//, '');
      const sha = upstream.sha;
      const release = upstream.release;

      const mentionsRepo = noticesContent.includes(repoShort) || noticesContent.includes(repoUrl);
      if (!mentionsRepo) {
        errors.push(
          `NOTICES_MISSING_ENTRY: upstream '${upstreamId}' repository '${repoShort}' not found in THIRD_PARTY_NOTICES.md`,
        );
      }
      if (sha && !noticesContent.includes(sha)) {
        errors.push(
          `NOTICES_MISSING_SHA: upstream '${upstreamId}' sha '${sha}' not referenced in THIRD_PARTY_NOTICES.md`,
        );
      }
      if (release && !noticesContent.includes(release)) {
        errors.push(
          `NOTICES_MISSING_RELEASE: upstream '${upstreamId}' release '${release}' not referenced in THIRD_PARTY_NOTICES.md`,
        );
      }
    }
  }

  // 5. Validate CI Action & Reusable Workflow Pinning against UPSTREAMS.lock.yml
  const workflowsDir = join(root, '.github/workflows');
  if (existsSync(workflowsDir)) {
    const workflowFiles = readdirSync(workflowsDir).filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    );
    for (const wfFile of workflowFiles) {
      const wfPath = join(workflowsDir, wfFile);
      const wfData = safeParseYaml(wfPath, errors);
      if (!wfData || !wfData.jobs) continue;

      for (const [jobId, job] of Object.entries(wfData.jobs)) {
        if (!job || typeof job !== 'object') continue;

        const usesEntries = [];
        if (job.uses && typeof job.uses === 'string') {
          usesEntries.push({ uses: job.uses.trim(), source: `job '${jobId}'` });
        }
        if (Array.isArray(job.steps)) {
          for (const step of job.steps) {
            if (step && step.uses && typeof step.uses === 'string') {
              usesEntries.push({
                uses: step.uses.trim(),
                source: `step '${step.name || step.uses}'`,
              });
            }
          }
        }

        for (const entry of usesEntries) {
          const uses = entry.uses;
          if (uses.startsWith('./')) {
            // Local action or local reusable workflow is fine
            continue;
          }

          const atIndex = uses.indexOf('@');
          if (atIndex === -1) {
            errors.push(
              `UNPINNED_ACTION: Workflow '${wfFile}' ${entry.source} uses unpinned action '${uses}'`,
            );
            continue;
          }

          const actionTarget = uses.substring(0, atIndex);
          const actionRef = uses.substring(atIndex + 1);

          if (!SHA40_REGEX.test(actionRef)) {
            errors.push(
              `MUTABLE_ACTION_REF: Workflow '${wfFile}' action '${actionTarget}' is pinned to mutable ref '${actionRef}' instead of 40-char SHA`,
            );
            continue;
          }

          // Extract repo path for reusable workflows (e.g. owner/repo/.github/workflows/foo.yml -> owner/repo)
          const repoTarget = actionTarget.includes('/.github/workflows/')
            ? actionTarget.substring(0, actionTarget.indexOf('/.github/workflows/'))
            : actionTarget;

          // Match with UPSTREAMS.lock.yml
          const matchingUpstream = Array.from(upstreamsById.values()).find((u) => {
            const normalizedUpstreamRepo = u.repository.replace(/^https:\/\/github\.com\//, '');
            return (
              normalizedUpstreamRepo === repoTarget ||
              normalizedUpstreamRepo.toLowerCase() === repoTarget.toLowerCase()
            );
          });

          if (!matchingUpstream) {
            errors.push(
              `ACTION_NOT_IN_UPSTREAMS: Workflow '${wfFile}' action '${actionTarget}' has no entry in UPSTREAMS.lock.yml`,
            );
          } else {
            if (matchingUpstream.sha !== actionRef) {
              errors.push(
                `ACTION_SHA_MISMATCH: Workflow '${wfFile}' action '${actionTarget}' uses SHA '${actionRef}' but UPSTREAMS declares '${matchingUpstream.sha}'`,
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

// Run CLI
const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1]);
if (isDirectExecution) {
  const targetDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const errors = validateProvenance(targetDir);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  } else {
    console.log('OK: Provenance and action locks validated successfully.');
    process.exit(0);
  }
}
