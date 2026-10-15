#!/usr/bin/env node
/**
 * A tracked file the change leaves empty, or with less than a quarter of its
 * bytes, fails the gate unless a commit on the branch says why (#537).
 *
 *   node scripts/check-shrunk-files.mjs    against the base `scripts/gates.mjs` settles on
 *
 * No other gate reads what a document holds, so a write that truncated a file
 * passes every one of them: a `git diff --stat` of "183 deletions" reads like
 * a document deliberately removed. A deleted file is not this check's: `git rm`
 * is a different diff, and only a file that still exists is compared. A file
 * that was already empty at the base (a package's `__init__.py`) is never one.
 *
 * A shrink that is meant — a module moved out, a generated fixture cut down —
 * is named in a commit body on the branch, one line per file, with its reason:
 *
 *   Shrinks: backend/src/routes/adminRoutes.ts -- the routes are declarations now
 */
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

import { changedPaths } from './gates.mjs';
import { repoFile } from './repo-root.mjs';

/** Below this share of its bytes at the base, a file has shrunk. */
export const SHRINK_SHARE = 0.25;
/** A file this small at the base is too small for a share to mean anything; emptying it still counts. */
export const SHRINK_FLOOR = 1000;

const TRAILER = /^Shrinks:[ \t]*(\S+)[ \t]+--[ \t]+\S.*$/gm;

/** The paths the branch's commit bodies name as meant to shrink, each with a reason. */
export function namedShrinks(messages) {
  return new Set([...String(messages).matchAll(TRAILER)].map(([, path]) => path));
}

/**
 * The files that emptied or shrank, as `{ path, before, after, emptied }`:
 * `sizes` holds each modified path's bytes at the base and now, and a path the
 * branch names in a `Shrinks:` line is let through.
 */
export function shrunkFiles(sizes, named = new Set()) {
  return sizes
    .filter(({ path, before, after }) => !named.has(path) && before > 0 && (
      after === 0 || (before >= SHRINK_FLOOR && after < before * SHRINK_SHARE)
    ))
    .map((file) => ({ ...file, emptied: file.after === 0 }));
}

function main() {
  const { mergeBase, reason } = changedPaths({ base: undefined, rev: 'HEAD' });
  if (!mergeBase) {
    console.log(`No base to compare file sizes with: ${reason}`);
    return 0;
  }
  const git = (...args) => execFileSync('git', args, { cwd: repoFile(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Against the working tree, so an edit not yet committed is read as it stands.
  const modified = git('diff', '--name-only', '--diff-filter=M', '-z', mergeBase).split('\0').filter(Boolean);
  const sizes = modified.map((path) => ({
    path,
    before: Number(git('cat-file', '-s', `${mergeBase}:${path}`).trim()),
    after: lstatSync(join(repoFile(), path)).size,
  }));
  const named = namedShrinks(git('log', '--format=%B', `${mergeBase}..HEAD`));
  const shrunk = shrunkFiles(sizes, named);
  if (shrunk.length === 0) {
    console.log(`No tracked file emptied or shrank below ${SHRINK_SHARE * 100}% against ${mergeBase.slice(0, 9)} (${modified.length} modified).`);
    return 0;
  }
  for (const { path, before, after, emptied } of shrunk) {
    console.error(emptied
      ? `${path}: emptied (${before} bytes at the base, 0 now)`
      : `${path}: shrank from ${before} to ${after} bytes`);
  }
  console.error(
    '\nA write that truncated a file passes every other gate. If the shrink is meant, say so in a commit body on the'
    + ' branch, one line per file:\n\n  Shrinks: <path> -- <why>\n',
  );
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith('check-shrunk-files.mjs')) process.exit(main());
