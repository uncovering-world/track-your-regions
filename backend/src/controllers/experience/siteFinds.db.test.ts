import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getSiteFinds } from './experienceFindsController.js';
import { findsOnViewCountSql } from './siteFinds.js';

/**
 * The count a region's list carries on a site's row and the site's own list
 * of finds are one answer (#907), executed against PostgreSQL: the two reads
 * are composed from the same fragments, and only the real planner can say the
 * composition means what each read means on its own.
 *
 * The fixture is a made-up dig and two made-up museums: one a reader may be
 * sent to, one still waiting for a curator. Five works name a place they were
 * found, and exactly one of them is a find of the dig on view — the others are
 * held only by the unread museum, placed by a link the source no longer
 * makes, not yet passed themselves, or found at another dig. Deleted before
 * and after.
 */

const DIG = 9560;
const SHOWN = 9561;
const UNREAD = 9562;
const DIG_QID = 'Q9560-dig';
const WORKS = {
  onView: 'Q9560-bronze-mask',
  onlyUnread: 'Q9560-gold-cup',
  linkGone: 'Q9560-clay-tablet',
  workUnread: 'Q9560-stone-seal',
  elsewhere: 'Q9560-silver-bowl',
} as const;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[DIG, SHOWN, UNREAD]]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [Object.values(WORKS)]);
}

/** A place of the Archaeology kind: the dig, or a museum, read or not. */
async function place(id: number, type: string, state: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, type, location)
     VALUES ($1, 5, $2, $3, $4, ST_SetSRID(ST_MakePoint(22.75, 37.73), 4326))`,
    [id, id === DIG ? DIG_QID : `Q-venue-${id}`, `Place ${id}`, type],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state)
     VALUES ($1, 5, 5, (SELECT external_id FROM experiences WHERE id = $1), 'admitted', $2)`,
    [id, state],
  );
}

/** A work found at `foundAt`, held by each venue of `links` — a missing date says the source stopped placing it. */
async function work(
  externalId: string, foundAt: string, state: string, links: [number, string | null][],
): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, curation_state, metadata)
     VALUES ($1, $1, 'artifact', $2, jsonb_build_object('foundAt', jsonb_build_object('qid', $3::text)))
     RETURNING id`,
    [externalId, state, foundAt],
  );
  for (const [venue, missingSince] of links) {
    await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state, missing_since)
       VALUES ($1, $2, 'verified', $3)`,
      [venue, row.rows[0].id, missingSince],
    );
  }
}

beforeEach(async () => {
  await clear();
  await place(DIG, 'site', 'verified');
  await place(SHOWN, 'museum', 'verified');
  await place(UNREAD, 'museum', 'pending');
  await work(WORKS.onView, DIG_QID, 'verified', [[SHOWN, null], [UNREAD, null]]);
  await work(WORKS.onlyUnread, DIG_QID, 'verified', [[UNREAD, null]]);
  await work(WORKS.linkGone, DIG_QID, 'verified', [[SHOWN, '2026-09-01']]);
  await work(WORKS.workUnread, DIG_QID, 'pending', [[SHOWN, null]]);
  await work(WORKS.elsewhere, 'Q9560-another-dig', 'verified', [[SHOWN, null]]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** The count a region's list would carry on this row. */
async function countOn(id: number): Promise<number> {
  const row = await pool.query<{ n: number }>(
    `SELECT ${findsOnViewCountSql('e')} AS n FROM experiences e WHERE e.id = $1`, [id],
  );
  return row.rows[0].n;
}

describe('the finds on view of a site', () => {
  it('lists and counts the one find a reader can go and see, and no other', async () => {
    const list = await getSiteFinds({ params: { id: DIG } });

    expect(list.finds.map((find) => find.external_id)).toEqual([WORKS.onView]);
    // Shown at the museum a reader may be sent to, never at the unread one.
    expect(list.finds[0].shown_at.map((venue) => venue.id)).toEqual([SHOWN]);
    expect(await countOn(DIG)).toBe(list.total);
  });

  it('stays one answer when the museum a reader could go to no longer stands', async () => {
    await pool.query(`UPDATE experiences SET existence = 'lost' WHERE id = $1`, [SHOWN]);

    const list = await getSiteFinds({ params: { id: DIG } });
    expect(list.total).toBe(0);
    expect(await countOn(DIG)).toBe(0);
  });

  it('lists and counts the finds of a site that no longer stands, which are still on view', async () => {
    // A dig flooded by a dam: gone, and shown to a reader who asks for what is
    // gone, while what was found there is in a museum a traveller can visit.
    await pool.query(`UPDATE experiences SET existence = 'lost' WHERE id = $1`, [DIG]);

    const list = await getSiteFinds({ params: { id: DIG } });
    expect(list.total).toBe(1);
    expect(await countOn(DIG)).toBe(list.total);
  });

  it('counts nothing on a row that is not a site', async () => {
    expect(await countOn(SHOWN)).toBe(0);
  });
});
