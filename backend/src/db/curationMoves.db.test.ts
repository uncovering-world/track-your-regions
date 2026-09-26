import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURATION_MOVES, CURATION_STATES, type CuratedTable, type CurationState } from '@tyr/shared/lifecycle';
import { pool } from './index.js';

/**
 * The database refuses exactly the `curation_state` moves `@tyr/shared/lifecycle`
 * does not list (#794, ADR-0070), executed against PostgreSQL: every pair of
 * states, on every table the gate covers, is tried as a real UPDATE and its
 * answer compared with `CURATION_MOVES`. The trigger and the list are two
 * statements of one rule, and this is what holds them to each other — a move
 * added to one and not the other fails here.
 *
 * Each pair gets a fresh row inserted in its `from` state, since an insert is
 * not a move; the fixture object and work are deleted before and after.
 */

const EXTERNAL_ID = 'curation-moves-fixture';
const WORK_EXTERNAL_ID = 'Q-curation-moves-fixture';
const SOURCE_ID = 1;

let experienceId: number;
let treasureId: number;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE source_id = $1 AND external_id = $2', [SOURCE_ID, EXTERNAL_ID]);
  await pool.query('DELETE FROM treasures WHERE external_id LIKE $1', [`${WORK_EXTERNAL_ID}%`]);
}

beforeAll(async () => {
  await clear();
  const experience = await pool.query<{ id: number }>(
    `INSERT INTO experiences (source_id, external_id, name, location)
     VALUES ($1, $2, 'Curation moves fixture', ST_SetSRID(ST_MakePoint(12.5, 41.9), 4326))
     RETURNING id`,
    [SOURCE_ID, EXTERNAL_ID],
  );
  experienceId = experience.rows[0].id;
  const work = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, 'Fixture work', 'painting') RETURNING id`,
    [WORK_EXTERNAL_ID],
  );
  treasureId = work.rows[0].id;
});

afterAll(async () => {
  await clear();
});

/** Insert one row of `table` in state `from`, and answer how to update it. */
async function rowIn(table: CuratedTable, from: CurationState, n: number): Promise<{ where: string; params: unknown[] }> {
  switch (table) {
    case 'experience_kind_memberships': {
      await pool.query('DELETE FROM experience_kind_memberships WHERE experience_id = $1', [experienceId]);
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, curation_state)
         VALUES ($1, (SELECT kind_id FROM experience_sources WHERE id = $2), $2, $3) RETURNING id`,
        [experienceId, SOURCE_ID, from],
      );
      return { where: 'id = $2', params: [inserted.rows[0].id] };
    }
    case 'experience_locations': {
      // One point at a time: a point's ordinal is unique within its object.
      await pool.query('DELETE FROM experience_locations WHERE experience_id = $1', [experienceId]);
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO experience_locations (experience_id, location, curation_state)
         VALUES ($1, ST_SetSRID(ST_MakePoint(12.5, 41.9), 4326), $2) RETURNING id`,
        [experienceId, from],
      );
      return { where: 'id = $2', params: [inserted.rows[0].id] };
    }
    case 'treasures': {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO treasures (external_id, name, treasure_type, curation_state)
         VALUES ($1, 'Fixture work', 'painting', $2) RETURNING id`,
        [`${WORK_EXTERNAL_ID}-${n}`, from],
      );
      return { where: 'id = $2', params: [inserted.rows[0].id] };
    }
    case 'experience_treasures': {
      await pool.query('DELETE FROM experience_treasures WHERE experience_id = $1', [experienceId]);
      await pool.query(
        'INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, $3)',
        [experienceId, treasureId, from],
      );
      return { where: 'experience_id = $2 AND treasure_id = $3', params: [experienceId, treasureId] };
    }
    default: {
      const unknown: never = table;
      throw new Error(`no fixture for ${String(unknown)}`);
    }
  }
}

const pairs = CURATION_STATES.flatMap(from => CURATION_STATES.filter(to => to !== from).map(to => [from, to] as const));
const cases = (Object.keys(CURATION_MOVES) as CuratedTable[])
  .flatMap(table => pairs.map(([from, to]) => [table, from, to] as const));

describe('the curation_state moves the database allows', () => {
  it.each(cases)('%s: %s → %s is allowed exactly when the list says so', async (table, from, to) => {
    const listed = (CURATION_MOVES[table] as readonly (readonly [string, string])[])
      .some(([f, t]) => f === from && t === to);
    const n = cases.findIndex(c => c[0] === table && c[1] === from && c[2] === to);
    const row = await rowIn(table, from, n);

    const update = pool.query(`UPDATE ${table} SET curation_state = $1 WHERE ${row.where}`, [to, ...row.params]);
    if (listed) {
      await expect(update).resolves.toMatchObject({ rowCount: 1 });
    } else {
      await expect(update).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('lets a row stay where it is: a write that leaves the state alone is no move', async () => {
    const row = await rowIn('experience_locations', 'verified', -1);
    await expect(pool.query(
      `UPDATE experience_locations SET curation_state = $1 WHERE ${row.where}`, ['verified', ...row.params],
    )).resolves.toMatchObject({ rowCount: 1 });
  });
});
