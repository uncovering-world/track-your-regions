/**
 * The lint rules that hold the curation gate's tables to their writer modules
 * (ADR-0077 decision 4, #1148): a conflict answer is written by
 * `conflictDecisions.ts`, a held answer by `heldDecisions.ts`, a run's record
 * of its changes by `changeRecorder.ts`, and a place's membership by
 * `membershipWriter.ts` and the run's own membership writers — spelled out or
 * through `${MEMBERSHIPS}`, which is how the code names the table.
 *
 * Asserted against the repo's own `eslint.config.mjs` in both directions, as
 * `catalogueWriteLint.test.ts` asserts the catalogue's: the code base passes the
 * rules today, so a selector that reports nothing and one that works look the
 * same to CI. Each snippet is linted *as* the file named, since the same text
 * is a stray write in a controller and the definition in its writer.
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

const CONFLICT = /^experience_conflict_decisions is written by its writer module only/;
const HELD = /^experience_held_decisions is written by its writer module only/;
const SYNC_CHANGE = /^experience_sync_changes is written by its writer module only/;
const MEMBERSHIP = /^experience_kind_memberships is written by its writer modules only/;
const EXPERIENCE = /^experiences is written by its writer modules only/;
const REGION = /^regions is written by its writer modules only/;
const COMPONENT_ITEM = /^experience_component_item_proposals is written by its writer modules only/;

const draws = async (code: string, file: string, message: RegExp) =>
  (await reported(code, file)).some(m => message.test(m));

/** Snippets that interpolate the table's name, as the code does. */
const MEMBERSHIPS_IMPORT = "import { MEMBERSHIPS, KINDS } from '../../db/membership.js';\n";

describe('the curation gate lint rules', () => {
  // The first lint in a worker loads the whole config and its plugins; pay it
  // once with a timeout of its own, so a failure below means the rule.
  beforeAll(async () => {
    await reported('export const x = 1;\n', 'src/controllers/lint-fixture.ts');
  }, 60000);

  it.each([
    ['a conflict answer inserted by the decline', CONFLICT,
      'export const q = `INSERT INTO experience_conflict_decisions (experience_id, field) VALUES ($1, $2)`;\n',
      'src/controllers/experience/declineSourceController.ts'],
    ['a conflict answer deleted by the accept', CONFLICT,
      "export const q = 'DELETE FROM experience_conflict_decisions WHERE experience_id = $1';\n",
      'src/controllers/experience/acceptSourceController.ts'],
    ['a held answer inserted by the publish', HELD,
      'export const q = `INSERT INTO experience_held_decisions (experience_id, answer) VALUES ($1, $2)`;\n',
      'src/controllers/experience/publishController.ts'],
    ['a lower-case change record in the run log', SYNC_CHANGE,
      'export const q = "insert into experience_sync_changes (sync_log_id) values ($1)";\n',
      'src/services/sync/runLog.ts'],
    ['an interpolated membership update in a handler', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `\n  UPDATE ${MEMBERSHIPS} m SET admission = $2 WHERE m.id = $1`;\n',
      'src/controllers/experience/lifecycleController.ts'],
    ['the same update after an earlier interpolation', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = (s: string) => `WITH k AS (SELECT id FROM ${KINDS} WHERE ${s})\n'
        + '  UPDATE ${MEMBERSHIPS} m SET admission = $2 FROM k WHERE m.kind_id = k.id`;\n',
      'src/controllers/experience/lifecycleController.ts'],
    ['a spelled membership insert in a handler', MEMBERSHIP,
      'export const q = `INSERT INTO experience_kind_memberships (experience_id, kind_id) VALUES ($1, $2)`;\n',
      'src/controllers/experience/curationController.ts'],
    ['an interpolated membership delete in a service', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `DELETE FROM ${MEMBERSHIPS} WHERE experience_id = $1`;\n',
      'src/services/lint-fixture.ts'],
    ['a candidate item answered by a handler', COMPONENT_ITEM,
      "export const q = `UPDATE experience_component_item_proposals SET answer = 'accepted' WHERE id = $1`;\n",
      'src/controllers/experience/componentItemController.ts'],
  ])('refuses a write to a gate table outside its writers: %s', async (_, message, code, file) => {
    expect(await draws(code, file, message)).toBe(true);
  });

  it.each([
    ['the conflict writer', CONFLICT,
      'export const q = `DELETE FROM experience_conflict_decisions WHERE experience_id = $1`;\n',
      'src/controllers/experience/conflictDecisions.ts'],
    ['the held-answer writer', HELD,
      'export const q = `INSERT INTO experience_held_decisions (experience_id) VALUES ($1)`;\n',
      'src/controllers/experience/heldDecisions.ts'],
    ['the change recorder', SYNC_CHANGE,
      'export const q = `INSERT INTO experience_sync_changes (sync_log_id) VALUES ($1)`;\n',
      'src/services/sync/changeRecorder.ts'],
    ['the component item finder', COMPONENT_ITEM,
      'export const q = `INSERT INTO experience_component_item_proposals (location_id) VALUES ($1)`;\n',
      'src/services/sync/componentItemFinder.ts'],
    ['the curator\'s answer to a candidate item', COMPONENT_ITEM,
      "export const q = `UPDATE experience_component_item_proposals SET answer = 'refused' WHERE id = $1`;\n",
      'src/controllers/experience/componentItemAnswers.ts'],
    ['the curator\'s membership writer', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${MEMBERSHIPS} m SET admission = $2 WHERE m.id = $1`;\n',
      'src/controllers/experience/membershipWriter.ts'],
    ['the admission sweep', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${MEMBERSHIPS} m SET is_iconic = true WHERE m.id = $1`;\n',
      'src/services/sync/admission.ts'],
    ['the verified pass a new content retires', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + "export const q = `UPDATE ${MEMBERSHIPS} m SET curation_state = 'auto'`;\n",
      'src/services/sync/curationDecay.ts'],
    ['the held proposal\'s pointer', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${MEMBERSHIPS} m SET pending_change_sync_log_id = $2`;\n',
      'src/services/sync/heldProposalPointer.ts'],
    ['missing detection\'s mark', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${MEMBERSHIPS} m SET missing_since = NOW()`;\n',
      'src/services/sync/missingDetection.ts'],
    ['the run\'s upsert', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `INSERT INTO ${MEMBERSHIPS} (experience_id) VALUES ($1)`;\n',
      'src/services/sync/experienceUpsert.ts'],
    ['the seed', MEMBERSHIP,
      'export const q = `INSERT INTO experience_kind_memberships (experience_id) VALUES ($1)`;\n',
      'src/db/seed/lint-fixture.ts'],
    ['the seed, for a change record', SYNC_CHANGE,
      'export const q = `INSERT INTO experience_sync_changes (sync_log_id) VALUES ($1)`;\n',
      'src/db/seed/lint-fixture.ts'],
    ['a read through the interpolation', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `SELECT m.id FROM ${MEMBERSHIPS} m WHERE m.experience_id = $1`;\n',
      'src/controllers/lint-fixture.ts'],
    ['a row lock ending a literal part', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = (skip: string) => `SELECT m.id FROM ${MEMBERSHIPS} m FOR UPDATE ${skip}`;\n',
      'src/controllers/lint-fixture.ts'],
    ['a key-share row lock ending a literal part', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = (skip: string) => `SELECT m.id FROM ${MEMBERSHIPS} m FOR NO KEY UPDATE ${skip}`;\n',
      'src/controllers/lint-fixture.ts'],
    ['an upsert\'s own update ending a literal part', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = (set: string) => `INSERT INTO t (id) SELECT m.id FROM ${MEMBERSHIPS} m\n'
        + '  ON CONFLICT (id) DO UPDATE ${set}`;\n',
      'src/controllers/lint-fixture.ts'],
    ['an update of another table joining the membership', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE experiences e SET name = $2 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id`;\n',
      'src/controllers/lint-fixture.ts'],
    ['an update of the kinds through their own interpolation', MEMBERSHIP,
      MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${KINDS} SET name = $2 WHERE id = $1`;\n',
      'src/controllers/lint-fixture.ts'],
    ['another table whose name starts the same', SYNC_CHANGE,
      "export const q = `UPDATE experience_sync_logs SET status = 'failed' WHERE id = $1`;\n",
      'src/controllers/lint-fixture.ts'],
  ])('lets a statement stand where it belongs, or one that is no write to the table: %s', async (_, message, code, file) => {
    expect(await draws(code, file, message)).toBe(false);
  });

  it('reads the update of another table joining the membership as that table\'s write', async () => {
    const code = MEMBERSHIPS_IMPORT
      + 'export const q = `UPDATE experiences e SET name = $2 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id`;\n';
    expect(await draws(code, 'src/controllers/lint-fixture.ts', EXPERIENCE)).toBe(true);
  });

  it('exempts the run\'s upsert from the two lists that name it, and from no other', async () => {
    const file = 'src/services/sync/experienceUpsert.ts';
    expect(await draws('export const q = `INSERT INTO experiences (name) VALUES ($1)`;\n', file, EXPERIENCE)).toBe(false);
    expect(await draws(MEMBERSHIPS_IMPORT + 'export const q = `UPDATE ${MEMBERSHIPS} m SET x = 1`;\n', file, MEMBERSHIP))
      .toBe(false);
    expect(await draws('export const q = `UPDATE regions SET name = $2 WHERE id = $1`;\n', file, REGION)).toBe(true);
  });

  it('exempts the admission sweep from the membership list alone', async () => {
    expect(await draws('export const q = `UPDATE experiences SET name = $2 WHERE id = $1`;\n',
      'src/services/sync/admission.ts', EXPERIENCE)).toBe(true);
  });
});
