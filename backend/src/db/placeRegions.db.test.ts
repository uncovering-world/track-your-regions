import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { unassignExperienceFromRegion } from '../controllers/experience/curationRegionController.js';
import { pool } from './index.js';
import { MEMBERSHIPS } from './membership.js';
import { assignExperiencesToRegions, assignRegionsForExperiences } from '../services/sync/regionAssignmentService.js';
import { getExperiencesByRegion } from '../controllers/experience/experienceQueryController.js';
import { getRegionExperienceLocations } from '../controllers/experience/experienceLocationController.js';
import { experiencesByRegionQuerySchema, regionLocationsQuerySchema } from '../types/index.js';

/**
 * A place's regions are one row per region, its parts' included, and each
 * row says whether a reader finds the place there (ADR-0197), against
 * PostgreSQL: the rows `refresh_place_regions()` writes after placement, and
 * the ones the triggers on a point's state and a part relation rewrite.
 *
 * The fixture is a world view of its own: a root (9641) over two one-degree
 * leaves side by side, A (9642) and B (9643). A museum (9645) stands in A. A
 * serial site (9646) is made of two parts with no kind of their own, one in A
 * (9647) and one in B (9648) whose point is still unread, as a gated run left
 * a seventh temple of Malta's Megalithic Temples in Ċentrali. A frontier
 * (9649) is there to hold the site as a part of its own. Everything is deleted
 * before and after; the dependants cascade.
 */

const WORLD_VIEW = 9640;
const ROOT = 9641;
const LEAF_A = 9642;
const LEAF_B = 9643;
const MUSEUM = 9645;
const SITE = 9646;
const PART_A = 9647;
const PART_B = 9648;
const FRONTIER = 9649;
const PLACES = [MUSEUM, SITE, PART_A, PART_B, FRONTIER];
const CURATOR = '00000000-0000-4000-8000-000000009640';

const points: Record<number, number> = {};

const REFUSING_TRIGGER = 'fixture_9640_refuse_museum_row';

async function clear(): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${REFUSING_TRIGGER} ON experience_regions`);
  await pool.query(`DROP FUNCTION IF EXISTS ${REFUSING_TRIGGER}()`);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

async function place(id: number, name: string, lon: number, lat: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)
       FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `${id}-place-regions-fixture`, name, lon, lat],
  );
}

/** A membership a reader is shown, so the place is in a region's list where its rows say so. */
async function offeredMembership(id: number): Promise<void> {
  await pool.query(
    `INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `${id}-place-regions-fixture`],
  );
}

async function point(placeId: number, lon: number, lat: number, state: 'auto' | 'pending'): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     VALUES ($1, 'fixture point', 1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4) RETURNING id`,
    [placeId, lon, lat, state],
  );
  points[placeId] = row.rows[0].id;
}

/** A place's rows in the fixture's world view: region and listing, in region order. */
async function rows(placeId: number): Promise<Array<[number, string, string]>> {
  const result = await pool.query<{ region_id: number; listing: string; assignment_type: string }>(
    `SELECT er.region_id, er.listing, er.assignment_type FROM experience_regions er
       JOIN regions r ON r.id = er.region_id AND r.world_view_id = $2
      WHERE er.experience_id = $1 ORDER BY er.region_id`,
    [placeId, WORLD_VIEW],
  );
  return result.rows.map(row => [row.region_id, row.listing, row.assignment_type]);
}

const offered = (...regions: number[]) => regions.map(region => [region, 'offered', 'auto']);

/** The ids a region's own list offers a reader. */
async function listed(regionId: number): Promise<number[]> {
  const response = await getExperiencesByRegion({
    params: { regionId },
    query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }),
    caller: undefined,
  });
  return response.experiences.map(row => row.id).filter(id => PLACES.includes(id)).sort();
}

const setPoint = (placeId: number, assignment: string) =>
  pool.query(`UPDATE experience_locations SET ${assignment} WHERE id = $1`, [points[placeId]]);

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Place regions fixture', false)`, [WORLD_VIEW],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
       ($1, $4, 'Root', NULL, false, NULL),
       ($2, $4, 'Leaf A', $1, true, ST_Multi(ST_MakeEnvelope(9.5, 49.5, 10.5, 50.5, 4326))),
       ($3, $4, 'Leaf B', $1, true, ST_Multi(ST_MakeEnvelope(10.5, 49.5, 11.5, 50.5, 4326)))`,
    [ROOT, LEAF_A, LEAF_B, WORLD_VIEW],
  );
  await place(MUSEUM, 'A museum (place regions fixture)', 10.1, 50.0);
  await offeredMembership(MUSEUM);
  await point(MUSEUM, 10.1, 50.0, 'auto');

  await place(SITE, 'A serial site (place regions fixture)', 10.2, 50.1);
  await offeredMembership(SITE);
  await place(PART_A, 'A temple in A (place regions fixture)', 10.2, 50.1);
  await point(PART_A, 10.2, 50.1, 'auto');
  await place(PART_B, 'A temple in B (place regions fixture)', 11.0, 50.0);
  await point(PART_B, 11.0, 50.0, 'pending');
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason) VALUES ($1, $2, 'curator'), ($1, $3, 'curator')`,
    [SITE, PART_A, PART_B],
  );

  await assignRegionsForExperiences([MUSEUM, SITE], WORLD_VIEW);

  // The step's own check, so a scenario that starts wrong says so here.
  expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a place's regions (ADR-0197)", () => {
  it('puts a place in the leaf that holds its point and in every region above it', async () => {
    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
    expect(await listed(LEAF_A)).toContain(MUSEUM);
  });

  it('gives a part with no kind its own rows, and offers it in no list or map: its site is the one shown', async () => {
    expect(await rows(PART_A)).toEqual(offered(ROOT, LEAF_A));

    expect(await listed(LEAF_A)).toEqual([MUSEUM, SITE]);
    const { locationsByExperience } = await getRegionExperienceLocations({
      params: { regionId: LEAF_A }, query: regionLocationsQuerySchema.parse({ includeChildren: 'false' }),
    });
    expect(locationsByExperience[SITE]?.map(l => l.id)).toEqual([points[PART_A]]);
    expect(locationsByExperience[PART_A]).toBeUndefined();
  });

  it('lists a site where its read part is, and holds the region of its unread part for curators only', async () => {
    // Ċentrali: the site is placed there by the unread temple, and no reader's list holds it yet.
    expect(await rows(SITE)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'scope', 'auto']]);
    expect(await rows(PART_B)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);
    expect(await listed(LEAF_B)).toEqual([]);
  });

  it("turns the site's row offered when a curator publishes the part, through the point's trigger alone", async () => {
    await setPoint(PART_B, "curation_state = 'verified'");

    expect(await rows(SITE)).toEqual(offered(ROOT, LEAF_A, LEAF_B));
    expect(await rows(PART_B)).toEqual(offered(ROOT, LEAF_B));
    expect(await listed(LEAF_B)).toEqual([SITE]);
  });

  it('holds a site none of whose parts a reader may see as fallback, listed for nobody', async () => {
    // The read temple's point goes; the unread one is all the site shows.
    await pool.query('DELETE FROM experience_locations WHERE id = $1', [points[PART_A]]);

    expect(await rows(PART_A)).toEqual([]);
    expect(await rows(SITE)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);
    expect(await listed(LEAF_A)).toEqual([MUSEUM]);
    expect(await listed(LEAF_B)).toEqual([]);
  });

  it('drops the rows a point gave once a curator turns it down, the source withdraws it, or it is gone', async () => {
    await setPoint(PART_B, 'refused_at = NOW()');
    expect(await rows(SITE)).toEqual(offered(ROOT, LEAF_A));
    expect(await rows(PART_B)).toEqual([]);

    await setPoint(PART_B, 'refused_at = NULL');
    expect(await rows(SITE)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'scope', 'auto']]);

    await setPoint(PART_A, 'missing_since = NOW()');
    // Only the unread part is left standing, so the site falls back to it.
    expect(await rows(SITE)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);

    await setPoint(PART_A, "missing_since = NULL, existence = 'lost'");
    expect(await rows(PART_A)).toEqual([]);
  });

  it("places a whole by its own and its direct parts' points, as its region list and map show it", async () => {
    // A frontier whose one part is the site: the site has no point of its
    // own, and its temples are the site's parts, not the frontier's. No reader
    // shows the frontier a point, so no region lists it.
    await place(FRONTIER, 'A frontier (place regions fixture)', 10.2, 50.1);
    await offeredMembership(FRONTIER);
    await pool.query(`INSERT INTO experience_parts (whole_id, part_id, reason) VALUES ($1, $2, 'curator')`, [FRONTIER, SITE]);

    const shownIn = async (regionId: number) => {
      const list = await getExperiencesByRegion({
        params: { regionId }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
      });
      const { locationsByExperience } = await getRegionExperienceLocations({
        params: { regionId }, query: regionLocationsQuerySchema.parse({ includeChildren: 'false' }),
      });
      return {
        count: list.experiences.find(row => row.id === FRONTIER)?.location_count ?? null,
        points: (locationsByExperience[FRONTIER] ?? []).map(l => l.id),
      };
    };
    expect(await rows(FRONTIER)).toEqual([]);
    expect(await shownIn(LEAF_A)).toEqual({ count: null, points: [] });

    // A point of the site's own is the frontier's to show, so it lists it there.
    await point(SITE, 10.3, 50.2, 'auto');
    await assignRegionsForExperiences([SITE], WORLD_VIEW);
    expect(await rows(FRONTIER)).toEqual(offered(ROOT, LEAF_A));
    expect(await shownIn(LEAF_A)).toEqual({ count: 1, points: [points[SITE]] });

    await pool.query('DELETE FROM experience_parts WHERE whole_id = $1', [FRONTIER]);
    expect(await rows(FRONTIER)).toEqual([]);
  });

  it('refreshes the whole a part relation committed while a placement of its part waited for the key', async () => {
    await place(FRONTIER, 'A frontier (place regions fixture)', 10.1, 50.0);
    // The museum's point has moved into B and is not placed there yet: a moved
    // coordinate refreshes nothing. Moved before the two sessions start, since
    // the move's pairing mark would wait for the relation's.
    await setPoint(MUSEUM, 'location = ST_SetSRID(ST_MakePoint(11.0, 50.0), 4326)');
    const relating = await pool.connect();
    const placing = await pool.connect();
    try {
      // The museum becomes a part of the frontier, and the frontier takes its
      // rows from the museum's point as placement left it: in A.
      await relating.query('BEGIN');
      await relating.query(`INSERT INTO experience_parts (whole_id, part_id, reason) VALUES ($1, $2, 'curator')`,
        [FRONTIER, MUSEUM]);
      expect(await rows(FRONTIER)).toEqual([]);

      // Meanwhile the museum's point is placed in B. Its refresh reaches the
      // museum alone, since the relation is not committed, and waits for the key.
      await placing.query('BEGIN');
      await placing.query('DELETE FROM experience_location_regions WHERE location_id = $1', [points[MUSEUM]]);
      await placing.query(
        `INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
         SELECT $1, unnest($2::int[]), 'auto'`, [points[MUSEUM], [ROOT, LEAF_B]],
      );
      let placed = false;
      const placement = placing.query('SELECT refresh_place_regions(ARRAY[$1::int])', [MUSEUM])
        .then(() => { placed = true; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(placed).toBe(false);

      // Once the relation commits, the refresh reads its reach again and
      // rewrites the frontier from the museum's new placement too.
      await relating.query('COMMIT');
      await placement;
      await placing.query('COMMIT');
    } finally {
      await relating.query('ROLLBACK').catch(() => {});
      await placing.query('ROLLBACK').catch(() => {});
      relating.release();
      placing.release();
    }

    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_B));
    expect(await rows(FRONTIER)).toEqual(offered(ROOT, LEAF_B));
  });

  it('refreshes both places when a point moves from one to the other', async () => {
    await setPoint(PART_A, `experience_id = ${MUSEUM}`);

    expect(await rows(PART_A)).toEqual([]);
    expect(await rows(SITE)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);
    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
  });

  it("never rewrites a curator's manual row, and a refresh with nothing to change writes nothing", async () => {
    await pool.query(
      `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
      [MUSEUM, LEAF_B],
    );
    const refreshed = await pool.query<{ written: number }>(
      'SELECT refresh_place_regions($1::int[]) AS written', [[MUSEUM, SITE]],
    );

    expect(refreshed.rows[0].written).toBe(0);
    expect(await rows(MUSEUM)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'offered', 'manual']]);
  });

  // A delete of places cascades to their points, their parts and their rows.
  // The triggers those cascades queue fire only once every cascade of the
  // statement has run (a foreign key's action defers the AFTER triggers it
  // causes to the end of the outer statement), so a refresh never reaches a
  // deleted place's points through a relation not yet taken away, and never
  // writes a row for a place the statement deleted.
  it('deletes a whole with its own point and its parts in one statement, and writes no row for any of them', async () => {
    await point(SITE, 10.3, 50.2, 'auto');
    await assignRegionsForExperiences([SITE], WORLD_VIEW);
    expect(await rows(SITE)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'scope', 'auto']]);

    await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[SITE, PART_A, PART_B]]);

    for (const gone of [SITE, PART_A, PART_B]) expect(await rows(gone)).toEqual([]);
    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
  });

  it("drops a deleted part's regions from its whole, and keeps a deleted whole's parts in theirs", async () => {
    await pool.query('DELETE FROM experiences WHERE id = $1', [PART_B]);
    expect(await rows(SITE)).toEqual(offered(ROOT, LEAF_A));

    await point(SITE, 10.3, 50.2, 'auto');
    await assignRegionsForExperiences([SITE], WORLD_VIEW);
    await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
    expect(await rows(SITE)).toEqual([]);
    expect(await rows(PART_A)).toEqual(offered(ROOT, LEAF_A));
  });

  it("clears a folded place's rows and its whole's share of them when a merge folds its point", async () => {
    // What a merge does to the point (ADR-0086): folded into the survivor's.
    await setPoint(PART_A, `merged_into_id = ${points[MUSEUM]}`);

    expect(await rows(PART_A)).toEqual([]);
    expect(await rows(SITE)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);

    // And its undo.
    await setPoint(PART_A, 'merged_into_id = NULL');
    expect(await rows(PART_A)).toEqual(offered(ROOT, LEAF_A));
    expect(await rows(SITE)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'scope', 'auto']]);
  });

  it('serializes two placements of two parts of a whole that holds no rows yet', async () => {
    // The site holds no rows: its parts' points are not placed yet.
    await pool.query('DELETE FROM experience_location_regions WHERE location_id = ANY($1::int[])',
      [[points[PART_A], points[PART_B]]]);
    await pool.query('SELECT refresh_place_regions($1::int[])', [[SITE, PART_A, PART_B]]);
    expect(await rows(SITE)).toEqual([]);

    const placeIn = (client: PoolClient, placeId: number, regions: number[]) => client.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
       SELECT $1, unnest($2::int[]), 'auto'`, [points[placeId], regions],
    );
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      // The read temple, placed and refreshed in one transaction left open.
      await first.query('BEGIN');
      await placeIn(first, PART_A, [ROOT, LEAF_A]);
      await first.query('SELECT refresh_place_regions(ARRAY[$1::int])', [PART_A]);

      // The unread temple, in another: its refresh of the site has to wait
      // for the first, or it computes the site without the read temple and
      // writes the root back as fallback.
      await second.query('BEGIN');
      await placeIn(second, PART_B, [ROOT, LEAF_B]);
      let secondDone = false;
      const secondRefresh = second.query('SELECT refresh_place_regions(ARRAY[$1::int])', [PART_B])
        .then(() => { secondDone = true; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(secondDone).toBe(false);

      await first.query('COMMIT');
      await secondRefresh;
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => {});
      await second.query('ROLLBACK').catch(() => {});
      first.release();
      second.release();
    }

    expect(await rows(SITE)).toEqual([...offered(ROOT, LEAF_A), [LEAF_B, 'scope', 'auto']]);
  });

  it('refreshes both wholes when a part moves from one to the other', async () => {
    await place(FRONTIER, 'A frontier (place regions fixture)', 10.2, 50.1);
    await pool.query('UPDATE experience_parts SET whole_id = $1 WHERE whole_id = $2 AND part_id = $3',
      [FRONTIER, SITE, PART_A]);

    expect(await rows(FRONTIER)).toEqual(offered(ROOT, LEAF_A));
    expect(await rows(SITE)).toEqual([[ROOT, 'fallback', 'auto'], [LEAF_B, 'fallback', 'auto']]);
  });

  it("gives a place back the row its point gives when a curator withdraws their own row there", async () => {
    const curator = await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'admin') RETURNING id`, [CURATOR],
    );
    await pool.query(
      `UPDATE experience_regions SET assignment_type = 'manual' WHERE experience_id = $1 AND region_id = $2`,
      [MUSEUM, LEAF_A],
    );
    await unassignExperienceFromRegion({
      params: { id: MUSEUM, regionId: LEAF_A }, caller: { id: curator.rows[0].id, role: 'admin' } as Express.User,
    });

    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
  });

  it('keeps the curator\'s row, and logs nothing, when the refresh after the withdrawal fails', async () => {
    const curator = await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'admin') RETURNING id`, [CURATOR],
    );
    await pool.query(
      `UPDATE experience_regions SET assignment_type = 'manual' WHERE experience_id = $1 AND region_id = $2`,
      [MUSEUM, LEAF_A],
    );
    // Refuses the automatic row the refresh writes back, after the delete has run.
    await pool.query(
      `CREATE FUNCTION ${REFUSING_TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'fixture refuses the museum''s row'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${REFUSING_TRIGGER} BEFORE INSERT ON experience_regions
       FOR EACH ROW WHEN (NEW.experience_id = ${MUSEUM} AND NEW.assignment_type = 'auto')
       EXECUTE FUNCTION ${REFUSING_TRIGGER}()`,
    );
    try {
      await expect(unassignExperienceFromRegion({
        params: { id: MUSEUM, regionId: LEAF_A }, caller: { id: curator.rows[0].id, role: 'admin' } as Express.User,
      })).rejects.toThrow(/fixture refuses/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${REFUSING_TRIGGER} ON experience_regions`);
      await pool.query(`DROP FUNCTION IF EXISTS ${REFUSING_TRIGGER}()`);
    }

    expect(await rows(MUSEUM)).toEqual([[ROOT, 'offered', 'auto'], [LEAF_A, 'offered', 'manual']]);
    const logged = await pool.query(
      `SELECT 1 FROM experience_curation_log WHERE experience_id = $1 AND action = 'removed_from_region'`, [MUSEUM],
    );
    expect(logged.rowCount).toBe(0);
  });

  it("waits for a refresh holding the place's key before withdrawing a curator's row, so the two never deadlock", async () => {
    const curator = await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'admin') RETURNING id`, [CURATOR],
    );
    await pool.query(
      `UPDATE experience_regions SET assignment_type = 'manual' WHERE experience_id = $1 AND region_id = $2`,
      [MUSEUM, LEAF_A],
    );
    const refreshing = await pool.connect();
    try {
      // A placement or a publish of the museum's point, holding its key.
      await refreshing.query('BEGIN');
      await refreshing.query('SELECT lock_place_regions(ARRAY[$1::int])', [MUSEUM]);

      let withdrawn = false;
      const withdrawal = unassignExperienceFromRegion({
        params: { id: MUSEUM, regionId: LEAF_A }, caller: { id: curator.rows[0].id, role: 'admin' } as Express.User,
      }).then(() => { withdrawn = true; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(withdrawn).toBe(false);

      // The refresh writes the museum's row in A. Had the withdrawal deleted
      // that row before waiting for the key, this write would wait for the
      // withdrawal while it waits for the key: a cycle Postgres breaks by
      // aborting one of the two.
      await refreshing.query('SELECT refresh_place_regions(ARRAY[$1::int])', [MUSEUM]);
      await refreshing.query('COMMIT');
      await withdrawal;
    } finally {
      await refreshing.query('ROLLBACK').catch(() => {});
      refreshing.release();
    }

    expect(await rows(MUSEUM)).toEqual(offered(ROOT, LEAF_A));
    const logged = await pool.query(
      `SELECT 1 FROM experience_curation_log WHERE experience_id = $1 AND action = 'removed_from_region'`, [MUSEUM],
    );
    expect(logged.rowCount).toBe(1);
  });

  it("places a world view whole to the same rows as each place's own placement", async () => {
    const before = await Promise.all(PLACES.map(rows));
    const progress = await assignExperiencesToRegions(WORLD_VIEW);

    expect(progress.status).toBe('complete');
    expect(await Promise.all(PLACES.map(rows))).toEqual(before);
  });
});
