import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where a tooling spec finds a repository file, on a checkout and off one.
 *
 * The specs beside this file run in the backend's vitest lane, which also runs
 * inside the backend container. There `docker-compose.yml` mounts `scripts`,
 * `db`, `frontend/src` and `martin` read-only beside `/app` rather than under a
 * checkout — along with the two files the tooling specs hold their claims
 * against, `docs/tech/gates.md` and `.github/workflows/ci.yml`, each mounted on
 * its own — so a spec that counted `..` from its own path would land on `/` and
 * open files that are simply not there. That is the shape which left 18 backend
 * specs failing in the container lane while the host and CI stayed green
 * (#948), and the reason the root is found rather than counted: the nearest
 * ancestor that actually holds `db/init/01-schema.sql`. On a checkout that is
 * the checkout; in the container it is `/`.
 *
 * `backend/src/testSupport/repoFile.ts` is the same rule for the backend suite.
 * This module is its twin for the scripts, which sit outside that package and
 * cannot import from it.
 */

/** The file every checkout has at its root and no package has inside it. */
const MARKER = join('db', 'init', '01-schema.sql');

const here = dirname(fileURLToPath(import.meta.url));

function findRepoRoot() {
  let dir = here;
  for (;;) {
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No ancestor of ${here} holds ${MARKER}, so the repository root cannot be found. `
        + 'In the container unit lane this means the backend service is missing the read-only '
        + 'repository mounts (db, frontend/src, martin, scripts) that docker-compose.yml '
        + 'declares beside /app — recreate the stack so they are applied.',
      );
    }
    dir = parent;
  }
}

/** The checkout, or the container root, these specs are running against. */
const repoRoot = findRepoRoot();

/** A repository file, by the path a person would write in a commit message. */
export function repoFile(...segments) {
  return join(repoRoot, ...segments);
}

/**
 * The backend's `src`, wherever this suite is running.
 *
 * Two roots, for the one reason the module exists: on a checkout the package
 * sits at `backend/src` under the root, and in the container it is mounted at
 * `/app/src` while the root is `/`, so `backend/src` is not a path there. It
 * lives here rather than in the spec that walks it because the answer is the
 * same question the root walk above asks — and because a spec holding the
 * literal `'app', 'src'` would be a spec naming a path that belongs to no input
 * class, which is exactly what the scan over those literals refuses (#952).
 */
export const backendSrc = existsSync(repoFile('backend', 'src'))
  ? repoFile('backend', 'src')
  : repoFile('app', 'src');
