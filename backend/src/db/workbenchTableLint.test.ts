/**
 * No reader or curator route names a workbench table (ADR-0124, #1694).
 *
 * Asserted against the repo's own `eslint.config.mjs`, in both directions:
 * the code base passes the rule today, so a selector that reports nothing and
 * one that works look the same to CI. The same text is a refusal in a
 * curator's controller and ordinary in an admin controller or a source run.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** The workbench rule's messages one snippet draws, linted as the file named. */
async function reported(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((message) => message.ruleId === 'tiers/no-workbench-tables')
    .map((message) => message.message);
}

const REFUSED = /^A reader or curator route names no workbench table/;
const CLAIMS = 'export const q = `SELECT value_item FROM wikidata_claims WHERE subject = $1`;\n';

describe('the workbench-table lint rule', () => {
  // The first lint in a worker loads the whole config and its plugins; pay it
  // once with a timeout of its own, so a failure below means the rule.
  beforeAll(async () => {
    await reported('export const x = 1;\n', 'src/controllers/lint-fixture.ts');
  }, 60000);

  it.each([
    ['a template in a curator controller', CLAIMS, 'src/controllers/experience/lint-fixture.ts'],
    ['a plain string in a reader route', 'export const q = "SELECT views FROM readership_months";\n', 'src/routes/lint-fixture.ts'],
    ['a name with its schema', 'export const q = `SELECT 1 FROM workbench.enwiki_pages`;\n', 'src/controllers/worldView/lint-fixture.ts'],
    ['a workbench table still in public', 'export const q = `SELECT 1 FROM wikidata_query_cache`;\n', 'src/controllers/experience/lint-fixture.ts'],
    ['a name in capitals, which Postgres folds', 'export const q = `SELECT 1 FROM WIKIDATA_CLAIMS`;\n', 'src/routes/lint-fixture.ts'],
    ['a build\'s copy of one', 'export const q = `SELECT 1 FROM wikidata_claims_next`;\n', 'src/controllers/experience/lint-fixture.ts'],
  ])('refuses %s', async (_what, code, filePath) => {
    expect(await reported(code, filePath)).toEqual([expect.stringMatching(REFUSED)]);
  });

  it.each([
    ['an admin controller', CLAIMS, 'src/controllers/admin/lint-fixture.ts'],
    ['an admin route file', CLAIMS, 'src/routes/adminLintFixture.ts'],
    ['a source run', CLAIMS, 'src/services/sync/subset/lint-fixture.ts'],
    ['a serving table an import made', 'export const q = `SELECT source_url FROM region_import_state`;\n', 'src/controllers/worldView/lint-fixture.ts'],
    ['a longer name that holds one', 'export const q = `SELECT readership_months_total FROM experiences`;\n', 'src/controllers/experience/lint-fixture.ts'],
  ])('lets %s pass', async (_what, code, filePath) => {
    expect(await reported(code, filePath)).toEqual([]);
  });
});
