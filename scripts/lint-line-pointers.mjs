#!/usr/bin/env node
/**
 * Refuses a line pointer in living prose — `parser.ts:83`, `warm-tiles.sh:1`,
 * `index.tsx:544-560` — wherever that prose lives: a Markdown page, a code
 * comment, a workflow's `#` line.
 *
 * A line pointer is the one expiring claim a grep separates from a legitimate
 * number (#579): every edit above the cited line breaks it while the sentence
 * it supports stays true, and nothing re-checks a pointer between reviews.
 * `docs/tech/development-guide.md` § What a living document may not say asks
 * for file + symbol instead, and this is that rule made a gate. Counts,
 * tallies and derived arithmetic are the reviewer's: no pattern tells a
 * catalogue total from a schema width or an API ceiling.
 *
 * What is read: every tracked file whose extension is on the list below, so
 * a pointer is refused in a string as readily as in a comment — one is as
 * stale as the other, and none exists in a string today. What is not read is
 * the point-in-time record the guide exempts: an ADR, an audit report, a
 * migration, each describing the code as of a date. The exempt paths are the
 * constant `RECORDS` with one reason each, and this file and its spec, whose
 * fixtures are the shape being refused.
 *
 * Exit 1 with every hit as `path:line: match` — a pointer, yes, and one this
 * output owns for as long as the run it belongs to — or exit 0 with a count.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A file's own name followed by a line, or a range of lines. The lookbehind
 * keeps a match from starting inside a longer token — a URL's `//host/path`
 * after its scheme's colon, a path segment after a slash — so a link to a
 * file with a line in it is not read as a pointer twice over.
 */
export const LINE_POINTER = /(?<![\w./:-])[\w./-]+\.(?:md|tsx?|[cm]?js|sql|sh|py|ya?ml):\d+(?:-\d+)?\b/g;

/** The extensions living prose is written in or beside. Markdown is prose; the rest carry comments. */
export const READ_EXTENSIONS = ['md', 'ts', 'tsx', 'mjs', 'cjs', 'js', 'sql', 'sh', 'py', 'yml', 'yaml'];

/**
 * Point-in-time records: a pointer there is evidence dated to the record, not a
 * standing claim (`docs/tech/development-guide.md` § What a living document may
 * not say, last paragraph). Each entry is a path prefix or an exact path.
 */
export const RECORDS = [
  ['docs/decisions/', 'an ADR is immutable once Accepted and describes the code as of its date'],
  ['docs/security/audit-', 'an audit report holds line pointers as evidence dated to its audit'],
  ['docs/inbox/', 'an unsorted note is not read as current until it is filed'],
  ['docs/tech/planning/', 'a plan is a local working document (gitignored; the ones still tracked are #514’s to move out)'],
  ['db/migrations/', 'a migration is the one-shot change a database went through once'],
  ['scripts/lint-line-pointers.mjs', 'this file — its examples are the shape it refuses'],
  ['scripts/lint-line-pointers.test.mjs', 'the spec — its fixtures are the shape it refuses'],
];

const isRecord = (path) => RECORDS.some(([prefix]) => path === prefix || path.startsWith(prefix));

const hasReadExtension = (path) => {
  const dot = path.lastIndexOf('.');
  return dot > 0 && READ_EXTENSIONS.includes(path.slice(dot + 1));
};

/** Every line pointer in `text`, with the 1-based line it sits on. */
export function findLinePointers(text) {
  const hits = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(LINE_POINTER)) hits.push({ line: index + 1, match: match[0] });
  });
  return hits;
}

/** The tracked files this gate reads, relative to `root`. */
export function livingFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  return listed.split('\0').filter((path) => path && hasReadExtension(path) && !isRecord(path));
}

/** Runs the gate over `root`; returns the hits, each `{ path, line, match }`. */
export function lintLinePointers(root) {
  const hits = [];
  for (const path of livingFiles(root)) {
    const text = readFileSync(`${root}/${path}`, 'utf8');
    for (const hit of findLinePointers(text)) hits.push({ path, ...hit });
  }
  return hits;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const hits = lintLinePointers(root);
  if (hits.length === 0) {
    console.log(`lint:pointers: no line pointer in ${livingFiles(root).length} living files`);
  } else {
    for (const { path, line, match } of hits) console.error(`${path}:${line}: ${match}`);
    console.error(
      `\nlint:pointers: ${hits.length} line pointer(s) in living prose. Name the file and the symbol `
      + 'or the section instead (docs/tech/development-guide.md § What a living document may not say); '
      + 'a point-in-time record belongs under one of the RECORDS prefixes in scripts/lint-line-pointers.mjs.',
    );
    process.exit(1);
  }
}
