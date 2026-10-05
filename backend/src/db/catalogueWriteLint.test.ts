/**
 * The lint rules that hold the catalogue's reads and writes to their one
 * spelling (#791, ADR-0069): a reader predicate is composed from
 * `db/readerPredicates.ts` or `db/membership.ts`, and `experiences`,
 * `experience_locations`, a venue's works and `regions` are written only by
 * their writer modules.
 *
 * Asserted against the repo's own `eslint.config.mjs`, as
 * `api/routeRegistryLint.test.ts` asserts its rule, and in both directions: the code
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
const WRITE = /^experiences is written by its writer modules only/;
const POINT_WRITE = /^experience_locations and experience_location_placements are written by their writer modules only/;
const WORK_WRITE = /^treasures, experience_treasures and experience_treasure_placements are written by their writer modules only/;
const REGION_WRITE = /^regions is written by its writer modules only/;

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
    // Missing detection marks a membership since ADR-0084; the place's flag is
    // derived from it, so a write of its own there would be a second writer.
    ['missing detection', 'export const q = `UPDATE experiences SET missing_since = NOW()`;\n', 'src/services/sync/missingDetection.ts'],
  ])('refuses a write to experiences outside its writers: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WRITE.test(m))).toBe(true);
  });

  it.each([
    ['another table whose name starts the same', 'export const q = `UPDATE experience_locations SET name = $2`;\n', 'src/controllers/lint-fixture.ts'],
    ['a read', 'export const q = `SELECT id FROM experiences WHERE id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['the curator writer', 'export const q = `UPDATE experiences SET name = $2 WHERE id = $1`;\n', 'src/db/experienceWriter.ts'],
    ['the run\'s upsert', 'export const q = `INSERT INTO experiences (name) VALUES ($1)`;\n', 'src/services/sync/experienceUpsert.ts'],
    ['the picture repair', 'export const q = `UPDATE experiences SET image_url = NULL`;\n', 'src/services/sync/pictureRepair.ts'],
  ])('lets a write stand where it belongs, or a statement that is no write: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WRITE.test(m))).toBe(false);
  });

  it.each([
    ['an update in a controller', 'export const q = `UPDATE experience_locations SET name = $2 WHERE id = $1`;\n', 'src/controllers/experience/lint-fixture.ts'],
    ['a lower-case insert in a service', 'export const q = "insert into experience_locations (name) values ($1)";\n', 'src/services/lint-fixture.ts'],
    ['a placement taken away in a controller', 'export const q = `DELETE FROM experience_location_placements WHERE location_id = $1`;\n', 'src/controllers/experience/lint-fixture.ts'],
  ])('refuses a write to experience_locations outside its writers: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => POINT_WRITE.test(m))).toBe(true);
  });

  it.each([
    ['another table whose name starts the same', 'export const q = `UPDATE experience_location_regions SET region_id = $2`;\n', 'src/controllers/lint-fixture.ts'],
    ['the curator writer', 'export const q = `UPDATE experience_locations SET name = $2 WHERE id = $1`;\n', 'src/controllers/experience/experienceLocationWriter.ts'],
    ['the run\'s location writer', 'export const q = `INSERT INTO experience_locations (name) VALUES ($1)`;\n', 'src/services/sync/locationWriter.ts'],
    ['the run\'s placements', 'export const q = `DELETE FROM experience_location_placements WHERE location_id = $1`;\n', 'src/services/sync/locationWriter.ts'],
    ['the seed', 'export const q = `INSERT INTO experience_locations (name) VALUES ($1)`;\n', 'src/db/seed/lint-fixture.ts'],
  ])('lets a point write stand where it belongs, or a statement that is no write: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => POINT_WRITE.test(m))).toBe(false);
  });

  it.each([
    ['an update of a work in a controller', 'export const q = `UPDATE treasures SET name = $2 WHERE id = $1`;\n', 'src/controllers/experience/lint-fixture.ts'],
    ['an update of a link in a controller', 'export const q = `UPDATE experience_treasures et SET refused_at = NOW()`;\n', 'src/controllers/experience/lint-fixture.ts'],
    ['a lower-case insert of a link in a service', 'export const q = "insert into experience_treasures (experience_id) values ($1)";\n', 'src/services/lint-fixture.ts'],
    ['a placement taken away in a controller', 'export const q = `DELETE FROM experience_treasure_placements WHERE link_id = $1`;\n', 'src/controllers/experience/lint-fixture.ts'],
    ['a placement recorded in a service', 'export const q = `INSERT INTO experience_treasure_placements (link_id) VALUES ($1)`;\n', 'src/services/lint-fixture.ts'],
  ])('refuses a write to a work or its link outside their writers: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WORK_WRITE.test(m))).toBe(true);
  });

  it.each([
    ['another table whose name ends the same', 'export const q = `INSERT INTO user_viewed_treasures (user_id) VALUES ($1)`;\n', 'src/controllers/lint-fixture.ts'],
    ['a read', 'export const q = `SELECT id FROM treasures WHERE id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['the curator writer', 'export const q = `UPDATE treasures SET name = $2 WHERE id = $1`;\n', 'src/controllers/experience/workWriter.ts'],
    ['the run\'s treasure writer', 'export const q = `INSERT INTO treasures (name) VALUES ($1)`;\n', 'src/services/sync/museum/treasureWriter.ts'],
    ['the run\'s link reconciliation', 'export const q = `UPDATE experience_treasures et SET missing_since = NOW()`;\n', 'src/services/sync/museum/linkWithdrawal.ts'],
    ['the run\'s placements', 'export const q = `DELETE FROM experience_treasure_placements WHERE link_id = $1`;\n', 'src/services/sync/museum/linkWithdrawal.ts'],
    ['a read of the placements', 'export const q = `SELECT link_id FROM experience_treasure_placements WHERE link_id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['the seed', 'export const q = `INSERT INTO treasures (name) VALUES ($1)`;\n', 'src/db/seed/lint-fixture.ts'],
  ])('lets a work write stand where it belongs, or a statement that is no write: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => WORK_WRITE.test(m))).toBe(false);
  });

  it.each([
    ['an update in a controller', 'export const q = `UPDATE regions SET name = $2 WHERE id = $1`;\n', 'src/controllers/worldView/lint-fixture.ts'],
    ['a delete in an import controller', "export const q = 'DELETE FROM regions WHERE id = $1';\n", 'src/controllers/admin/lint-fixture.ts'],
    ['a lower-case insert in a service', 'export const q = "insert into regions (name) values ($1)";\n', 'src/services/worldViewImport/lint-fixture.ts'],
    ['an aliased update', 'export const q = `UPDATE regions r SET geom = NULL FROM x WHERE r.id = x.id`;\n', 'src/controllers/lint-fixture.ts'],
  ])('refuses a write to regions outside its writers: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => REGION_WRITE.test(m))).toBe(true);
  });

  it.each([
    ['another table whose name starts the same', 'export const q = `DELETE FROM region_members WHERE region_id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['a read', 'export const q = `SELECT id FROM regions WHERE parent_region_id = $1`;\n', 'src/controllers/lint-fixture.ts'],
    ['the writer module', 'export const q = `UPDATE regions SET name = $1 WHERE id = $2`;\n', 'src/db/regionWriter.ts'],
    ['a geometry computation', 'export const q = `UPDATE regions SET geom = $2 WHERE id = $1`;\n', 'src/controllers/worldView/geometryComputeSingle.ts'],
    ['the hull generator', 'export const q = `UPDATE regions SET hull_geom = $2 WHERE id = $1`;\n', 'src/services/hull/generator.ts'],
    ['the seed', 'export const q = `INSERT INTO regions (name) VALUES ($1)`;\n', 'src/db/seed/lint-fixture.ts'],
  ])('lets a region write stand where it belongs, or a statement that is no write: %s', async (_, code, file) => {
    expect((await reported(code, file)).some(m => REGION_WRITE.test(m))).toBe(false);
  });
});
