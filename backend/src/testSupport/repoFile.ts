import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where a spec finds a repository file that lives outside `backend/`.
 *
 * A dozen guards in this suite hold a claim in code against the file that actually
 * states it: the schema in `db/init/01-schema.sql`, a numbered migration, Martin's
 * `config.yaml`, a frontend module that spells the same rule for the browser. They
 * live here because the things they compare have no test runner of their own and the
 * frontend's cannot read outside its root — see the header of
 * `src/db/curationLogActionLabels.test.ts` for that argument.
 *
 * Each of them used to walk up from its own file with its own count of `..`, which
 * works only where `backend/` sits inside a full checkout. The container unit lane
 * mounts `backend/src` at `/app/src`, so those walks landed on `/` and every one of
 * those specs failed on a path that was simply not there — 18 files on `main`, green
 * on the host and in CI, which is how the lane stayed broken unnoticed (#948).
 *
 * So the root is found rather than counted: the nearest ancestor that actually holds
 * `db/init/01-schema.sql`. On a checkout that is the checkout; in the container it is
 * `/`, where `docker-compose.yml` mounts `db`, `frontend/src`, `martin` and `scripts`
 * read-only beside `/app`. When no ancestor holds it, the throw names the mounts,
 * because "ENOENT /db/init/01-schema.sql" does not.
 */

/** This package's `src`, which is present wherever the suite runs — mounted, in the container. */
export const backendSrc = dirname(dirname(fileURLToPath(import.meta.url)));

/** The file every checkout has at its root and no package has inside it. */
const MARKER = join('db', 'init', '01-schema.sql');

function findRepoRoot(): string {
  let dir = backendSrc;
  for (;;) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir walks up from this module's own path
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No ancestor of ${backendSrc} holds ${MARKER}, so the repository root cannot be found. `
        + 'In the container unit lane this means the backend service is missing the read-only '
        + 'repository mounts (db, frontend/src, martin, scripts) that docker-compose.yml declares '
        + 'beside /app — recreate the stack so they are applied.',
      );
    }
    dir = parent;
  }
}

/** The checkout the suite is running against. */
export const repoRoot = findRepoRoot();

/** A repository file, by the path a person would write in a commit message. */
export function repoFile(...segments: string[]): string {
  return join(repoRoot, ...segments);
}

/**
 * The other direction: an absolute path said the way a commit message would say it.
 *
 * `path.relative` rather than slicing off the root's length, because in the container
 * the root is `/` and an offset derived from it eats the first character of the name.
 */
export function repoRelative(path: string): string {
  return relative(repoRoot, path);
}
