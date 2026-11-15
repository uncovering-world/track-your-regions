import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { MEMBERSHIPS } from './membership.js';
import { assignRegionsForExperiences } from '../services/sync/regionAssignmentService.js';
import { getExperiencesByRegion } from '../controllers/experience/experienceQueryController.js';
import { getExperienceLocations, getRegionExperienceLocations } from '../controllers/experience/experienceLocationController.js';
import { getWorldPoints } from '../controllers/experience/worldPointsController.js';
import { unplacedAssertions } from '../controllers/admin/dataAssertions/unplacedAssertions.js';
import {
  experienceLocationsQuerySchema, experiencesByRegionQuerySchema, regionLocationsQuerySchema, worldPointsQuerySchema,
} from '../types/index.js';

/**
 * A nested whole is shown and placed by its leaves (ADR-0211), against
 * PostgreSQL: the places at the bottom of its parts (`whole_leaves`), never a
 * part that is a whole itself, place it in its regions, draw its pins, fill
 * its card and its row.
 *
 * The fixture is Fujisan once a curator nests the Oshino Hakkai ponds under
 * an Oshino Hakkai of their own: a mountain (9665) listed in a kind, whose
 * one part is a spring group (9666) with no point of its own, whose parts are
 * two ponds of no kind (9667, 9668), some 430 m apart, so the spring group is
 * a container that may hold a point (ADR-0210). One pond stands in leaf A
 * (9662) and one in leaf B (9663) of a world view of its own (9660, root
 * 9661), either side of their border. Nothing of the mountain's own stands in
 * B: only the pond two levels down puts it there.
 * Everything is deleted before and after; the dependants cascade.
 */

const WORLD_VIEW = 9660;
const ROOT = 9661;
const LEAF_A = 9662;
const LEAF_B = 9663;
const MOUNTAIN = 9665;
const SPRINGS = 9666;
const POND_A = 9667;
const POND_B = 9668;
const PLACES = [MOUNTAIN, SPRINGS, POND_A, POND_B];

const points: Record<number, number> = {};

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

async function place(id: number, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(10.2, 50.1), 4326)
       FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `Q${id}001`, name],
  );
}

/** A membership a reader is shown, so the place is in a region's list where its rows say so. */
async function offeredMembership(id: number): Promise<void> {
  await pool.query(
    `INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `Q${id}001`],
  );
}

async function point(placeId: number, lon: number): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     VALUES ($1, 'fixture point', 1, ST_SetSRID(ST_MakePoint($2, 50.0), 4326), 'auto') RETURNING id`,
    [placeId, lon],
  );
  points[placeId] = row.rows[0].id;
}

const parts = (whole: number, ids: number[]) => pool.query(
  `INSERT INTO experience_parts (whole_id, part_id, reason) SELECT $1, part, 'curator' FROM unnest($2::int[]) AS part`,
  [whole, ids],
);

/** A place's rows in the fixture's world view, as region and listing, in region order. */
async function rows(placeId: number): Promise<Array<[number, string]>> {
  const result = await pool.query<{ region_id: number; listing: string }>(
    `SELECT er.region_id, er.listing FROM experience_regions er
       JOIN regions r ON r.id = er.region_id AND r.world_view_id = $2
      WHERE er.experience_id = $1 ORDER BY er.region_id`,
    [placeId, WORLD_VIEW],
  );
  return result.rows.map(row => [row.region_id, row.listing]);
}

const offered = (...regions: number[]) => regions.map(region => [region, 'offered']);

/** The region batch's points of each fixture place under the root, as [point, own_point] in point order. */
async function batch(): Promise<Record<number, Array<[number, boolean]>>> {
  const { locationsByExperience } = await getRegionExperienceLocations({
    params: { regionId: ROOT }, query: regionLocationsQuerySchema.parse({}),
  });
  return Object.fromEntries(PLACES.filter(id => locationsByExperience[id])
    .map(id => [id, locationsByExperience[id].map(l => [l.id, l.own_point === true] as [number, boolean]).sort((a, b) => a[0] - b[0])]));
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Nested whole fixture', false)`, [WORLD_VIEW],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
       ($1, $4, 'Root', NULL, false, NULL),
       ($2, $4, 'Leaf A', $1, true, ST_Multi(ST_MakeEnvelope(9.5, 49.5, 10.5, 50.5, 4326))),
       ($3, $4, 'Leaf B', $1, true, ST_Multi(ST_MakeEnvelope(10.5, 49.5, 11.5, 50.5, 4326)))`,
    [ROOT, LEAF_A, LEAF_B, WORLD_VIEW],
  );
  await place(MOUNTAIN, 'A mountain (nested whole fixture)');
  await offeredMembership(MOUNTAIN);
  await place(SPRINGS, 'A spring group (nested whole fixture)');
  await place(POND_A, 'A pond in A (nested whole fixture)');
  await place(POND_B, 'A pond in B (nested whole fixture)');
  await point(POND_A, 10.497);
  await point(POND_B, 10.503);
  await parts(SPRINGS, [POND_A, POND_B]);
  await parts(MOUNTAIN, [SPRINGS]);

  // Placing the mountain places the points it shows: its leaves', two levels down.
  await assignRegionsForExperiences([MOUNTAIN], WORLD_VIEW);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a nested whole is shown and placed by its leaves (ADR-0211)', () => {
  it('places the whole where the places inside the whole nested in it are', async () => {
    // The spring group holds no point, so its direct parts alone would give
    // the mountain no region at all.
    expect(await rows(MOUNTAIN)).toEqual(offered(ROOT, LEAF_A, LEAF_B));
    const listedInB = await getExperiencesByRegion({
      params: { regionId: LEAF_B }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
    });
    expect(listedInB.experiences.map(row => row.id)).toContain(MOUNTAIN);
  });

  it("rewrites the whole's rows in the statement that withdraws a pond two levels down", async () => {
    await pool.query('UPDATE experience_locations SET missing_since = NOW() WHERE id = $1', [points[POND_B]]);
    expect(await rows(MOUNTAIN)).toEqual(offered(ROOT, LEAF_A));

    const check = unplacedAssertions.find(a => a.id === 'place-regions-out-of-step');
    const out = (await pool.query(check!.sql)).rows.filter(row => PLACES.includes(Number(row.experience_id)));
    expect(out).toEqual([]);
  });

  it("draws the ponds' pins under the whole, its card lists them, and its row counts them with no checkbox", async () => {
    expect(await batch()).toEqual({ [MOUNTAIN]: [[points[POND_A], false], [points[POND_B], false]] });

    const card = await getExperienceLocations({
      params: { id: MOUNTAIN }, query: experienceLocationsQuerySchema.parse({}), caller: undefined,
    });
    expect(card.locations.map(l => [l.id, l.own_point])).toEqual([[points[POND_A], undefined], [points[POND_B], undefined]]);

    // The spring group has no point a reader is shown, so a row asking one
    // level down would keep a checkbox whose untick takes back no visit.
    const list = await getExperiencesByRegion({
      params: { regionId: ROOT }, query: experiencesByRegionQuerySchema.parse({}), caller: undefined,
    });
    expect(list.experiences.find(row => row.id === MOUNTAIN))
      .toMatchObject({ has_parts: true, location_count: 2, leaf_count: 2 });
  });

  it("keeps the nested whole's own point to the nested whole: its pin opens it, never the whole above (#2534)", async () => {
    await offeredMembership(SPRINGS);
    await point(SPRINGS, 10.2);
    await assignRegionsForExperiences([MOUNTAIN, SPRINGS], WORLD_VIEW);

    expect(await batch()).toEqual({
      [MOUNTAIN]: [[points[POND_A], false], [points[POND_B], false]],
      [SPRINGS]: [[points[POND_A], false], [points[POND_B], false], [points[SPRINGS], true]],
    });

    const world = await getWorldPoints({ query: worldPointsQuerySchema.parse({ detail: 'markers' }) });
    const at = (location: number) => (world.locationId ?? []).flatMap((id, i) => (id === location ? [world.experienceId?.[i]] : []));
    expect(at(points[SPRINGS])).toEqual([SPRINGS]);
    // A pond of no kind is drawn once, for one of the two wholes it is a leaf of.
    expect(at(points[POND_A])).toHaveLength(1);
  });
});
