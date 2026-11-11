/**
 * The code a step of the place pass is made by, as one hash (#2424): every
 * module its entry modules import, transitively, read as source.
 *
 * A step kept between dry runs (`keptGather.ts`) is read again only by the
 * same code. The graph is the static one — an import a module names, whether
 * or not the step calls into it — so it errs towards making the step again:
 * a module the step never calls but imports still changes the hash. Type-only
 * imports are left out, since they carry no code. A module of `@tyr/shared`
 * (ADR-0065) is followed too: a kind's type vocabulary is declared there. A
 * module that cannot be found refuses the hash rather than leaving it out, so
 * the step is made again rather than read under a key that missed code.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `… from './x.js'`: an import or a re-export, of a relative module or one of `@tyr/shared`. */
const FROM = /\bfrom\s*['"](\.{1,2}\/[^'"]+|@tyr\/shared\/[^'"]+)['"]/g;
/** `import './x.js'` and `import('./x.js')`, the same. */
const BARE = /\bimport[\s(]['"](\.{1,2}\/[^'"]+|@tyr\/shared\/[^'"]+)['"]/g;
const SHARED = '@tyr/shared/';
/** A statement that imports or re-exports types alone, which carry no code. */
const TYPE_ONLY = /^[ \t]*(?:import|export)[ \t]+type[ \t{]/m;

/** Where `marker` next appears from `from`, plus `past`; the end of the source where it does not. */
function closeAt(source: string, marker: string, from: number, past: number): number {
  const found = source.indexOf(marker, from);
  return found === -1 ? source.length : found + past;
}

/** Where a string quoted at `at` ends: at its closing quote, or at its line for a quote other than a backtick. */
function stringEnd(source: string, at: number, quote: string): number {
  let end = at + 1;
  while (end < source.length && source[end] !== quote && (quote === '`' || source[end] !== '\n')) end += source[end] === '\\' ? 2 : 1;
  return source[end] === quote ? end + 1 : end;
}

/** The comment or quoted string that opens at `at`, by where it ends; null where neither opens there. */
function tokenAt(source: string, at: number): { end: number; comment: boolean } | null {
  const opener = source.slice(at, at + 2);
  if (opener === '/*') return { end: closeAt(source, '*/', at + 2, 2), comment: true };
  if (opener === '//') return { end: closeAt(source, '\n', at, 0), comment: true };
  const quote = source[at];
  return quote === "'" || quote === '"' || quote === '`' ? { end: stringEnd(source, at, quote), comment: false } : null;
}

/**
 * The source without its comments, so an import a comment shows as an example
 * is not read as one. Quotes are followed only to tell a `//` inside a string
 * from a comment; a quoted string ends at its line, so a quote inside a regular
 * expression literal leaves the next line's reading untouched.
 */
function withoutComments(source: string): string {
  let kept = '';
  let at = 0;
  while (at < source.length) {
    const token = tokenAt(source, at);
    if (!token) {
      kept += source[at];
      at += 1;
    } else {
      if (!token.comment) kept += source.slice(at, token.end);
      at = token.end;
    }
  }
  return kept;
}

/** The modules a source imports at run time, as specifiers, relative or of `@tyr/shared`, each once; an import in a comment is none. */
export function importsOf(text: string): string[] {
  const source = withoutComments(text);
  const found = new Set<string>();
  for (const match of source.matchAll(FROM)) {
    // The statement the `from` closes: everything since the one before it.
    const statement = source.slice(source.lastIndexOf(';', match.index) + 1, match.index);
    if (!TYPE_ONLY.test(statement)) found.add(match[1]);
  }
  for (const match of source.matchAll(BARE)) found.add(match[1]);
  return [...found];
}

/** `src/`, which every path in the hash is read from, so the hash is the same in every checkout of the same code. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The file a module names: written in TypeScript and imported by its `.js`
 * name, or the `.js` a compiled backend holds. `@tyr/shared/<module>` is the
 * package's `src/<module>.ts`, beside the backend in the checkout and in the
 * container alike (`packages/shared`).
 */
function fileOf(from: string, specifier: string): string {
  const named = specifier.startsWith(SHARED)
    ? resolve(SOURCE_ROOT, '../../packages/shared/src', `${specifier.slice(SHARED.length)}.ts`)
    : resolve(dirname(from), specifier);
  for (const candidate of [named.replace(/\.js$/, '.ts'), named]) if (existsSync(candidate)) return candidate;
  throw new Error(`${relative(SOURCE_ROOT, from)} imports ${specifier}, which is not where the code key looks for it`);
}

/**
 * The hash of every module the entries reach, each by its path and its
 * source, in path order; and those paths, from `src/`.
 */
export async function codeHash(entries: readonly URL[]): Promise<{ hash: string; files: string[] }> {
  const files = new Map<string, string>();
  const waiting = entries.map((entry) => fileOf(fileURLToPath(entry), fileURLToPath(entry)));
  while (waiting.length > 0) {
    const file = waiting.pop() as string;
    if (files.has(file)) continue;
    const source = await readFile(file, 'utf8');
    files.set(file, source);
    for (const specifier of importsOf(source)) {
      const next = fileOf(file, specifier);
      if (!files.has(next)) waiting.push(next);
    }
  }
  const paths = [...files.keys()].sort();
  const hash = createHash('sha256');
  for (const file of paths) hash.update(`${relative(SOURCE_ROOT, file)}\0${files.get(file)}\0`);
  return { hash: hash.digest('hex'), files: paths.map((file) => relative(SOURCE_ROOT, file)) };
}
