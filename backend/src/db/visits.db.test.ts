import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { MEMBERSHIPS } from './membership.js';
import { getVisitedIds, unmarkVisited } from '../controllers/experience/experienceVisitController.js';
import {
  getExperienceVisitedStatus, getVisitedLocationIds, markLocationVisited, unmarkAllLocationsVisited, unmarkLocationVisited,
} from '../controllers/experience/locationVisitController.js';
import { markTreasureViewed } from '../controllers/experience/experienceTreasureController.js';

/**
 * A traveller's visit is one row on the place they ticked, and a whole is read
 * through its parts (#2120), against PostgreSQL. Map mode and Discover read
 * the same state, so a serial site with two of its three monasteries visited
 * reads partly visited in both, as Haghpat and Sanahin does.
 *
 * The fixture: a serial site (9431) of three parts with no kind of their own
 * (9432–9434), one of them also a museum holding a work, as Antwerp Cathedral
 * is one of the Belfries of Belgium and France; a twin of the first part a
 * merge folded (9435); and an edition cast twice (9436). Deleted before and
 * after; the dependants cascade.
 */

const SITE = 9431;
const PART_A = 9432;
const PART_B = 9433;
const PART_C = 9434;
const FOLDED_TWIN = 9435;
const EDITION = 9436;
const PLACES = [SITE, PART_A, PART_B, PART_C, FOLDED_TWIN, EDITION];
const TRAVELLER = '00000000-0000-4000-8000-000000009431';
const WORK = 'Q9431-visits-fixture-work';

const points: Record<number, number[]> = {};
let userId = 0;
let workId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [TRAVELLER]);
}

async function place(id: number, name: string, offered: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(44.7, 41.1), 4326) FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `Q${id}001`, name],
  );
  if (offered) {
    await pool.query(
      `INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [id, `Q${id}001`],
    );
  }
}

async function point(placeId: number, lon: number): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     VALUES ($1, 'fixture point', 1, ST_SetSRID(ST_MakePoint($2, 41.1), 4326), 'auto') RETURNING id`,
    [placeId, lon],
  );
  points[placeId] = [...(points[placeId] ?? []), row.rows[0].id];
}

const traveller = () => ({ id: userId, role: 'user' }) as Express.User;
const visit = (placeId: number) =>
  pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, placeId]);
/** The places the traveller holds a visit row on, among the fixture's. */
async function held(): Promise<number[]> {
  const rows = await pool.query<{ experience_id: number }>(
    'SELECT experience_id FROM user_visited_experiences WHERE user_id = $1 AND experience_id = ANY($2::int[]) ORDER BY 1',
    [userId, PLACES],
  );
  return rows.rows.map(row => row.experience_id);
}
/** Discover's read: the fixture's places visited, and those only partly visited. */
async function states(): Promise<{ visited: number[]; partial: number[] }> {
  const answer = await getVisitedIds({ query: {}, caller: traveller() });
  return {
    visited: answer.visitedIds.filter(id => PLACES.includes(id)).sort(),
    partial: answer.partialIds.filter(id => PLACES.includes(id)).sort(),
  };
}

beforeEach(async () => {
  await clear();
  for (const key of Object.keys(points)) delete points[Number(key)];
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user') RETURNING id`, [TRAVELLER],
  )).rows[0].id;

  await place(SITE, 'A serial site (visits fixture)', true);
  await place(PART_A, 'A cathedral and museum (visits fixture)', true);
  await place(PART_B, 'A monastery (visits fixture)', false);
  await place(PART_C, 'A bridge (visits fixture)', false);
  await point(PART_A, 44.70);
  await point(PART_B, 44.71);
  await point(PART_C, 44.72);
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason)
     SELECT $1, part, 'curator' FROM unnest($2::int[]) AS part`,
    [SITE, [PART_A, PART_B, PART_C]],
  );
  await place(FOLDED_TWIN, 'The first part again (visits fixture)', false);
  await pool.query('UPDATE experiences SET merged_into_id = $1 WHERE id = $2', [PART_A, FOLDED_TWIN]);

  await place(EDITION, 'A sculpture cast twice (visits fixture)', true);
  await pool.query('UPDATE experiences SET cast_points = true WHERE id = $1', [EDITION]);
  await point(EDITION, 2.93);
  await point(EDITION, -75.70);

  workId = (await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, curation_state)
     VALUES ($1, 'An altarpiece (visits fixture)', 'painting', 'verified') RETURNING id`, [WORK],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'verified')`,
    [PART_A, workId],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a traveller's visits, one row on the place ticked (#2120)", () => {
  it('reads a site with two of its three parts visited as partly visited, and its folded twin nowhere', async () => {
    // Haghpat and Sanahin: two monasteries visited, the bridge not, and a
    // visit left on a twin a merge folded into the first monastery.
    await visit(PART_A);
    await visit(PART_B);
    await visit(FOLDED_TWIN);

    expect(await states()).toEqual({ visited: [SITE, PART_A, PART_B], partial: [SITE] });
    expect(await getExperienceVisitedStatus({ params: { id: SITE }, caller: traveller() }))
      .toMatchObject({ visitedStatus: 'partial', visitedLocations: 2, totalLocations: 3 });
    const ticks = await getVisitedLocationIds({ query: { experienceId: SITE }, caller: traveller() });
    expect(ticks.visitedLocationIds.sort()).toEqual([points[PART_A][0], points[PART_B][0]].sort());
  });

  it('reads the site visited once every part is', async () => {
    await visit(PART_A);
    await visit(PART_B);
    await visit(PART_C);

    expect(await states()).toEqual({ visited: [SITE, PART_A, PART_B, PART_C], partial: [] });
  });

  it('marks the cathedral where a work was seen, and neither the other parts nor the site itself', async () => {
    await markTreasureViewed({ params: { treasureId: workId }, body: { experienceId: PART_A }, caller: traveller() });

    expect(await held()).toEqual([PART_A]);
    expect(await states()).toEqual({ visited: [SITE, PART_A], partial: [SITE] });
  });

  it("takes back only a site's own tick, and its card's Unmark all clears its parts too", async () => {
    await visit(SITE);
    await visit(PART_A);
    await visit(PART_B);

    await unmarkVisited({ params: { experienceId: SITE }, caller: traveller() });
    expect(await held()).toEqual([PART_A, PART_B]);
    expect(await states()).toEqual({ visited: [SITE, PART_A, PART_B], partial: [SITE] });

    await unmarkAllLocationsVisited({ params: { experienceId: SITE }, query: {}, caller: traveller() });
    expect(await held()).toEqual([]);
    expect(await states()).toEqual({ visited: [], partial: [] });
  });

  it("keeps a visit on a part the traveller is not shown when the site's places are all unmarked", async () => {
    await pool.query('UPDATE experience_locations SET missing_since = NOW() WHERE id = $1', [points[PART_C][0]]);
    await visit(PART_B);
    await visit(PART_C);

    await unmarkAllLocationsVisited({ params: { experienceId: SITE }, query: {}, caller: traveller() });
    expect(await held()).toEqual([PART_C]);

    await expect(unmarkLocationVisited({ params: { locationId: points[PART_C][0] }, caller: traveller() }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await held()).toEqual([PART_C]);
  });

  it('never clears the visit on a place since folded, from a stale page', async () => {
    await visit(FOLDED_TWIN);

    await unmarkAllLocationsVisited({ params: { experienceId: FOLDED_TWIN }, query: {}, caller: traveller() });
    await expect(unmarkVisited({ params: { experienceId: FOLDED_TWIN }, caller: traveller() }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await held()).toEqual([FOLDED_TWIN]);
  });

  it("reads a site with a point of its own visited once that point is ticked too, and lists no tick 'as a whole' for it", async () => {
    // The City of Graz: a point named for the whole site beside its parts.
    await point(SITE, 44.69);
    await visit(PART_A);
    await visit(PART_B);
    await visit(PART_C);
    expect(await states()).toEqual({ visited: [SITE, PART_A, PART_B, PART_C], partial: [SITE] });

    // Its own point's tick is the site's own row, and the site is visited.
    await markLocationVisited({ params: { locationId: points[SITE][0] }, body: {}, caller: traveller() });
    expect(await held()).toEqual([SITE, PART_A, PART_B, PART_C]);
    expect(await states()).toEqual({ visited: [SITE, PART_A, PART_B, PART_C], partial: [] });
    const answer = await getVisitedIds({ query: {}, caller: traveller() });
    expect(answer.wholeTickedIds.filter(id => PLACES.includes(id))).toEqual([]);
  });

  it('reads a site ticked as a whole partly visited until its parts are', async () => {
    await visit(SITE);

    expect(await states()).toEqual({ visited: [SITE], partial: [SITE] });
    const answer = await getVisitedIds({ query: {}, caller: traveller() });
    expect(answer.wholeTickedIds.filter(id => PLACES.includes(id))).toEqual([SITE]);
  });

  it('marks every cast of an edition with one tick, and clears them all with one', async () => {
    await markLocationVisited({ params: { locationId: points[EDITION][0] }, body: {}, caller: traveller() });

    expect(await held()).toEqual([EDITION]);
    expect(await getExperienceVisitedStatus({ params: { id: EDITION }, caller: traveller() }))
      .toMatchObject({ visitedStatus: 'visited', visitedLocations: 2, totalLocations: 2 });

    await unmarkLocationVisited({ params: { locationId: points[EDITION][1] }, caller: traveller() });
    expect(await held()).toEqual([]);
  });
});
