import { join, relative } from 'node:path';
import { backendSrc, findRepoRoot } from '../db/repoRoot.js';

/**
 * Where a spec finds a repository file that lives outside `backend/`.
 *
 * A dozen guards in this suite hold a claim in code against the file that actually
 * states it: the schema in `db/init/01-schema.sql`, a numbered migration, Martin's
 * `config.yaml`, a frontend module whose shape is the claim. They live here because
 * the things they compare have no test runner of their own and the frontend's cannot
 * read outside its root. A rule both sides *apply* is no longer among them: that is
 * imported from `packages/shared` by both, and pinned to the schema by a type
 * (ADR-0065, `src/db/curationLogActions.test.ts`).
 *
 * How the root is found, and why it is found rather than counted, is
 * `db/repoRoot.ts`, which the commands that read `db/catalogue-coverage/` share.
 */

export { backendSrc };

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
