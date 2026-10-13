import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { workAssertions } from './workAssertions.js';

/**
 * The watch on works no place a reader is offered holds (#1444), against
 * PostgreSQL: the Venus of Willendorf linked only to the Natural History
 * Museum, Vienna, which Art Museums refused and no other kind holds, is
 * listed; the same work at an offered museum, or offered as a place of its
 * own, is not; a work waiting for a curator is not lost.
 */

const MUSEUM = 9960;
const OTHER_MUSEUM = 9961;
const OWN_PLACE = 9962;
const VENUS = 'Q131397-fixture';

const check = workAssertions.find(a => a.id === 'work-no-offered-place-holds')!;
let venusId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[MUSEUM, OTHER_MUSEUM, OWN_PLACE]]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [VENUS]);
}

async function place(id: number, name: string, admission: 'admitted' | 'refused', externalId = `${id}-fixture`): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 2, $2, $3, ST_SetSRID(ST_MakePoint(16.36, 48.2), 4326))`,
    [id, `${id}-fixture`, name],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, $3, 'auto', NOW() FROM experience_sources s WHERE s.id = 2`,
    [id, externalId, admission],
  );
}

const listed = async () => (await pool.query(check.sql)).rows.filter(row => row.external_id === VENUS);

beforeEach(async () => {
  await clear();
  await place(MUSEUM, 'Natural History Museum, Vienna (fixture)', 'refused');
  venusId = (await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, sitelinks_count) VALUES ($1, 'Venus of Willendorf', 'sculpture', 67) RETURNING id`,
    [VENUS],
  )).rows[0].id;
  await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [MUSEUM, venusId]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('works no place a reader is offered holds (#1444)', () => {
  it('lists a work whose only venue its kind refused, naming the venue', async () => {
    const rows = await listed();
    expect(rows).toEqual([expect.objectContaining({ work_name: 'Venus of Willendorf', held_by: 'Natural History Museum, Vienna (fixture)' })]);
    expect(check.describe(rows[0])).toBe(
      'Venus of Willendorf (Q131397-fixture, 67 sitelinks) is held only by Natural History Museum, Vienna (fixture), which no kind offers a reader',
    );
  });

  it('lists a work no venue holds any more', async () => {
    await pool.query('UPDATE experience_treasures SET missing_since = NOW() WHERE treasure_id = $1', [venusId]);
    const rows = await listed();
    expect(check.describe(rows[0])).toBe('Venus of Willendorf (Q131397-fixture, 67 sitelinks) is held by no place');
  });

  it('leaves out a work an offered place holds', async () => {
    await place(OTHER_MUSEUM, 'An offered museum (fixture)', 'admitted');
    await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [OTHER_MUSEUM, venusId]);
    expect(await listed()).toEqual([]);
  });

  it('leaves out a work a reader reaches as a place of its own', async () => {
    await place(OWN_PLACE, 'Venus of Willendorf as a place (fixture)', 'admitted', VENUS);
    expect(await listed()).toEqual([]);
  });

  it('leaves out a work waiting for a curator', async () => {
    // As a run writes an unread work: pending from its arrival.
    await pool.query('DELETE FROM treasures WHERE id = $1', [venusId]);
    const unread = (await pool.query<{ id: number }>(
      `INSERT INTO treasures (external_id, name, treasure_type, sitelinks_count, curation_state)
       VALUES ($1, 'Venus of Willendorf', 'sculpture', 67, 'pending') RETURNING id`,
      [VENUS],
    )).rows[0].id;
    await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [MUSEUM, unread]);
    expect(await listed()).toEqual([]);
  });

  it('leaves out a work whose link to an offered museum is waiting for a curator', async () => {
    await place(OTHER_MUSEUM, 'An offered museum (fixture)', 'admitted');
    await pool.query(
      "INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'pending')",
      [OTHER_MUSEUM, venusId],
    );
    expect(await listed()).toEqual([]);
  });

  it('says where a curator refused the work, and never calls an offered museum unoffered', async () => {
    await place(OTHER_MUSEUM, 'An offered museum (fixture)', 'admitted');
    await pool.query(
      "INSERT INTO experience_treasures (experience_id, treasure_id, curation_state, refused_at) VALUES ($1, $2, 'pending', NOW())",
      [OTHER_MUSEUM, venusId],
    );
    const rows = await listed();
    expect(check.describe(rows[0])).toBe(
      'Venus of Willendorf (Q131397-fixture, 67 sitelinks) is held only by Natural History Museum, Vienna (fixture), '
      + 'which no kind offers a reader; and An offered museum (fixture), where a curator refused it',
    );
  });
});
