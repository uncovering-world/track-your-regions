/**
 * The lint rule that holds a record's shape to its one spelling (ADR-0218
 * decision 11): whether a record is shown by its parts, and whether it has a
 * pin, are composed from `shownByPartsSql` and `hasPinSql`
 * (`db/readerPredicates.ts`), never read off a missing coordinate or a
 * spelled shape.
 *
 * Asserted against the repo's own `eslint.config.mjs`, in both directions, as
 * `catalogueWriteLint.test.ts` asserts the reader predicates: the code base
 * passes the rule, so a selector that reports nothing and one that works look
 * the same to CI.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** Whether one snippet, linted as the file named, draws the rule. */
async function refused(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.some(message => message.ruleId === 'no-restricted-syntax'
    && /^A record's shape is composed, not spelled/.test(message.message));
}

describe('the record-shape lint rule', () => {
  // The first lint in a worker loads the whole config and its plugins; pay it
  // once with a timeout of its own, so a failure below means the rule.
  beforeAll(async () => {
    await refused('export const x = 1;\n', 'src/controllers/lint-fixture.ts');
  }, 60000);

  it.each([
    ['a missing coordinate in a controller', 'export const q = `SELECT 1 FROM experiences e WHERE e.location IS NULL`;\n', 'src/controllers/lint-fixture.ts'],
    ['a coordinate being there, in a sync service', 'export const q = "SELECT 1 FROM experiences WHERE location IS NOT NULL";\n', 'src/services/sync/lint-fixture.ts'],
    ['a shape against a word', "export const q = (e: string) => `SELECT 1 FROM experiences ${e} WHERE ${e}.shape = 'none'`;\n", 'src/controllers/lint-fixture.ts'],
    ['a shape in a list of words', "export const q = `SELECT 1 FROM experiences e WHERE e.shape IN ('area', 'line')`;\n", 'src/db/lint-fixture.ts'],
    ['a bare shape against a word', "export const q = `SELECT 1 FROM experiences WHERE shape = 'none'`;\n", 'src/controllers/lint-fixture.ts'],
    ['a bare shape in a list of words', "export const q = \"SELECT 1 FROM experiences WHERE merged_into_id IS NULL AND shape NOT IN ('none')\";\n", 'src/services/lint-fixture.ts'],
    ['a bare shape told from a word, after a line break', "export const q = `SELECT 1 FROM experiences WHERE\n  shape <> 'point'`;\n", 'src/db/lint-fixture.ts'],
    ['a shape told from a word', "export const q = `SELECT 1 FROM experiences e WHERE e.shape IS DISTINCT FROM 'none'`;\n", 'src/db/experienceWriter.ts'],
  ])('refuses %s', async (_what, code, filePath) => {
    expect(await refused(code, filePath)).toBe(true);
  });

  // The one write that stands is `shape` as the first assignment after SET.
  // A later assignment reads as a test, in a writer module of `experiences`
  // too: those are exempt from the write rule, not from this one, which only
  // `readerPredicates.ts` and `membership.ts` are. The way out for a writer
  // is to name `shape` first in its SET list.
  it.each([
    ['an update that writes the shape after another column', "export const q = `UPDATE experiences SET location = NULL, shape = 'none' WHERE id = $1`;\n", 'src/db/experienceWriter.ts'],
    ['an upsert that writes the shape after another column', "export const q = `INSERT INTO t (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET name = $2, shape = 'point'`;\n", 'src/services/sync/experienceUpsert.ts'],
  ])('refuses %s, which a selector cannot tell from a test', async (_what, code, filePath) => {
    expect(await refused(code, filePath)).toBe(true);
  });

  it('lets the same update stand with the shape named first', async () => {
    const code = "export const q = `UPDATE experiences SET shape = 'none', location = NULL WHERE id = $1`;\n";
    expect(await refused(code, 'src/db/experienceWriter.ts')).toBe(false);
  });

  it.each([
    ['the module that spells the predicates', "export const q = (e: string) => `${e}.shape = 'none' OR ${e}.location IS NOT NULL`;\n", 'src/db/readerPredicates.ts'],
    ['a source\'s view of the coordinate', 'export const q = `SELECT 1 FROM source_records r WHERE r.reported_location IS NULL`;\n', 'src/controllers/lint-fixture.ts'],
    ['a shape compared with the default asked for it', 'export const q = `SELECT 1 FROM experiences e WHERE e.shape IS DISTINCT FROM default_shape_of(e.id)`;\n', 'src/controllers/lint-fixture.ts'],
    ['a shape written', "export const q = `UPDATE t SET shape = 'none' WHERE id = $1`;\n", 'src/controllers/lint-fixture.ts'],
    ['a column whose name ends in shape', "export const q = `SELECT 1 FROM t WHERE t.whole_shape = 'dispersed' OR geoshape = 'x'`;\n", 'src/controllers/lint-fixture.ts'],
    ['a function named for the shape', 'export const q = `SELECT default_shape_of(e.id) FROM experiences e`;\n', 'src/controllers/lint-fixture.ts'],
    ['a shape read, not tested', 'export const q = `SELECT e.shape FROM experiences e`;\n', 'src/controllers/lint-fixture.ts'],
    ['a spec, which sets a row up', "export const q = `UPDATE t SET x = 1 WHERE location IS NULL`;\n", 'src/db/lint-fixture.db.test.ts'],
  ])('lets %s stand', async (_what, code, filePath) => {
    expect(await refused(code, filePath)).toBe(false);
  });
});
