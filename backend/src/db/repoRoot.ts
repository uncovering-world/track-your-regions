import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the checkout is, for code that reads a repository file outside `backend/`:
 * the specs that hold a claim against the file that states it
 * (`testSupport/repoFile.ts`), and the commands that read `db/catalogue-coverage/`.
 *
 * The root is found rather than counted: a walk up with its own count of `..`
 * works only where `backend/` sits inside a full checkout. The container mounts
 * `backend/src` at `/app/src`, so such a walk lands on `/` and fails on a path
 * that is simply not there (#948). So the root is the nearest ancestor that
 * actually holds `db/init/01-schema.sql`. On a checkout that is the checkout; in
 * the container it is `/`, where `docker-compose.yml` mounts `db`, `frontend/src`,
 * `martin` and `scripts` read-only beside `/app`. When no ancestor holds it, the
 * throw names the mounts, because "ENOENT /db/init/01-schema.sql" does not.
 */

/** This package's `src`, which is present wherever the backend runs — mounted, in the container. */
export const backendSrc = dirname(dirname(fileURLToPath(import.meta.url)));

/** The file every checkout has at its root and no package has inside it. */
const MARKER = join('db', 'init', '01-schema.sql');

export function findRepoRoot(): string {
  let dir = backendSrc;
  for (;;) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir walks up from this module's own path
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No ancestor of ${backendSrc} holds ${MARKER}, so the repository root cannot be found. `
        + 'In the container this means the backend service is missing the read-only '
        + 'repository mounts (db, frontend/src, martin, scripts) that docker-compose.yml declares '
        + 'beside /app — recreate the stack so they are applied.',
      );
    }
    dir = parent;
  }
}
