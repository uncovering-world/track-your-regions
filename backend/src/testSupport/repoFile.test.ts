import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendSrc, repoFile, repoRelative, repoRoot } from './repoFile.js';

/**
 * One way to reach a repository file, so the next spec does not re-discover #948.
 *
 * The guards that pin a claim against the file stating it used to walk up from
 * their own module with a hand-counted `..`, which is right only where `backend/`
 * sits inside a full checkout. The container unit lane mounts this package's `src`
 * alone at `/app/src`, so those walks left the checkout and 18 test files failed on
 * paths that were not there — invisibly, because the host lane and CI check out
 * everything.
 *
 * The last test below is what keeps the lesson: a spec may reach anywhere inside
 * its own package by relative path, and must ask `repoFile` for anything beyond it.
 */

/** This package's root — `backend/`, which a spec may address freely. */
const packageRoot = dirname(backendSrc);

/**
 * Every relative path a module builds, in both shapes the suite used before #948.
 *
 * `'../../../db/init/01-schema.sql'` is one literal, as `new URL()` takes it.
 * `join(__dirname, '..', '..', '..')` spells the same walk as segments, and each
 * `'..'` on its own resolves back inside the package — only the whole run leaves
 * it, so the run is what is resolved. Matching one shape and not the other would
 * let the deleted form back in under the guard's nose.
 */
function relativePathsIn(text: string): string[] {
  const single = [...text.matchAll(/'(\.\.\/[^']*)'/g)].map(m => m[1]);
  const segmented = [...text.matchAll(/(?:'[^']*'\s*,\s*)*'\.\.'(?:\s*,\s*'[^']*')*/g)]
    .map(m => [...m[0].matchAll(/'([^']*)'/g)].map(literal => literal[1]).join('/'));
  return single.concat(segmented);
}

describe('where a spec finds a repository file', () => {
  it('finds the checkout by what it holds, not by counting directories', () => {
    expect(existsSync(join(repoRoot, 'db', 'init', '01-schema.sql'))).toBe(true);
    expect(existsSync(repoFile('martin', 'config.yaml'))).toBe(true);
    expect(existsSync(repoFile('frontend', 'src', 'utils', 'mapUtils.ts'))).toBe(true);
  });

  it('places this package inside it', () => {
    expect(existsSync(join(backendSrc, 'index.ts'))).toBe(true);
    expect(relative(repoRoot, backendSrc).startsWith('..')).toBe(false);
  });

  it('says a path back the way a commit message would', () => {
    expect(repoRelative(repoFile('db', 'init', '01-schema.sql')))
      .toBe(join('db', 'init', '01-schema.sql'));
  });

  it('lets no spec walk out of this package by hand', () => {
    // Anything inside `backend/` is this package's own business, reached however
    // the file finds readable — `./rateLimiter.ts`, `../../package.json`. What is
    // refused is a relative path that lands outside it, because that is the one
    // the container lane cannot resolve: there is no `/backend` beside `/app`.
    const offenders: string[] = [];
    for (const name of readdirSync(backendSrc, { recursive: true, encoding: 'utf8' })) {
      if (!name.endsWith('.test.ts')) continue;
      const file = join(backendSrc, name);
      // A guard has to name what it forbids, so the two shapes appear in this
      // file's own prose — the same exclusion `regionAncestorInvalidation` makes
      // for the statement it refuses.
      if (file === fileURLToPath(import.meta.url)) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from this package's own src
      const text = readFileSync(file, 'utf8');
      for (const path of relativePathsIn(text)) {
        if (relative(packageRoot, resolve(dirname(file), path)).startsWith('..')) {
          offenders.push(`${repoRelative(file)}: ${path}`);
        }
      }
    }
    expect(offenders, 'these reach outside backend/ by hand instead of through repoFile()')
      .toEqual([]);
  });
});
