/**
 * Local fixture source for sync development.
 *
 * Wikidata answers in tens of seconds and rate-limits; UNESCO's list is a single
 * large fetch. Neither makes a workable inner loop, and neither can be asked for
 * "the same list, minus one object" so a delisting can be exercised. Pointing
 * SYNC_SOURCE_FIXTURE at a directory of JSON files does both.
 *
 * Refused in production: this substitutes the source of truth, which is exactly
 * what must never be possible against real data.
 */

import { readFile } from 'node:fs/promises';

export const FIXTURE_ENV_VAR = 'SYNC_SOURCE_FIXTURE';

/**
 * The configured fixture directory, or null when fixtures are not in play.
 */
export function fixtureSourcePath(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  return process.env[FIXTURE_ENV_VAR] || null;
}

/**
 * Read a fixture file by bare name from the configured directory.
 *
 * The name must be a bare file name. Anything carrying a separator or a parent
 * reference is refused rather than resolved — the directory is the boundary,
 * and resolving first would mean deciding afterwards whether we had left it.
 */
export async function readFixtureRecords<T>(fileName: string): Promise<T[] | null> {
  const directory = fixtureSourcePath();
  if (directory === null) return null;

  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Invalid fixture file name: ${fileName}`);
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- directory comes from an operator-set env var that is refused in production, and fileName is validated above as a bare name
  const contents = await readFile(`${directory}/${fileName}`, 'utf8');
  const parsed: unknown = JSON.parse(contents);

  // Checked rather than cast: the likely mistake is saving the source's raw
  // response, which for UNESCO is `{ "results": [...] }`. Cast blindly, that
  // yields `length: undefined` — zero items processed, no errors, and a run
  // recorded as a clean success with total_fetched NULL, which then outlives
  // the mistake in the history table.
  if (!Array.isArray(parsed)) {
    const shape = parsed && typeof parsed === 'object'
      ? `an object with keys: ${Object.keys(parsed as object).slice(0, 5).join(', ')}`
      : typeof parsed;
    throw new Error(
      `Fixture ${fileName} must be a JSON array of records, got ${shape}. `
      + 'If this is a saved API response, unwrap the records array first.'
    );
  }

  return parsed as T[];
}
