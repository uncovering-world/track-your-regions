#!/usr/bin/env node
/**
 * The screen-text allowances only go down (#2433): a file's count in
 * `frontend/screenTextAllowance.mjs` or `backend/screenTextAllowance.mjs`
 * that is higher than at the base, or a file the base did not list, fails the
 * gate unless a commit on the branch says why.
 *
 *   node scripts/check-screen-allowance.mjs    against the base `scripts/gates.mjs` settles on
 *
 * The lint holds a file to its count, so a breach added beside a raised count
 * passes it: this is the check that the count was not raised. A count can
 * rise for a reason, when the rule itself reads more than it did. Such a rise
 * is named in a commit body on the branch, one line per file, with its reason:
 *
 *   Screen-text-allowance: frontend/src/components/admin/PassCard.tsx -- the rule now reads a fragment's text
 *
 * An allowance file the base does not hold is the first one, and sets the counts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { changedPaths } from './gates-base.mjs';
import { repoFile } from './repo-root.mjs';

/** The allowance files, each beside the package whose paths its keys are relative to. */
export const ALLOWANCE_FILES = ['frontend/screenTextAllowance.mjs', 'backend/screenTextAllowance.mjs'];

const TRAILER = /^Screen-text-allowance:[ \t]*(\S+)[ \t]+--[ \t]+\S.*$/gm;

/** The paths the branch's commit bodies name as allowed to rise, each with a reason. */
export function namedRises(messages) {
  return new Set([...String(messages).matchAll(TRAILER)].map(([, path]) => path));
}

/**
 * The entries that rose or arrived, as `{ path, before, after }` with `before`
 * null for a new entry: `before` and `after` are one allowance file's map at
 * the base and now, `prefix` the package its keys are relative to.
 */
export function raisedAllowances(before, after, prefix, named = new Set()) {
  return Object.entries(after)
    .map(([key, { breaches }]) => ({ path: `${prefix}/${key}`, before: before[key]?.breaches ?? null, after: breaches }))
    .filter(({ path, before: was, after: now }) => !named.has(path) && (was === null || now > was));
}

/** An allowance module's map, read from its text without a file on disk. */
async function allowanceOf(text) {
  const module = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  return module.SCREEN_TEXT_ALLOWANCE;
}

async function main() {
  const { mergeBase, reason } = changedPaths({ base: undefined, rev: 'HEAD' });
  if (!mergeBase) {
    console.log(`No base to compare the screen-text allowances with: ${reason}`);
    return 0;
  }
  const git = (...args) => execFileSync('git', args, { cwd: repoFile(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const named = namedRises(git('log', '--format=%B', `${mergeBase}..HEAD`));
  const raised = [];
  for (const file of ALLOWANCE_FILES) {
    let atBase;
    try {
      atBase = execFileSync('git', ['show', `${mergeBase}:${file}`], { cwd: repoFile(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // The base holds no allowance file yet: this one is the first.
      continue;
    }
    const prefix = file.slice(0, file.indexOf('/'));
    raised.push(...raisedAllowances(await allowanceOf(atBase), await allowanceOf(readFileSync(repoFile(file), 'utf8')), prefix, named));
  }
  if (raised.length === 0) {
    console.log(`No screen-text allowance rose against ${mergeBase.slice(0, 9)}.`);
    return 0;
  }
  for (const { path, before, after } of raised) {
    console.error(before === null ? `${path}: a new allowance of ${after}` : `${path}: allowance rose from ${before} to ${after}`);
  }
  console.error(
    '\nAn allowance only goes down: write the new text to docs/tech/interface-writing.md instead. If the rule now reads'
    + ' more than it did, say so in a commit body on the branch, one line per file:\n\n  Screen-text-allowance: <path> -- <why>\n',
  );
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith('check-screen-allowance.mjs')) process.exit(await main());
