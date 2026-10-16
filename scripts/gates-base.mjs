/**
 * What a change is, for the gate map (`scripts/gates.mjs`): the base it is
 * measured against and the paths it touches, asked of git, and the checkout's
 * own files as they are on disk. The map reads it and it reads nothing of the
 * map's. A change here decides what CI runs as much as a change to the map, so
 * it is one of `CI_GLOBAL` and of the cache key's globals.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Git, asked about the repository the command was run in.
 *
 * The three location variables are dropped from the environment: git sets them
 * for a hook, and a hook that ran this would otherwise have it read a temporary
 * index or another worktree entirely.
 */
export const git = (...args) => {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, env });
};

/**
 * Text collapsed to one line: git's own words inside a reason, and a reason
 * inside a GitHub Actions output, which holds one line.
 */
export const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

/** The prefix a changed npm script of the root package.json is reported under. */
export const SCRIPT_PREFIX = 'package.json#scripts/';

/** What GitHub sends as `before` for a branch's first push: no base at all. */
const ZERO_SHA = '0'.repeat(40);

/**
 * The base a local run measures against: `main`, unless `origin/main` has moved
 * past it. A clone's own `main` falls behind every merge made on GitHub, and a
 * change measured against a stale one counts every file merged since as its
 * own, asking for gates nothing on the branch touched. A local `main` with
 * commits of its own is the one meant, and is kept.
 */
export function freshestBase(present, isAncestor) {
  if (present.includes('main') && present.includes('origin/main') && isAncestor('main', 'origin/main')) {
    return 'origin/main';
  }
  return present[0];
}

/**
 * Which commit the change is measured against, or the reason there is none.
 *
 * A base that was *given* is authoritative, and that includes one given empty:
 * `--base`, or `GATES_BASE` merely being present in the environment, settles
 * the question and never falls back. CI sets the variable on every run and
 * sends the zero sha where the event carries no base of its own — a manual
 * dispatch, or a ref that had no previous tip — so it never sends an empty
 * value, and one arriving here was typed by a person or left by a later edit
 * of the workflow. Falling back to `main` in either case would compare the
 * checked-out tip with itself, find an empty change set and skip every gate:
 * a green run that checked nothing, which is the one outcome this file exists
 * to prevent. So an empty value and the zero sha both mean "no base", and
 * everything runs.
 *
 * Only an *unset* variable falls through to the local branches, which is the
 * case of a person running `npm run gates` in a checkout.
 */
function resolveBase(given) {
  let source = null;
  if (given !== null && given !== undefined) source = { name: '--base', value: given };
  else if ('GATES_BASE' in process.env) {
    source = { name: 'GATES_BASE', value: process.env.GATES_BASE };
  }

  if (source) {
    const named = (source.value ?? '').trim();
    if (named === '') {
      return {
        base: null,
        reason: `${source.name} is empty: nothing to diff against, so every gate applies.`,
      };
    }
    if (named === ZERO_SHA) {
      return {
        base: null,
        reason:
          `${source.name} is the zero sha, which names no commit (a first push,`
          + ' a ref just created, or a run with no base of its own): nothing to'
          + ' diff against, so every gate applies.',
      };
    }
    return { base: named, flag: source.name === '--base', reason: null };
  }

  const present = ['main', 'origin/main'].filter((ref) => {
    try {
      git('rev-parse', '--verify', '-q', ref);
      return true;
    } catch {
      return false; // not in this clone — give up rather than guess
    }
  });
  if (present.length) {
    const isAncestor = (older, newer) => {
      try {
        git('merge-base', '--is-ancestor', older, newer);
        return true;
      } catch {
        return false;
      }
    };
    return { base: freshestBase(present, isAncestor), reason: null };
  }
  return {
    base: null,
    reason:
      'No base to compare against (no --base, no GATES_BASE, no main, no origin/main),'
      + ' so every gate applies.',
  };
}

/**
 * What changed in the root package.json, as paths the map can read (ADR-0092).
 * Pure: the caller hands it both versions of the manifest.
 *
 * Each npm script whose text differs is `package.json#scripts/<name>`; a change
 * to the root's dependencies is the lockfile's business and is reported by it;
 * any other change — `engines`, a renamed field, a manifest that does not parse —
 * is `package.json#other`, which runs everything.
 */
export function packageChanges(before, after) {
  let old;
  let now;
  try {
    old = JSON.parse(before ?? '{}');
    now = JSON.parse(after ?? '{}');
  } catch {
    return ['package.json#other'];
  }
  const changed = [];
  const names = new Set([...Object.keys(old.scripts ?? {}), ...Object.keys(now.scripts ?? {})]);
  for (const name of [...names].sort()) {
    if ((old.scripts ?? {})[name] !== (now.scripts ?? {})[name]) changed.push(`${SCRIPT_PREFIX}${name}`);
  }
  const rest = (manifest) => {
    const { scripts, dependencies, devDependencies, ...others } = manifest;
    return JSON.stringify(others);
  };
  if (rest(old) !== rest(now)) changed.push('package.json#other');
  return changed;
}

/**
 * Which commit the change set is listed from. Pure: the caller says whether the
 * base came from `--base`, whether it is an ancestor of the revision, and
 * whether it lies on `main`'s line (an ancestor of `main` or `origin/main`).
 *
 * The merge base keeps out what the base's own line gained since the fork —
 * `main`'s commits, for a branch measured against `main` — and for a base that
 * is an ancestor it is the base itself. A base typed with `--base` that is *not*
 * an ancestor, and is not on `main`'s line either, is a pushed head the branch
 * has since rewritten past: a review wave folded into its commits, or a rebase.
 * Its merge base is the fork point from `main`, and listing from there reads
 * the wave as the whole branch. So the two trees are compared instead: what
 * differs from the tree the base holds, which is the one CI answered for. After
 * a rebase onto a newer `main` that also lists what `main` moved, which
 * over-reports — the safe direction.
 *
 * A `main` the branch forked from earlier (`--base origin/main` after a merge
 * on GitHub) is no ancestor either, and keeps the merge base: what it gained
 * since the fork is not the branch's. So does `GATES_BASE`, which CI sets from
 * the event: a pull request's base or a push's previous tip, never a head the
 * branch was rewritten past.
 */
export function listFrom({ base, flag, isAncestor, onMainLine, mergeBase }) {
  if (flag && !isAncestor && !onMainLine) return { from: base, how: 'tree' };
  return { from: mergeBase, how: 'merge-base' };
}

/**
 * The paths this change touches (impure: it asks git).
 *
 * `--no-renames` so that a file's old path counts as changed too: a gate whose
 * input was moved out from under it still has to run. Against `HEAD` the
 * comparison is the working tree rather than the commit, plus the files git
 * does not track yet, so that `npm run check` answers for what is on disk.
 */
export function changedPaths({ base, rev }) {
  const { base: resolved, flag, reason: noBase } = resolveBase(base);
  if (!resolved) {
    return { paths: null, base: null, mergeBase: null, reason: noBase };
  }

  let mergeBase;
  try {
    mergeBase = git('merge-base', resolved, rev).trim();
  } catch (error) {
    return {
      paths: null,
      base: resolved,
      mergeBase: null,
      reason:
        `No merge base between ${resolved} and ${rev}`
        + ` (${oneLine(error.stderr || error.message)}), so every gate applies.`,
    };
  }

  const isAncestorOf = (newer) => {
    try {
      git('merge-base', '--is-ancestor', resolved, newer);
      return true;
    } catch {
      return false; // not an ancestor, or a ref this clone does not have
    }
  };
  const { from, how } = listFrom({
    base: resolved,
    flag,
    isAncestor: isAncestorOf(rev),
    onMainLine: ['main', 'origin/main'].some(isAncestorOf),
    mergeBase,
  });

  const lines = (text) => text.split('\n').filter(Boolean);
  const againstWorkingTree = rev === 'HEAD';
  let changed;
  let untracked;
  try {
    changed = lines(
      againstWorkingTree
        ? git('diff', '--name-only', '--no-renames', from)
        : git('diff', '--name-only', '--no-renames', from, rev),
    );
    untracked = againstWorkingTree ? lines(git('ls-files', '--others', '--exclude-standard')) : [];
  } catch (error) {
    // A corrupt index, a file git cannot stat, a worktree half-removed. It is
    // still "the change set is unknown", and the reader needs the sentence
    // rather than a V8 stack trace out of `main`.
    return {
      paths: null,
      base: resolved,
      mergeBase,
      reason:
        `git could not list the change against ${from.slice(0, 7)}`
        + ` (${oneLine(error.stderr || error.message)}), so every gate applies.`,
    };
  }

  const paths = [...new Set([...changed, ...untracked])];
  if (paths.includes('package.json')) {
    // The manifest itself stays on the list: the specs that read it ask for it.
    const read = (spec) => {
      try {
        return git('show', spec);
      } catch {
        return '{}';
      }
    };
    const onDisk = () => {
      try {
        return readFileSync(`${git('rev-parse', '--show-toplevel').trim()}/package.json`, 'utf8');
      } catch {
        return '{}';
      }
    };
    const now = againstWorkingTree ? onDisk() : read(`${rev}:package.json`);
    paths.push(...packageChanges(read(`${from}:package.json`), now));
  }
  return {
    paths: paths.sort(),
    base: resolved,
    mergeBase,
    from: how,
    reason: null,
  };
}

/** A file of the checkout, as it is on disk; empty if it cannot be read. */
export function rootFile(path) {
  try {
    return readFileSync(`${git('rev-parse', '--show-toplevel').trim()}/${path}`, 'utf8');
  } catch {
    return '';
  }
}

/** The root manifest's npm scripts, as the checkout holds them; none if it cannot be read. */
export function rootScripts() {
  try {
    return JSON.parse(rootFile('package.json')).scripts ?? {};
  } catch {
    return {};
  }
}
