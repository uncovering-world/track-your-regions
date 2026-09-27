#!/usr/bin/env node
/**
 * Name every change to the OpenAPI document that breaks a client built
 * against the previous one (#1090, ADR-0072).
 *
 *   node scripts/openapi-breaking.mjs      what this change breaks, against its base
 *
 * The document at the merge base (the base `scripts/gates.mjs` settles on:
 * `GATES_BASE`, else `main`) is compared with the one in the working tree by
 * oasdiff, pinned by digest like the other Docker tools. A removed path, a
 * response field removed or narrowed, a request field newly required: each is
 * printed, annotated on the CI run, and written to the job summary.
 *
 * The policy is `warn`: the web ships with the backend it calls, so a break
 * is at worst a build that fails in the same pull request. A native client
 * installed on a phone does not ship with the backend, and when the first one
 * exists the policy becomes `fail` — `docs/tech/gates.md` § The API contract
 * says how a deliberate break is then let through.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedPaths } from './gates.mjs';
import { repoFile } from './repo-root.mjs';

export const DOCUMENT = 'packages/shared/src/openapi.generated.json';
export const OASDIFF = 'tufin/oasdiff:v1.32.1@sha256:3b14fe0112e5d1bf862f91ab234a4bcd161a3f399e98f8b0b665ce70857694ac';

/** `warn` until a native client exists, then `fail` (the module docblock says why). */
export const POLICY = 'warn';

/**
 * oasdiff's findings, split by its own level: 3 is a change that breaks a
 * client, 2 one that may, depending on how the client reads the field.
 */
export function countFindings(findings) {
  return {
    breaking: findings.filter((finding) => finding.level >= 3).length,
    possible: findings.filter((finding) => finding.level === 2).length,
  };
}

/**
 * The line and exit code for a comparison that could not be made: a merge base
 * that was expected and not found (a shallow checkout, a base that is not an
 * ancestor). Never a silent pass — the run is annotated — and it earns what a
 * break would under the policy, since a contract nobody compared may be broken.
 */
export function uncompared(reason, policy) {
  const level = policy === 'fail' ? 'error' : 'warning';
  return {
    line: `::${level} title=OpenAPI contract::The OpenAPI document was not compared with a base: ${reason}`,
    code: exitCodeFor(policy, 1),
  };
}

/** The exit code a count of breaking changes earns under a policy. */
export function exitCodeFor(policy, breaking) {
  return policy === 'fail' && breaking > 0 ? 1 : 0;
}

/**
 * The one line a CI run shows for the whole comparison, or nothing where
 * oasdiff found nothing. A certain break takes the policy's level; a possible
 * one alone is always a warning, since whether it breaks depends on the client.
 */
export function annotation({ breaking, possible }, policy) {
  if (breaking > 0) {
    const level = policy === 'fail' ? 'error' : 'warning';
    const noun = breaking === 1 ? 'change breaks' : 'changes break';
    const also = possible > 0 ? `, and ${possible} more may` : '';
    return `::${level} title=OpenAPI contract::${breaking} ${noun} a client built against the base document${also} (${DOCUMENT})`;
  }
  if (possible > 0) {
    const noun = possible === 1 ? 'change may break' : 'changes may break';
    return `::warning title=OpenAPI contract::${possible} ${noun} a client built against the base document (${DOCUMENT})`;
  }
  return null;
}

function oasdiff(dir, format) {
  const result = spawnSync('docker', [
    'run', '--rm', '-v', `${dir}:/specs:ro,z`, OASDIFF,
    'breaking', '/specs/base.json', '/specs/head.json', '--format', format,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`oasdiff failed (exit ${result.status}): ${result.stderr || result.error?.message}`);
  }
  return result.stdout;
}

function main() {
  const { base: named, mergeBase, reason: why } = changedPaths({ base: undefined, rev: 'HEAD' });
  // The map's reason ends in what it decides about gates, which is not this
  // check's to say.
  const reason = (why ?? '').replace(/,? so every gate applies\.?$/, '');
  if (!named) {
    // No base was named at all — the zero sha CI sends on purpose for a
    // scheduled or dispatched run, an empty GATES_BASE — so there is no
    // earlier contract this run was asked about.
    console.log(`No base was named, so there is no earlier OpenAPI document to compare with: ${reason}`);
    return 0;
  }
  if (!mergeBase) {
    const { line, code } = uncompared(reason, POLICY);
    console.log(`The OpenAPI document was not compared with a base: ${reason}`);
    if (process.env.GITHUB_ACTIONS) console.log(line);
    return code;
  }
  // Whether the base holds the document at all, asked of the tree rather than
  // read from an error: `git ls-tree` prints nothing for a path the commit
  // does not have, and fails outright on a commit it cannot read — which then
  // fails this check instead of passing it as "no earlier contract".
  const git = (...args) => execFileSync('git', args, { cwd: repoFile(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (git('ls-tree', mergeBase, '--', DOCUMENT).trim() === '') {
    console.log(`The base ${mergeBase.slice(0, 9)} has no ${DOCUMENT}: there is no earlier contract to break.`);
    return 0;
  }
  const document = git('show', `${mergeBase}:${DOCUMENT}`);

  const dir = mkdtempSync(join(tmpdir(), 'openapi-breaking-'));
  try {
    writeFileSync(join(dir, 'base.json'), document);
    writeFileSync(join(dir, 'head.json'), readFileSync(repoFile(...DOCUMENT.split('/')), 'utf8'));
    const counts = countFindings(JSON.parse(oasdiff(dir, 'json') || '[]'));
    const { breaking, possible } = counts;
    console.log(`OpenAPI document against ${mergeBase.slice(0, 9)}: ${breaking} breaking change(s), `
      + `${possible} possibly breaking, policy ${POLICY}.`);
    if (breaking + possible > 0) {
      const report = oasdiff(dir, 'markdown');
      console.log(report);
      const line = annotation(counts, POLICY);
      if (process.env.GITHUB_ACTIONS && line) console.log(line);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `## OpenAPI contract: ${breaking} breaking, ${possible} possibly breaking\n\n${report}\n`);
      }
    }
    return exitCodeFor(POLICY, breaking);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('openapi-breaking.mjs')) process.exit(main());
