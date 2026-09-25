/**
 * The two lint rules that hold the catalogue's reads and writes to their one
 * spelling (#791, ADR-0069): a reader predicate is composed from
 * `db/readerPredicates.ts` or `db/membership.ts`, and `experiences` is written
 * only by its writer modules.
 *
 * Asserted against the repo's own `eslint.config.mjs`, as
 * `cacheControlLint.test.ts` asserts its rule, and in both directions: the code
 * base passes both rules today, so a selector that reports nothing and one that
 * works look the same to CI. The rows worth having are the file each snippet is
 * linted *as* — the same text is a copy in a controller and the definition in
 * the module that owns it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** The rule messages one snippet draws, linted as the file named. */
async function reported(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
}

const PREDICATE = /reader predicate is composed/;
const WRITE = /experiences is written by its writer modules only/;

describe('the catalogue lint rules', () => {
  // The first lint in a worker loads the whole config and its plugins; pay it
  // once with a timeout of its own, so a failure below means the rule.
  beforeAll(async () => {
    await reported('export const x = 1;\n', 'src/controllers/lint-fixture.ts');
  }, 60000);

  it.each([
    ['a template in a controller', "export const q = (a: string) => `SELECT 1 FROM t WHERE ${a}.curation_state <> 'pending'`;\n", 'src/controllers/lint-fixture.ts'],
    ['a plain string in a sync service', "export const q = \"SELECT 1 FROM e WHERE existence <> 'lost'\";\n", 'src/services/sync/lint-fixture.ts'],
    ['a SQL comment inside a statement', "export const q = `SELECT 1 -- existence <> 'lost'\n  FROM e`;\n", 'src/services/lint-fixture.ts'],
  ])('refuses a spelled-out reader predicate: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => PREDICATE.test(m))).toBe(true);
  });

  it.each([
    ['a TypeScript comment naming it', "// curation_state <> 'pending' is asked by publishedContentSql\nexport const x = 1;\n", 'src/controllers/lint-fixture.ts'],
    ['the module that defines it', "export const q = (a: string) => `${a}.curation_state <> 'pending'`;\n", 'src/db/readerPredicates.ts'],
  ])('lets a reader predicate stand: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => PREDICATE.test(m))).toBe(false);
  });

  it.each([
    ['an update in a controller', 'export const q = `UPDATE experiences SET name = $2 WHERE id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['a lower-case insert in a sync service', 'export const q = "insert into experiences (name) values ($1)";\n', 'src/services/sync/lint-fixture.ts'],
  ])('refuses a write to experiences outside its writers: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WRITE.test(m))).toBe(true);
  });

  it.each([
    ['another table whose name starts the same', 'export const q = `UPDATE experience_locations SET name = $2`;\n', 'src/controllers/lint-fixture.ts'],
    ['a read', 'export const q = `SELECT id FROM experiences WHERE id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['the curator writer', 'export const q = `UPDATE experiences SET name = $2 WHERE id = $1`;\n', 'src/db/experienceWriter.ts'],
    ['the run\'s upsert', 'export const q = `INSERT INTO experiences (name) VALUES ($1)`;\n', 'src/services/sync/experienceUpsert.ts'],
    ['missing detection', 'export const q = `UPDATE experiences SET missing_since = NOW()`;\n', 'src/services/sync/missingDetection.ts'],
    ['the picture repair', 'export const q = `UPDATE experiences SET image_url = NULL`;\n', 'src/services/sync/pictureRepair.ts'],
  ])('lets a write stand where it belongs, or a statement that is no write: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WRITE.test(m))).toBe(false);
  });
});
